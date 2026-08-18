import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputeEvidenceFiles, disputes } from "@sailo/db/schema";
import {
  acceptEvidenceFile,
  budgetPressure,
  isFileField,
  type EvidenceFileField,
  type HeldFile,
} from "@sailo/core/disputes";
import { evidenceFileUrl, uploadEvidenceFile } from "@sailo/payments/disputes";

/**
 * The documents attached to a dispute: reading them, adding one, removing one.
 *
 * The decisions are all in `@sailo/core/disputes/files` — what Stripe accepts,
 * what the 4.5 MB combined ceiling permits, what a given field is for. What is
 * left here is the part that needs the database and the Stripe account, which is
 * mostly the ordering:
 *
 *   1. Read what is already held, because the ceiling is combined and the answer
 *      depends on the set rather than the file.
 *   2. Ask `acceptEvidenceFile` whether this one may join it.
 *   3. Only then upload — a rejected file must never reach Stripe, because Stripe
 *      files cannot be deleted and a refused upload would leave a permanent
 *      orphan on the seller's account for every mistake they make.
 *   4. Record the row last, so a failed upload leaves nothing claiming to be
 *      attached.
 */

export type EvidenceFileRow = {
  id: string;
  field: EvidenceFileField;
  stripeFileId: string;
  filename: string;
  contentType: string;
  bytes: number;
  uploadedBy: string | null;
  createdAt: Date;
};

/**
 * Every document on a dispute, oldest first.
 *
 * `field` is narrowed on the way out. It is plain text in the column — Postgres
 * has no reason to know Stripe's field names — but a row whose field is not one
 * Stripe accepts must never reach a submission, where it would fail the whole
 * update. A value that is not a file field is dropped here rather than trusted.
 */
export async function evidenceFilesFor(
  disputeId: string,
): Promise<EvidenceFileRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(disputeEvidenceFiles)
    .where(eq(disputeEvidenceFiles.disputeId, disputeId))
    .orderBy(asc(disputeEvidenceFiles.createdAt));

  return rows.flatMap((row) =>
    isFileField(row.field)
      ? [
          {
            id: row.id,
            field: row.field,
            stripeFileId: row.stripeFileId,
            filename: row.filename,
            contentType: row.contentType,
            bytes: row.bytes,
            uploadedBy: row.uploadedBy,
            createdAt: row.createdAt,
          },
        ]
      : [],
  );
}

/**
 * The same rows in the shape `assembleEvidence` takes: field to Stripe file id.
 *
 * This is the value that used to be a hardcoded `{}` in `holdings.ts`, and the
 * reason every file field was permanently reported as an outstanding ask.
 */
export async function evidenceFileIdsFor(
  disputeId: string,
): Promise<Partial<Record<EvidenceFileField, string>>> {
  const rows = await evidenceFilesFor(disputeId);
  return Object.fromEntries(rows.map((row) => [row.field, row.stripeFileId]));
}

/** What the set weighs, and how close it is to the ceiling. */
export function evidenceBudget(rows: readonly EvidenceFileRow[]) {
  return budgetPressure(rows.map(toHeld));
}

function toHeld(row: EvidenceFileRow): HeldFile {
  return { field: row.field, bytes: row.bytes, filename: row.filename };
}

export type AttachResult =
  | { ok: true; replaced: string | null; remainingBytes: number }
  | { ok: false; error: string };

/**
 * Add a document to a dispute, or replace the one on that field.
 *
 * Refuses after the evidence has gone. Stripe accepts one submitted response per
 * dispute and ignores anything attached afterwards, so an upload at that point
 * is not merely useless — it tells a seller staring at a lost case that they have
 * supplied what was missing, which is the most expensive lie this surface could
 * tell.
 */
