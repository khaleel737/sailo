import { like, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, user } from "@sailo/db/schema";

/**
 * Remove a suite's own fixtures before it runs again.
 *
 * Not needed while these suites only ever ran against `up.sh`'s throwaway
 * container, which is deleted between runs. It became necessary the moment they
 * could be pointed at a Neon dev branch, which persists: after a handful of runs
 * the branch held 10,485 orders and 357 disputes, and the cohort queries these
 * suites exist to test — which scan a shop's whole order history — began timing
 * out at thirty seconds. The failures looked like the feature being slow rather
 * than the fixtures never being cleared.
 *
 * Deletes by handle prefix and lets the foreign keys do the rest: `shops` cascades
 * to orders, order items, disputes, download events and everything else hanging
 * off a shop. The `user` rows go separately because a shop points *at* a user
 * rather than owning one.
 *
 * Deliberately prefix-scoped rather than "delete every shop". These suites can be
 * pointed at a branch of a real database, and a truncate that a stray
 * `SCENARIO_ALLOW_REMOTE` sent somewhere unintended is exactly the failure
 * `local-only.ts` exists to prevent. A prefix can only ever remove rows a
 * fixture wrote.
 */
export async function purgeFixtures(prefixes: readonly string[]): Promise<void> {
  if (prefixes.length === 0) return;
  const db = getDb();

  const matches = prefixes.map((prefix) => like(shops.handle, `${prefix}%`));
  const doomed = await db
    .select({ id: shops.id, userId: shops.userId })
    .from(shops)
    .where(matches.length === 1 ? matches[0] : or(...matches));

  if (doomed.length === 0) return;

  await db.delete(shops).where(matches.length === 1 ? matches[0] : or(...matches));

  /*
   * The users, after the shops. A user row is referenced by the shop rather than
   * the other way round, so deleting it first would either fail the constraint
   * or orphan the shop depending on the FK's action — neither of which is a
   * thing to discover from a flaky suite.
   */
  const userIds = doomed.map((row) => row.userId);
  await db.delete(user).where(sql`${user.id} in ${userIds}`);
}
