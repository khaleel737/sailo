import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, emailSuppressions } from "@sailo/db/schema";
import type { SuppressionReason } from "../broadcasts/audience";

/**
 * The window onto `email_suppressions`, which was a correct model with no
 * screen.
 *
 * **Rule 8, and it is not weakened here.** The reason column decides what may
 * happen: an `unsubscribed` row lifts, because a person may change their mind
 * about their own inbox; a `bounced` or `complained` row does not, because
 * those are facts about deliverability rather than preferences, and a seller
 * resuming mail to an address that reported them as spam is spending every
 * other seller's order confirmations on the shared sending domain.
 *
 * The shape is `lifecycle/opt-out.ts`'s `resumeMarketing`, shop-scoped. Two
 * copies of a rule this consequential is one rename away from disagreeing, so
 * the divergence is confined to the scope and is stated in each header.
 *
 * **Lifting a suppression does not grant consent**, and that asymmetry is the
 * part that keeps the seller's button honest. Removing the row restores an
 * address to *mailable if consented*; somebody who never gave consent still
 * receives nothing, because `audienceFor` asks for `marketingConsentAt`
 * separately. A seller cannot manufacture a recipient by pressing this twice.
 */

export type SuppressionRow = {
  email: string;
  reason: SuppressionReason;
  createdAt: Date;
  /** The contact behind the address, when the shop still has one. */
  clientId: string | null;
  name: string | null;
  /** Whether they would be mailable if the suppression were lifted. */
  consented: boolean;
};

export const SUPPRESSION_LIMIT = 500;

/**
 * Everyone this shop may not mail, newest first.
 *
 * Left-joined to `clients` on the folded address, because a suppression
 * outlives the contact: an unsubscribe arrives from a mail client with no
 * session and the row must stand even if the seller later deletes the customer.
 * A null name is that case, and the screen shows the address.
 */
export async function suppressionsFor(
  shopId: string,
  limit = SUPPRESSION_LIMIT,
): Promise<SuppressionRow[]> {
  const rows = await getDb()
    .select({
      email: emailSuppressions.email,
      reason: emailSuppressions.reason,
      createdAt: emailSuppressions.createdAt,
      clientId: clients.id,
      name: clients.name,
      consentedAt: clients.marketingConsentAt,
    })
    .from(emailSuppressions)
    .leftJoin(
      clients,
      and(
        eq(clients.shopId, emailSuppressions.shopId),
        sql`lower(${clients.email}) = ${emailSuppressions.email}`,
      ),
    )
    .where(eq(emailSuppressions.shopId, shopId))
    .orderBy(desc(emailSuppressions.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    email: row.email,
    reason: row.reason as SuppressionReason,
    createdAt: row.createdAt,
    clientId: row.clientId,
    name: row.name,
    consented: Boolean(row.consentedAt),
  }));
}

export type SuppressionCounts = {
  unsubscribed: number;
  bounced: number;
  complained: number;
};

/** The three numbers the screen's header reads. One statement, filtered counts. */
export async function suppressionCounts(shopId: string): Promise<SuppressionCounts> {
  const [row] = await getDb()
    .select({
      unsubscribed: sql<string>`count(*) filter (where ${emailSuppressions.reason} = 'unsubscribed')`,
      bounced: sql<string>`count(*) filter (where ${emailSuppressions.reason} = 'bounced')`,
      complained: sql<string>`count(*) filter (where ${emailSuppressions.reason} = 'complained')`,
    })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.shopId, shopId));

  return {
    unsubscribed: Number(row?.unsubscribed ?? 0),
    bounced: Number(row?.bounced ?? 0),
    complained: Number(row?.complained ?? 0),
  };
}

export type ResubscribeOutcome = "lifted" | "refused" | "absent";

/**
 * Puts an address back, but only if it left by choice.
 *
 * The reason is in the WHERE rather than read and then branched on. That is
 * not style: check-then-act here would let a bounce webhook landing between
 * the read and the delete have its row removed by a seller who was answering
 * a different question. One statement, and the `reason` is part of the match.
 *
 * Three answers rather than a boolean, because "there was nothing to lift" and
 * "there was, and it is not yours to lift" need different copy — and the
 * second one is the one carrying the warning the screen has to show.
 */
export async function resubscribe(
  shopId: string,
  email: string,
): Promise<ResubscribeOutcome> {
  const folded = email.trim().toLowerCase();

  const [lifted] = await getDb()
    .delete(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.shopId, shopId),
        eq(emailSuppressions.email, folded),
        eq(emailSuppressions.reason, "unsubscribed"),
      ),
    )
    .returning({ email: emailSuppressions.email });
  if (lifted) return "lifted";

  /*
   * Nothing came out. Either there was no row, or the row was a bounce or a
   * complaint — and only now, after the delete has already declined to touch
   * it, is it safe to look and say which.
   */
  const remaining = await getDb().query.emailSuppressions.findFirst({
    where: and(
      eq(emailSuppressions.shopId, shopId),
      eq(emailSuppressions.email, folded),
    ),
    columns: { reason: true },
  });
  return remaining ? "refused" : "absent";
}
