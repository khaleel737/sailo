import "server-only";
import { withRedis } from "@sailo/rate-limit";
import type { Listing } from "./check";

/**
 * The one thing the daily check has to remember: what it found last time.
 *
 * Without it the cron has two bad options — mail the team every morning for as
 * long as a listing lasts, which trains everyone to filter the alert away
 * before the *next* listing arrives, or never repeat and lose the alert if it
 * is missed once. What makes "only tell me when something changed" possible is
 * a single remembered answer.
 *
 * **Why Redis and not a table.** This is one small value with no history, no
 * relations and nothing that reads it transactionally; a table for it would
 * mean a schema file, a migration and a permanent row in the platform's
 * backbone to hold what amounts to a sticky note. Redis already exists here for
 * exactly this class of value, under the rule stated in `lib/redis.ts`: an
 * accelerator, never a source of truth. The blocklist itself is the source of
 * truth and it is re-read from scratch every day, so losing this key costs
 * nothing but one repeated email.
 *
 * **What happens when Redis is not configured** (it is optional — see the
 * health page): `readLastCheck` returns null, every day looks like the first
 * one, and a standing listing therefore mails the team once a day until it is
 * cleared. That is the deliberate direction to fail in. A repeated alert about
 * a real, unresolved blocklisting is an annoyance; silence about one is the
 * failure this whole feature was built to prevent.
 */

/** No TTL: eviction is harmless (one repeated alert) and staleness is visible. */
const KEY = "sailo:blocklist:last";

export type LastCheck = {
  /** ISO 8601, so the health page can say how long ago — and how stale. */
  at: string;
  listings: Listing[];
};

/**
 * What the check found, or null when nothing is remembered — never checked,
 * Redis not configured, Redis unreachable, or the key evicted. The caller
 * cannot tell those apart and does not need to: all four mean "no basis for
 * suppressing an alert".
 */
export async function readLastCheck(): Promise<LastCheck | null> {
  return withRedis(async (redis) => {
    const raw = await redis.get(KEY);
    if (typeof raw !== "string") return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;

      const { at, listings } = parsed as Partial<LastCheck>;
      if (typeof at !== "string" || !Array.isArray(listings)) return null;
      return { at, listings };
    } catch {
      // A value we wrote in an older shape, or a truncated one. Forgetting it
      // costs one repeated alert; trusting it could suppress a real one.
      return null;
    }
  }, null);
}

/** Records what this run found. Returns whether it was actually stored. */
export async function writeLastCheck(check: LastCheck): Promise<boolean> {
  return withRedis(async (redis) => {
    await redis.set(KEY, JSON.stringify(check));
    return true;
  }, false);
}

/**
 * Identity of a set of listings — the same domain listed on the same zone with
 * the same return code is the same fact, however many times it is observed.
 *
 * Sorted, because zone order is an implementation detail and a reordering is
 * not news. The code is part of the identity on purpose: DBL moving a domain
 * from `127.0.1.2` (spam) to `127.0.1.5` (malware) is a materially different
 * situation and should be said out loud.
 */
function signature(listings: Listing[]): string {
  return listings
    .map((l) => `${l.domain}@${l.zone}=${l.code}`)
    .toSorted()
    .join(";");
}

export type Verdict = "alert" | "cleared" | "quiet";

/**
 * Whether this run has anything to say.
 *
 * - `alert` — something is listed and it is not what we reported last time.
 * - `cleared` — we reported a listing before and it is gone now. Worth sending
 *   because the team's last word on the subject was an alarm, and leaving that
 *   as the last word means the only way to learn it ended is to go looking.
 * - `quiet` — clean and was clean, or listed with exactly the same facts as
 *   yesterday. Nothing sent.
 */
export function verdictFor(
  previous: LastCheck | null,
  listings: Listing[],
): Verdict {
  const now = signature(listings);
  const before = previous ? signature(previous.listings) : null;

  if (listings.length > 0) return now === before ? "quiet" : "alert";
  return before ? "cleared" : "quiet";
}
