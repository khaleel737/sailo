import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { marketingOptOuts } from "@sailo/db/schema";
import type { SuppressionReason } from "../broadcasts/audience";

/**
 * Who Sailo may not send marketing to, and the one asymmetry in it.
 *
 * The reason list is borrowed from `lib/broadcasts/audience.ts` rather than
 * written again — an unsubscribe, a bounce and a complaint mean the same three
 * things whoever is doing the sending, and two copies of that list is one
 * rename away from a webhook writing a reason nothing reads.
 *
 * What is *not* shared is the scope. A broadcast suppression is per shop; this
 * is per address across the whole platform, because Sailo is one sender and
 * "stop emailing me" said to us means us.
 */

export type { SuppressionReason };

/**
 * Records that Sailo must not send marketing to an address again.
 *
 * Idempotent by construction: the unique index on the address turns a second
 * unsubscribe into a no-op rather than an error, which matters because the
 * second click comes from somebody already annoyed enough to be clicking
 * twice. The first reason recorded is kept — an address that bounced and later
 * unsubscribed is still an address that bounced, and the earlier record is the
 * one worth having.
 */
export async function optOut(opts: {
  email: string;
  reason: SuppressionReason;
}): Promise<void> {
  await getDb()
    .insert(marketingOptOuts)
    .values({ email: opts.email.toLowerCase(), reason: opts.reason })
    .onConflictDoNothing();
}

/** Whether this address is currently off Sailo's marketing list. */
export async function hasOptedOut(email: string): Promise<boolean> {
  const row = await getDb().query.marketingOptOuts.findFirst({
    where: eq(marketingOptOuts.email, email.toLowerCase()),
    columns: { id: true },
  });
  return Boolean(row);
}

/**
 * Puts an address back on the list — but only if it left by choice.
 *
 * This is the settings toggle's other direction, and it is deliberately not
 * the mirror image of `optOut`. A person may change their mind about their own
 * inbox, so an `unsubscribed` row lifts. A `bounced` or `complained` row does
 * not: those are facts about deliverability rather than preferences, and a
 * seller flipping a switch to resume mail to an address that reported us as
 * spam is trading every other seller's order confirmations for their own
 * convenience. The row simply stays, and the switch reads back as off — which
 * is the truth.
 *
 * Returns whether the address is on the list now, so the caller can say so
 * rather than assume.
 */
export async function resumeMarketing(email: string): Promise<boolean> {
  await getDb()
    .delete(marketingOptOuts)
    .where(
      and(
        eq(marketingOptOuts.email, email.toLowerCase()),
        eq(marketingOptOuts.reason, "unsubscribed"),
      ),
    );
  return !(await hasOptedOut(email));
}

/**
 * The settings switch, in one call: `wanted` is what the seller just asked
 * for, and the boolean back is what they actually got.
 *
 * The two differ in exactly one case — switching mail back on for an address
 * that bounced or complained — and the caller is expected to render the
 * answer rather than the request, so nobody is shown a switch claiming a state
 * the database does not hold.
 */
export async function setMarketingOptIn(
  email: string,
  wanted: boolean,
): Promise<boolean> {
  if (wanted) return resumeMarketing(email);
  await optOut({ email, reason: "unsubscribed" });
  return false;
}
