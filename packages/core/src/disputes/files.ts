/*
 * The documents, and the ceilings the card networks put on them.
 *
 * `assemble.ts` can tell you that a `product_not_received` case needs a proof of
 * delivery. It cannot produce one — that is a PDF from a carrier, a screenshot of
 * a conversation, a signed receipt — and until this pass there was nowhere in
 * Sailo to put one. `holdings.ts` returned `files: {}` and every file field was
 * reported as an outstanding ask that no surface in the product could satisfy.
 *
 * So this is the rulebook for the upload that fills them, and it is a rulebook
 * rather than a size check because the constraint that actually bites is not
 * per-file:
 *
 *   - **4.5 MB combined**, across every file on the dispute. Stripe's own limit
 *     and the issuers' — one 4 MB proof of delivery does not leave room for a
 *     1 MB receipt, and the eleventh-hour upload that tips the set over is
 *     rejected at submission, when the deadline is hours away.
 *   - **Under 50 pages combined**, and under 19 for Mastercard. A page count is
 *     not something an upload form can measure without parsing the PDF, so it is
 *     carried as guidance rather than enforced — see `PAGE_GUIDANCE`.
 *   - **PDF, JPEG or PNG.** Nothing else is accepted, and a rejected file type
 *     fails the whole `disputes.update`, taking the correct fields with it.
 *   - **One file per evidence type.** Stripe's evidence object has one slot per
 *     field, so a second upload to `customer_communication` replaces the first
 *     rather than joining it. A seller with three screenshots must combine them,
 *     and must be told that before they upload the third and silently lose the
 *     first two.
 *
 * Sources: Stripe's dispute evidence best-practices page (file upload
 * recommendations, and the per-network size and page table) and the Files API
 * reference for the accepted purposes. Re-checked 2026-08-18.
 *
 * Pure, like everything else in this directory: no Stripe, no database, no
 * filesystem. The upload itself is `@sailo/payments/disputes/files`.
 */

import { EVIDENCE_FILE_FIELDS, type EvidenceFileField } from "./reasons";

/**
 * What Stripe's Files API accepts for `purpose: dispute_evidence`.
 *
 * Checked against the *content type*, never the extension. A `.pdf` that is
 * really a HEIC is rejected by Stripe after it has been uploaded and stored
 * against the dispute, which is the worst of both: the seller believes the file
 * is on file and the submission fails at the one moment it cannot be retried.
 */
export const EVIDENCE_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type EvidenceFileType = (typeof EVIDENCE_FILE_TYPES)[number];

/** Extensions offered in the file picker. `image/jpg` is not a content type. */
export const EVIDENCE_FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png";

/**
 * 4.5 MB, across every file on the dispute rather than each.
 *
 * The number is Stripe's and the issuers' alike, and it is a *combined* budget —
 * which is why nothing here validates a file on its own. A 4 MB scan uploaded
 * first is legal; the 600 KB receipt after it is the one that breaks, and the
 * seller who uploaded them in the other order would have had the opposite
 * experience for the same set of documents. Both need to be told the same thing,
 * so the check takes the whole set.
 */
export const EVIDENCE_FILE_BUDGET_BYTES = 4_500_000;

/**
 * Page ceilings, carried as advice.
 *
 * Not enforced: counting pages means parsing the PDF, and a wrong count that
 * blocks an upload costs a case that a right one would only have improved. The
 * asymmetry decides it — an over-long file is weak evidence, a blocked upload is
 * no evidence.
 *
 * Mastercard's 19 is the one that surprises people; it is roughly a third of the
 * general limit, and a terms-of-service PDF clears it without trying.
 */
export const PAGE_GUIDANCE = {
  allNetworks: 50,
  mastercard: 19,
} as const;

/**
 * What each file field is called in front of a human, and what belongs in it.
 *
 * Stripe's field names are the API's, and they are not self-explanatory to the
 * person being asked for the document: `service_documentation` is "proof you
 * delivered the service", and a seller shown the raw name uploads the wrong
 * thing or nothing. The second line is Stripe's own guidance on what an issuer
 * looks for in that file, compressed to the part that changes what a seller
 * scans.
 */
export const EVIDENCE_FILE_GUIDE: Record<
  EvidenceFileField,
  { label: string; wants: string }
