import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputes, orders, shops } from "@sailo/db/schema";
import { assembleEvidence, isFileField, type EvidenceFileField } from "@sailo/core/disputes";
import {
  evidenceFilesFor,
  holdingsForOrder,
} from "@sailo/commerce/disputes";
import type { SellerDispute } from "@/app/admin/payments/_components/disputes-card";

/**
 * A shop's own chargebacks, in the shape its payments page renders.
 *
 * Scoped to `connected` deliberately: a seller's *own* subscription chargeback
 * is a platform dispute and an argument between them and Sailo, and it has no
 * business appearing on the page where they manage taking money from buyers.
 *
 * The evidence gaps are computed here rather than stored, because they change
 * as the seller works: marking an order shipped fills three fields at once, and
 * a panel showing yesterday's gaps would send them looking for something they
 * have already provided.
 */
export async function getSellerDisputes(shopId: string): Promise<SellerDispute[]> {
  const db = getDb();

  const rows = await db
    .select()
    .from(disputes)
    .where(
      sql`${disputes.shopId} = ${shopId} and ${disputes.scope} = 'connected'`,
    )
    /*
     * Deadline first, nulls last: a closed dispute has no date and must not sit
     * above one that expires tomorrow, which is what Postgres does with nulls in
     * a plain ascending sort.
     */
    .orderBy(sql`${disputes.dueBy} asc nulls last`, desc(disputes.stripeCreatedAt))
    .limit(25);

  if (rows.length === 0) return [];

  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });

  return Promise.all(
    rows.map(async (dispute): Promise<SellerDispute> => {
      const base = {
        id: dispute.id,
        status: dispute.status,
        reason: dispute.reason,
        amountCents: dispute.amountCents,
        deductedCents: dispute.deductedCents,
        feeCents: dispute.feeCents,
        currency: dispute.currency,
        dueBy: dispute.dueBy,
        evidenceSubmittedAt: dispute.evidenceSubmittedAt,
        orderId: dispute.orderId,
      };

      if (!dispute.orderId) {
        /*
         * A charge with no Sailo order — taken from Stripe's own dashboard.
         * Nothing can be assembled, and saying "everything is on file" would be
         * a lie in the direction that loses the case.
         */
        return { ...base, uploads: [], missing: [], ready: false };
      }

      const order = await db.query.orders.findFirst({
        where: eq(orders.id, dispute.orderId),
      });
      if (!order) return { ...base, uploads: [], missing: [], ready: false };

      /*
       * The seller's own uploads count towards their gaps.
       *
       * Without the merge a seller who has just uploaded their carrier receipt is
       * still told the case needs one — which teaches them the panel is wrong and
       * that the next prompt can be ignored. The documents are on the dispute, so
       * they have to be read from it.
       */
      const holdings = await holdingsForOrder(order, shop);
      const attached = await evidenceFilesFor(dispute.id);
      const evidence = assembleEvidence(dispute.reason, {
        ...holdings,
        files: {
          ...holdings.files,
          ...Object.fromEntries(attached.map((file) => [file.field, file.stripeFileId])),
        },
      });

      /*
       * Only what the seller can actually do something about.
       *
       * `assembleEvidence` reports three kinds of gap and only one of them is a
       * task: a missing purchase IP cannot be produced by anybody — the buyer's
       * connection existed for one request months ago — and listing it under
       * "still needed" sends a seller looking for something that does not exist.
       * `needs_seller` is the subset with an `ask` written for them.
       */
      const missing = evidence.fields
        .filter((field) => field.status === "needs_seller" && field.required)
        .map((field) => field.ask ?? field.field);

      /*
       * The documents this case wants, and which are already on it.
       *
       * Required first, then the persuasive extras, because a seller with ten
       * minutes should spend them on the field the network decides the case on.
       * `assembleEvidence` has already worked out which is which for this reason
       * and this kind of sale — a proof of delivery is required for a parcel and
       * meaningless for a download.
       */
      const slots = [
        ...evidence.blockedOnSeller,
        ...evidence.optionalUploads,
        /*
         * Already-attached documents belong here too, and leaving them out was a
         * defect the scenario suite caught: a field stops being "blocked on the
         * seller" the moment it is filled, so a panel built only from the gaps
         * makes the document the seller just uploaded disappear — with no way
         * left to see what was attached, replace a bad scan, or remove one
         * attached in error.
         */
        ...attached.map((file) => file.field),
      ];

      const uploads = [...new Set(slots)].flatMap((field) =>
        isFileField(field)
          ? [
              {
                field: field as EvidenceFileField,
                required: evidence.blockedOnSeller.includes(field),
                attached: attached.find((file) => file.field === field) ?? null,
              },
            ]
          : [],
      );

      return {
        ...base,
        uploads,
        missing,
        /*
         * Ready means every *required* field is held — not that the case will be
         * won. The distinction is the only honest thing a system can say here,
         * and the copy in `disputeReady` says exactly that: everything the bank
         * asks for is on file.
         */
        ready: !evidence.hasGaps,
      };
    }),
  );
}

export { isFileField };
