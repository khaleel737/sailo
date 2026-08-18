import "server-only";
import { getDb } from "@sailo/db";
import { staffActions } from "@sailo/db/schema";

/**
 * The record of staff reaching into somebody else's account.
 *
 * One row per act, written by whichever app the act happened in. That is the
 * reason this is a package rather than a helper inside apps/hq: almost every
 * staff action does happen there, but dispute evidence is uploaded through a
 * route handler in apps/web — because the seller uploads through the same route
 * and a 4.5 MB body cannot be a Server Action — and an audit trail with a hole
 * in it for the one action that involves money and a document is not one.
 *
 * `shopId` is nullable and often null on purpose: a partner decision is about a
 * person, not a shop, and most partners do not have one. Writing a fabricated
 * id to satisfy a column would make the log's most useful filter lie.
 *
 * Deliberately has no idea what a page is. The callers revalidate whatever
 * their own app needs to redraw; this only writes the row.
 */
export async function recordStaffAction(input: {
  /** The staff address, from the session — never from a form. */
  actorEmail: string;
  /** A dotted verb: `dispute.evidence_attached`, `partner.approved`. */
  action: string;
  /** The shop the act was about, when it was about one. */
  shopId: string | null;
  /** One sentence, in the past tense, readable a year later. */
  summary: string;
}): Promise<void> {
  await getDb().insert(staffActions).values({
    actorEmail: input.actorEmail,
    action: input.action,
    shopId: input.shopId,
    summary: input.summary,
  });
}
