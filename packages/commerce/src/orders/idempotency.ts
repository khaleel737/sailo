import "server-only";
import { withRedis } from "@sailo/rate-limit";

/**
 * "I already asked this — tell me what you said."
 *
 * A door scanner queues admissions while a venue's wifi is out and replays them
 * when it comes back, so the same request genuinely arrives twice and the
 * second one is not a mistake to be refused. It is a question to be answered
 * the same way.
 *
 * **This is not what makes anything safe.** Every write behind it is already
 * idempotent by construction — an admission is a conditional UPDATE on
 * `status = 'valid'`, so a replay cannot admit a second person no matter what
 * happens here. What this adds is that the replay comes back saying *admitted*
 * rather than *already used*, which is the difference between a volunteer
 * waving somebody through and a volunteer arguing with them.
 *
 * That ordering is deliberate and it is what makes the cache safe to lose.
 * `@sailo/rate-limit` is explicit that Redis is an accelerator and never a
 * source of truth: unconfigured, cold or slow, `withRedis` falls back, the
 * operation simply runs, and the outcome is the pre-existing behaviour rather
 * than a double admission. A design that put the safety here instead would
 * turn a cache outage into a door that lets everybody in twice.
 */

/** A day. An event, its door shift and the reconnect the next morning all fit. */
export const IDEMPOTENCY_WINDOW_SECONDS = 24 * 60 * 60;

export type IdempotentOutcome<T> = {
  result: T;
  /** True when this answer came from a previous identical request. */
  replayed: boolean;
};

/**
 * Runs `operation`, or hands back what it returned the first time.
 *
 * `worthReplaying` decides what is remembered. A refusal usually is not: a
 * `not_found` cached for a day keeps answering "no such ticket" about a code
 * the seller has since corrected, and re-running is both cheap and idempotent.
 *
 * Two identical keys arriving *simultaneously* can both miss and both run.
 * That is left alone rather than locked, because the write underneath already
 * handles it — the loser of the conditional UPDATE gets `already_used`, which
 * is exactly the answer it would have got without any of this. A lock here
 * would add a way for the door to hang and remove nothing.
 */
export async function onceWithin<T>(
  key: string,
  operation: () => Promise<T>,
  worthReplaying: (result: T) => boolean,
  windowSeconds = IDEMPOTENCY_WINDOW_SECONDS,
): Promise<IdempotentOutcome<T>> {
  const cacheKey = `sailo:idem:${key}`;

  const remembered = await withRedis<string | null>(
    (redis) => redis.get(cacheKey),
    null,
  );
  if (remembered) {
    try {
      return { result: JSON.parse(remembered) as T, replayed: true };
    } catch {
      // A value we cannot read is a value we did not write, or wrote in an
      // older shape. Fall through and answer the question again.
    }
  }

  const result = await operation();

  if (worthReplaying(result)) {
    await withRedis(async (redis) => {
      /*
       * `NX`, so the first answer is the one that sticks. Under the concurrent
       * miss described above, both callers write and only one is kept — and it
       * is the admission rather than the `already_used` that follows it,
       * because `worthReplaying` refuses the second.
       */
      await redis.set(cacheKey, JSON.stringify(result), {
        expiration: { type: "EX", value: windowSeconds },
        condition: "NX",
      });
    }, undefined);
  }

  return { result, replayed: false };
}