export async function attachEvidenceFile(opts: {
  disputeId: string;
  field: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  uploadedBy: string;
}): Promise<AttachResult> {
  if (!isFileField(opts.field)) {
    return { ok: false, error: "That is not an evidence document Stripe accepts." };
  }
  const field = opts.field;

  const db = getDb();
  const dispute = await db.query.disputes.findFirst({
    where: eq(disputes.id, opts.disputeId),
  });
  if (!dispute) return { ok: false, error: "That dispute no longer exists." };

  if (dispute.evidenceSubmittedAt) {
    return {
      ok: false,
      error:
        "The answer has already been sent. Stripe takes one response per dispute, " +
        "so nothing attached now would be read.",
    };
  }

  const held = await evidenceFilesFor(opts.disputeId);

  /*
   * The ceiling is checked before the upload and against the whole set. Doing it
   * after would leave a permanent, unreferenced file on the account for every
   * document that did not fit — Stripe's Files API has no delete.
   */
  const verdict = acceptEvidenceFile(
    { field, bytes: opts.bytes.byteLength, contentType: opts.contentType },
    held.map(toHeld),
  );
  if (!verdict.ok) return { ok: false, error: verdict.message };

  const uploaded = await uploadEvidenceFile({
    /*
     * The dispute's own account, always. A file uploaded to the platform is
     * invisible to a connected account's `disputes.update`, and the error names
     * the evidence field rather than the file — so a mistake here looks like a
     * bug in the assembler.
     */
    accountId: dispute.stripeAccountId,
    filename: opts.filename,
    contentType: opts.contentType,
    bytes: opts.bytes,
  });
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  /*
   * One row per field, by upsert. The unique index is what makes a second
   * document on the same field a replacement rather than a silent second row
   * that would submit one and drop the other.
   */
  await db
    .insert(disputeEvidenceFiles)
    .values({
      disputeId: opts.disputeId,
      field,
      stripeFileId: uploaded.file.stripeFileId,
      filename: uploaded.file.filename,
      contentType: uploaded.file.contentType,
      bytes: uploaded.file.bytes,
      uploadedBy: opts.uploadedBy,
    })
    .onConflictDoUpdate({
      target: [disputeEvidenceFiles.disputeId, disputeEvidenceFiles.field],
      set: {
        stripeFileId: uploaded.file.stripeFileId,
        filename: uploaded.file.filename,
        contentType: uploaded.file.contentType,
        bytes: uploaded.file.bytes,
        uploadedBy: opts.uploadedBy,
        createdAt: new Date(),
      },
    });

  return {
    ok: true,
    replaced: verdict.replaces?.filename ?? null,
    /*
     * Recomputed from Stripe's byte count rather than taken from the verdict,
     * which was calculated from the caller's. They agree in practice; where they
     * would not, the ceiling is measured against Stripe's.
     */
    remainingBytes: evidenceBudget(await evidenceFilesFor(opts.disputeId))
      .remainingBytes,
  };
}

/**
 * Take a document off a dispute.
 *
 * Deletes the row and leaves the upload on Stripe, because Stripe has no delete
 * and because the record of what was once attached to a case is worth keeping.
 * What matters is that it is no longer read at submission, and that is what the
 * row controls.
 */
export async function detachEvidenceFile(opts: {
  disputeId: string;
  field: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isFileField(opts.field)) {
    return { ok: false, error: "That is not an evidence document Stripe accepts." };
  }

  const db = getDb();
  const dispute = await db.query.disputes.findFirst({
    where: eq(disputes.id, opts.disputeId),
  });
  if (!dispute) return { ok: false, error: "That dispute no longer exists." };
  if (dispute.evidenceSubmittedAt) {
    return {
      ok: false,
      error: "The answer has already been sent — what was submitted cannot be withdrawn.",
    };
  }

  await db
    .delete(disputeEvidenceFiles)
    .where(
      and(
        eq(disputeEvidenceFiles.disputeId, opts.disputeId),
        eq(disputeEvidenceFiles.field, opts.field),
      ),
    );
  return { ok: true };
}

/**
 * A link to look at one of the documents.
 *
 * Generated on demand and short-lived — see `evidenceFileUrl`. Null where the
 * dispute or the row has gone, so a broken preview cannot take down the page
 * carrying the deadline.
 */
export async function evidenceFileLink(opts: {
  disputeId: string;
  field: string;
}): Promise<string | null> {
  const db = getDb();
  const dispute = await db.query.disputes.findFirst({
    where: eq(disputes.id, opts.disputeId),
  });
  if (!dispute) return null;

  const [row] = await db
    .select()
    .from(disputeEvidenceFiles)
    .where(
      and(
        eq(disputeEvidenceFiles.disputeId, opts.disputeId),
        eq(disputeEvidenceFiles.field, opts.field),
      ),
    )
    .limit(1);
  if (!row) return null;

  return evidenceFileUrl(row.stripeFileId, dispute.stripeAccountId);
}
