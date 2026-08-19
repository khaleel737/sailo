import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputeEvidenceFiles, type Dispute, type Order, type Shop } from "@sailo/db/schema";
import {
  EVIDENCE_PACK_VERSION,
  type PackDocument,
  type PackHoldings,
} from "@sailo/core/disputes";
import {
  SAILO_UPLOADER,
  offerablePackDocuments,
  packHoldingsForOrder,
} from "@sailo/commerce/disputes";
import { uploadEvidenceFile } from "@sailo/payments/disputes";
import { renderEvidenceDocument } from "./evidence-pdf";

/**
 * The pack, from an order to a PDF, and from a dispute to Stripe. Spec 45.
 *
 * Two callers with two jobs and one content path between them:
 *
 *   - **A seller downloading it from the order page**, at any time, before any
 *     dispute exists. That is what "always ready" means, and it is also the best
 *     way for a seller to discover a gap while it is still fixable — a pack full
 *     of "Not on record" is a shop that has not been marking things shipped.
 *   - **The dispute webhook**, which generates the applicable documents and
 *     registers them as `dispute_evidence_files` rows exactly as a seller upload
 *     would: same table, same field uniqueness, same budget check,
 *     `uploadedBy = 'sailo:auto'`. The readiness panel then shows those slots as
 *     `held`, and the seller's job shrinks to the two that are genuinely theirs.
 *
 * Nothing is stored per order. See `pack-holdings.ts` for why.
 */

/** One document, rendered. `renderedAt` is the caller's clock, never ours. */
export async function renderPackDocument(opts: {
  document: PackDocument;
  shopName: string;
  renderedAt: Date;
}): Promise<Buffer> {
  return renderEvidenceDocument({
    document: opts.document,
    shopName: opts.shopName,
    renderedAt: opts.renderedAt,
    packVersion: EVIDENCE_PACK_VERSION,
  });
}

/** The human-readable pack for one order — the file a seller downloads. */
export async function renderOrderPack(opts: {
  order: Order;
  shop: Shop;
  renderedAt: Date;
}): Promise<{ holdings: PackHoldings; bytes: Buffer; filename: string }> {
  const holdings = await packHoldingsForOrder(opts.order, {
    shop: opts.shop,
    renderedAt: opts.renderedAt,
  });

  const { packDocuments } = await import("@sailo/core/disputes");
  const [pack] = packDocuments(holdings);
  /*
   * `packDocuments` always returns the human-readable pack first and always
   * returns it — even for an order with nothing on it, because a pack full of
   * "Not on record" is exactly what a seller needs to see before a dispute
   * arrives. The narrowing is honest rather than asserted: if the contract ever
   * changed, a thrown error naming it beats a blank PDF.
   */
  if (!pack) throw new Error("packDocuments returned no human-readable pack");

  return {
    holdings,
    bytes: await renderPackDocument({
      document: pack,
      shopName: opts.shop.name,
      renderedAt: opts.renderedAt,
    }),
    filename: `evidence-${opts.order.id.slice(0, 8)}.pdf`,
  };
}

export type AutoFillResult = {
  /** Evidence fields now filled by a generated document. */
  filled: string[];
  /** Documents that did not fit inside the combined budget, by field. */
  dropped: string[];
  /** Fields left alone because the seller had already uploaded their own. */
  deferredToSeller: string[];
};

/**
 * Generate and register the applicable documents when a dispute opens.
 *
 * ─── WHAT IT WILL NOT DO ───────────────────────────────────────────────────
 *
 * **It never replaces a seller's own upload.** A carrier's proof of delivery is
 * what wins a `product_not_received`; Sailo's account of what Sailo saw is a
 * fair second. Overwriting the first with the second would be the worst possible
 * bug in this feature, so a field the seller has already filled is skipped
 * outright rather than upserted over.
 *
 * **And it never runs on a platform dispute.** There is no order behind one, and
 * spec 46's pack is a different document assembled from different holdings.
 *
 * Swallows its own failures. This runs inside a webhook Stripe is waiting on, and
 * failing a recorded chargeback because a PDF would not render would trade a real
 * record for a document that can be generated again from the same facts a minute
 * later.
 */
export async function autoFillEvidence(opts: {
  dispute: Dispute;
  order: Order;
  shop: Shop;
  now: Date;
}): Promise<AutoFillResult> {
  const empty: AutoFillResult = { filled: [], dropped: [], deferredToSeller: [] };
  if (opts.dispute.scope === "platform") return empty;

  try {
    const holdings = await packHoldingsForOrder(opts.order, {
      shop: opts.shop,
      renderedAt: opts.now,
    });

    const { include, dropped } = await offerablePackDocuments(opts.dispute.id, holdings);

    const db = getDb();
    const held = await db
      .select({ field: disputeEvidenceFiles.field, uploadedBy: disputeEvidenceFiles.uploadedBy })
      .from(disputeEvidenceFiles)
      .where(eq(disputeEvidenceFiles.disputeId, opts.dispute.id));

    const sellerFields = new Set(
      held.filter((row) => row.uploadedBy !== SAILO_UPLOADER).map((row) => row.field),
    );

    const result: AutoFillResult = {
      filled: [],
      dropped: dropped.map((document) => document.field),
      deferredToSeller: [],
    };

    for (const document of include) {
      if (sellerFields.has(document.field)) {
        result.deferredToSeller.push(document.field);
        continue;
      }

      const bytes = await renderPackDocument({
        document,
        shopName: opts.shop.name,
        renderedAt: opts.now,
      });

      const uploaded = await uploadEvidenceFile({
        // The dispute's own account. A file uploaded to the platform is
        // invisible to a connected account's `disputes.update`.
        accountId: opts.dispute.stripeAccountId,
        filename: `${document.kind}-${opts.order.id.slice(0, 8)}.pdf`,
        contentType: "application/pdf",
        bytes,
      });
      if (!uploaded.ok) continue;

      await db
        .insert(disputeEvidenceFiles)
        .values({
          disputeId: opts.dispute.id,
          field: document.field,
          stripeFileId: uploaded.file.stripeFileId,
          filename: uploaded.file.filename,
          contentType: uploaded.file.contentType,
          bytes: uploaded.file.bytes,
          uploadedBy: SAILO_UPLOADER,
        })
        /*
         * Upserted, so a re-run replaces the previous generation rather than
         * failing on the field's unique index — and so a case re-opened after an
         * order changed carries the newer document.
         */
        .onConflictDoUpdate({
          target: [disputeEvidenceFiles.disputeId, disputeEvidenceFiles.field],
          set: {
            stripeFileId: uploaded.file.stripeFileId,
            filename: uploaded.file.filename,
            contentType: uploaded.file.contentType,
            bytes: uploaded.file.bytes,
            uploadedBy: SAILO_UPLOADER,
            createdAt: opts.now,
          },
        });

      result.filled.push(document.field);
    }

    return result;
  } catch (error) {
    /*
     * Logged and swallowed. The dispute is recorded either way, the seller's
     * deadline is intact, and every document here can be regenerated from the
     * same facts — none of which is true of the webhook Stripe is waiting on.
     */
    console.error("[sailo] could not auto-fill evidence", error);
    return empty;
  }
}
