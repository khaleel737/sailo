import "server-only";
import { stripe } from "../stripe/client";
import { actingAs } from "../connect/accounts";
import {
  EVIDENCE_FILE_TYPES,
  type EvidenceFileType,
} from "@sailo/core/disputes";

/**
 * Putting a document on Stripe so a dispute can point at it.
 *
 * Two things here are easy to get wrong and both fail late — at submission,
 * hours before a deadline, with an error that names the evidence field rather
 * than the file:
 *
 * 1. **The file must be uploaded to the account that owns the dispute.** File
 *    ids are account-scoped. A proof of delivery uploaded to the platform and
 *    handed to a connected account's `disputes.update` is rejected as an invalid
 *    value for `evidence[shipping_documentation]`, which reads like the field is
 *    wrong rather than the account. So this takes `accountId` exactly as
 *    `submitEvidence` does, and the two must always be given the same one.
 *
 * 2. **`purpose` must be `dispute_evidence`.** Stripe stores files under a
 *    purpose and refuses one filed under another — a `business_logo` id in an
 *    evidence field is not coerced. There is no other purpose that works here,
 *    so it is not a parameter.
 *
 * Uploaded files are permanent. Stripe's Files API has no delete, which is why
 * detaching a document from a dispute is a row deletion in Sailo and not a call
 * to Stripe: the upload stays where it is, unreferenced. That is the right shape
 * for evidence in any case — a document that was once attached to a case is a
 * thing that happened.
 */

export type UploadedEvidenceFile = {
  stripeFileId: string;
  filename: string;
  contentType: EvidenceFileType;
  bytes: number;
};

export type UploadResult =
  | { ok: true; file: UploadedEvidenceFile }
  | { ok: false; error: string };

/**
 * Send one document to Stripe, on the dispute's own account.
 *
 * Takes bytes rather than a `File` so the caller decides how the upload arrived
 * — a server action's `FormData`, a scenario's fixture — and so nothing in this
 * package depends on a web runtime. The content type is re-checked here even
 * though the caller checks it: this is the last point before the bytes leave, and
 * a wrong type accepted here is discovered as a failed submission rather than a
 * failed upload.
 */
export async function uploadEvidenceFile(opts: {
  accountId: string | null;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<UploadResult> {
  if (!(EVIDENCE_FILE_TYPES as readonly string[]).includes(opts.contentType)) {
    return {
      ok: false,
      error: "Stripe accepts only PDF, JPEG and PNG as dispute evidence.",
    };
  }
  if (opts.bytes.byteLength === 0) {
    return { ok: false, error: "That file is empty." };
  }

  try {
    const file = await stripe().files.create(
      {
        purpose: "dispute_evidence",
        file: {
          data: Buffer.from(opts.bytes),
          name: opts.filename,
          type: opts.contentType,
        },
      },
      /*
       * The same account the dispute lives on. `actingAs(null)` is the platform,
       * which is correct for a seller's own subscription chargeback and wrong
       * for everything else — so the caller passes the dispute's
       * `stripeAccountId` and never a default.
       */
      actingAs(opts.accountId),
    );

    return {
      ok: true,
      file: {
        stripeFileId: file.id,
        filename: opts.filename,
        contentType: opts.contentType as EvidenceFileType,
        /*
         * Stripe's own count, not the caller's. They agree in practice, and where
         * they would not, the one the 4.5 MB ceiling is measured against is
         * Stripe's.
         */
        bytes: file.size ?? opts.bytes.byteLength,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Stripe refused the upload: ${error.message}`
          : "Stripe refused the upload.",
    };
  }
}

/**
 * A short-lived URL for looking at a document that is already on Stripe.
 *
 * Evidence is reviewed before it is sent — that is the whole point of staging —
 * and a staff member cannot review a `file_1Abc…`. Stripe serves the bytes only
 * through a `FileLink`, which is why this exists rather than a stored URL.
 *
 * Thirty minutes: long enough to read, short enough that a link pasted into a
 * ticket stops working. Returns null rather than throwing because a missing
 * preview must never take down the page that lists the deadline.
 */
export async function evidenceFileUrl(
  stripeFileId: string,
  accountId: string | null,
  expiresInSeconds = 1_800,
): Promise<string | null> {
  try {
    const link = await stripe().fileLinks.create(
      {
        file: stripeFileId,
        expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
      },
      actingAs(accountId),
    );
    return link.url ?? null;
  } catch {
    return null;
  }
}
