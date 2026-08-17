/**
 * The numbers that shape the delivery queue, and the two decisions they encode.
 *
 * Split out of a 505-line `deliver.ts` so that the retry schedule — the part with no
 * database, no network and no mocks in it — can be tested as arithmetic. It was six
 * constants and two inline expressions buried in a function that also signs bodies and
 * posts sockets, which is why the schedule had never been asserted anywhere.
 */

/**
 * 1m, 5m, 30m, 2h, 12h — then the delivery is abandoned.
 *
 * Six attempts spanning roughly fifteen hours, which is the shape every
 * webhook system converges on: dense enough at the start to ride out a deploy
 * or a restart, spread out enough at the end to survive an outage that lasts a
 * working day, and finite because an event nobody has accepted by tomorrow is
 * not one their CRM still wants.
 */
const RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  12 * 3_600_000,
] as const;

const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/**
 * How long a claimed row is hidden from other ticks.
 *
 * Longer than the POST timeout by a wide margin and longer than the cron
 * interval, so the only thing that can make a leased row due again is the
 * process that claimed it having died.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

/** Consecutive failures before we stop delivering and tell the seller. */
const AUTO_DISABLE_AFTER = 20;

/** Rows examined per tick. The cron runs every five minutes. */
const MAX_PER_TICK = 200;

/** Rows one endpoint may receive in a single tick. */
const MAX_PER_ENDPOINT = 10;

/** Endpoints posted to at once. */
const MAX_CONCURRENT_ENDPOINTS = 8;

export type QueueRun = {
  attempted: number;
  delivered: number;
  failed: number;
  abandoned: number;
  disabled: number;
};

/**
 * How long to wait before attempt `attemptNumber + 1`.
 *
 * `attemptNumber` is 1-based and comes from the claim, which increments before
 * returning — so the first attempt asks for `RETRY_BACKOFF_MS[0]`. Past the end of the
 * table it holds at the longest wait rather than reading `undefined` and scheduling a
 * retry for *now*, which would turn an exhausted delivery into a hot loop.
 */
export function backoffFor(attemptNumber: number): number {
  return (
    RETRY_BACKOFF_MS[attemptNumber - 1] ??
    RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ??
    0
  );
}

/** Whether this attempt was the last one this delivery gets. */
export function attemptsExhausted(attemptNumber: number): boolean {
  return attemptNumber >= MAX_ATTEMPTS;
}

export { RETRY_BACKOFF_MS, MAX_ATTEMPTS, CLAIM_LEASE_MS, AUTO_DISABLE_AFTER, MAX_PER_TICK, MAX_PER_ENDPOINT, MAX_CONCURRENT_ENDPOINTS };