> = {
  shipping_documentation: {
    label: "Proof of delivery",
    wants:
      "The carrier's own record, showing the delivery date and the full address — not just the city and postcode.",
  },
  service_documentation: {
    label: "Proof the service happened",
    wants:
      "An attendance record, signed job sheet, or system log showing the service was provided, with the date on it.",
  },
  receipt: {
    label: "Receipt",
    wants: "The receipt sent to the buyer, showing the date, currency and amount.",
  },
  customer_communication: {
    label: "Messages with the buyer",
    wants:
      "The relevant excerpts only, with the buyer's name visible. Combine several conversations into one file — Stripe keeps only one.",
  },
  customer_signature: {
    label: "Signature",
    wants: "A signed receipt, contract, or delivery slip carrying the buyer's signature.",
  },
  refund_policy: {
    label: "Refund policy",
    wants:
      "The section the buyer is arguing about, and a screenshot of where it was shown at checkout. Not the whole document.",
  },
  cancellation_policy: {
    label: "Cancellation policy",
    wants:
      "The clause that applies, plus proof it was shown before purchase. Issuers do not read a full terms page.",
  },
  duplicate_charge_documentation: {
    label: "The other charge",
    wants:
      "Documentation of the charge the buyer says is the duplicate, showing the two are for different things.",
  },
  uncategorized_file: {
    label: "Anything else",
    wants:
      "Only where nothing above fits. An issuer reads categorised evidence first, so prefer a named field.",
  },
};

/** The file fields, ordered as the guide lists them. */
export const EVIDENCE_FILE_ORDER: readonly EvidenceFileField[] = EVIDENCE_FILE_FIELDS;

export type HeldFile = {
  field: EvidenceFileField;
  bytes: number;
  filename: string;
};

export type FileRejection =
  | { ok: false; reason: "type"; message: string }
  | { ok: false; reason: "budget"; message: string; overBy: number }
  | { ok: false; reason: "empty"; message: string };

export type FileAcceptance = {
  ok: true;
  /** Whether this upload takes the place of one already held on that field. */
  replaces: HeldFile | null;
  /** Bytes left for further uploads once this one is stored. */
  remainingBytes: number;
};

/**
 * Whether one more document can join the set.
 *
 * Takes what is already held rather than just the incoming file, because the
 * budget is combined and the answer genuinely depends on the others. Returns the
 * file it would replace so the surface can say so *before* it happens: a seller
 * whose third screenshot silently overwrote the first two would submit one
 * message where they believed they had submitted a conversation.
 */
export function acceptEvidenceFile(
  incoming: { field: EvidenceFileField; bytes: number; contentType: string },
  held: readonly HeldFile[],
): FileAcceptance | FileRejection {
  if (!(EVIDENCE_FILE_TYPES as readonly string[]).includes(incoming.contentType)) {
    return {
      ok: false,
      reason: "type",
      message:
        "Stripe accepts PDF, JPEG and PNG for dispute evidence, and rejects the whole " +
        "submission over one wrong type. Export or re-save the file and try again.",
    };
  }

  if (incoming.bytes <= 0) {
    return { ok: false, reason: "empty", message: "That file is empty." };
  }

  /*
   * The replaced file's bytes come back out of the budget, because the field has
   * one slot. Charging for both would refuse a seller re-uploading a *smaller*
   * corrected scan over a large one — the case where the set is getting better.
   */
  const replaces = held.find((file) => file.field === incoming.field) ?? null;
  const others = held.filter((file) => file.field !== incoming.field);
  const spent = others.reduce((sum, file) => sum + file.bytes, 0);
  const total = spent + incoming.bytes;

  if (total > EVIDENCE_FILE_BUDGET_BYTES) {
    return {
      ok: false,
      reason: "budget",
      message:
        `That would put the evidence at ${formatBytes(total)}, over the ` +
        `${formatBytes(EVIDENCE_FILE_BUDGET_BYTES)} the card networks accept across all ` +
        `files on a dispute. Compress it, or remove a document already attached.`,
      overBy: total - EVIDENCE_FILE_BUDGET_BYTES,
    };
  }

  return {
    ok: true,
    replaces,
    remainingBytes: EVIDENCE_FILE_BUDGET_BYTES - total,
  };
}

/** Bytes used by the documents held against a dispute. */
export function bytesHeld(held: readonly HeldFile[]): number {
  return held.reduce((sum, file) => sum + file.bytes, 0);
}

/**
 * How close the set is to the ceiling, for the meter on the evidence page.
 *
 * A percentage rather than a boolean because the useful moment is before the
 * refusal: a seller at 88% who still has a proof of delivery to add needs to
 * know now, while there is time to compress, rather than at the upload that
 * fails.
 */
export function budgetPressure(held: readonly HeldFile[]): {
  usedBytes: number;
  remainingBytes: number;
  usedPct: number;
  tight: boolean;
} {
  const usedBytes = bytesHeld(held);
  const ratio = usedBytes / EVIDENCE_FILE_BUDGET_BYTES;
  return {
    usedBytes,
    remainingBytes: Math.max(0, EVIDENCE_FILE_BUDGET_BYTES - usedBytes),
    usedPct: Math.round(ratio * 100),
    /*
     * From the exact ratio, not from `usedPct`. Rounding first makes the warning
     * fire at 74.6% — the displayed number and the threshold would be the same
     * "75%" while the set is genuinely under it, which is a rule nobody can
     * reason about from the outside.
     */
    tight: ratio >= 0.75,
  };
}

/** `1.4 MB`. Decimal megabytes, because that is how the 4.5 MB limit is stated. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
