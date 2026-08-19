import "server-only";
import PDFDocument from "pdfkit";

/**
 * The primitives both PDFs are drawn with.
 *
 * Extracted from `invoice-pdf.ts` for spec 45, and extracted *narrowly*: the
 * colours, the margin, the page factory and four helpers. Nothing about the
 * invoice's layout came with them.
 *
 * That restraint is deliberate and it is the spec's own instruction. Each
 * section of `invoice-pdf.ts` depends on the `y` the last one left — 367
 * positional lines that `PRODUCTION-PLAN.md` §4 rules "leave whole" — so pulling
 * its *structure* out to share would mean rewriting the one document in the
 * product that a tax authority reads, in order to add a second one. What is
 * shared is the vocabulary; what stays is the sentence.
 *
 * pdfkit's built-in Helvetica throughout, so nothing has to be bundled and this
 * runs unchanged on serverless — and so a generated evidence document carries no
 * embedded font, which matters when every byte is coming out of a 4.5 MB budget
 * shared with the seller's own uploads.
 */

export const INK = "#1a1a20";
export const MUTED = "#6d6d7d";
export const LINE = "#e6e6ea";
export const MARGIN = 50;

export type Pdf = InstanceType<typeof PDFDocument>;

/**
 * A fresh A4 document, and the promise of its bytes.
 *
 * The buffer is collected here rather than by each caller because getting it
 * wrong is silent: a renderer that resolves before `end` fires returns a
 * truncated PDF, which opens in some viewers and not in others.
 */
export function newPdf(opts: { createdAt?: Date } = {}): {
  doc: Pdf;
  bytes: Promise<Buffer>;
} {
  /*
   * `bufferPages` so the footer can be drawn on *every* page.
   *
   * Without it pdfkit flushes each page as it is finished, and a footer written
   * after the last section lands only on the last page — which is what a first
   * render of the evidence pack actually did. On a document that goes to a card
   * network, a page with no identifying line on it is a page an adjudicator
   * cannot tell belongs to the case.
   */
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    bufferPages: true,
    /*
     * `CreationDate` pinned to the caller's clock, and this is not cosmetic.
     *
     * pdfkit stamps `D:<now>` into the Info dictionary by default, so two
     * renders of the same order one second apart differ in the file — which
     * spec 45 forbids in as many words: *same inputs → byte-identical PDF*, so
     * that "re-render the case exactly" is true rather than approximate. A
     * scenario test caught it, and it would otherwise have been discovered as
     * two evidence packs of one order that do not match.
     *
     * Defaulted to the epoch rather than to `new Date()`: a caller that forgets
     * to pass one gets a document that is *wrong about its date* and
     * deterministic, which is loud, instead of one that is right and silently
     * unreproducible.
     */
    info: { CreationDate: opts.createdAt ?? new Date(0) },
  });
  const chunks: Buffer[] = [];

  const bytes = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  return { doc, bytes };
}

/** The usable width between the margins. */
export function contentWidth(doc: Pdf): number {
  return doc.page.width - MARGIN * 2;
}

/** A small uppercase caption — the label above a value. */
export function caption(doc: Pdf, text: string, x: number, y: number, width: number): number {
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(MUTED)
    .text(text.toUpperCase(), x, y, { width, characterSpacing: 0.5 });
  return doc.y;
}

/** Body text, at the size the invoice sets its detail lines in. */
export function body(
  doc: Pdf,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: { bold?: boolean; color?: string; size?: number } = {},
): number {
  doc
    .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(opts.size ?? 9)
    .fillColor(opts.color ?? INK)
    .text(text, x, y, { width });
  return doc.y;
}

/** A hairline across the content width. */
export function rule(doc: Pdf, y: number): number {
  doc
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .strokeColor(LINE)
    .lineWidth(1)
    .stroke();
  return y + 1;
}

/**
 * Start a new page when `needed` points will not fit below `y`.
 *
 * Returns the y to keep drawing from. Every long section calls it: a document
 * assembled from a two-hundred-line download log has no idea in advance how
 * many pages it is, and a section that runs off the bottom of page one is
 * evidence nobody can read.
 */
export function pageBreakIfNeeded(doc: Pdf, y: number, needed = 60): number {
  if (y + needed < doc.page.height - MARGIN) return y;
  doc.addPage();
  return MARGIN;
}

/**
 * The line at the foot of **every** page: who, what, and page n of m.
 *
 * Called once, after the last section, and it walks the buffered pages — which
 * is the only way to know how many there were. The page number is not
 * decoration here: an evidence pack arrives at an issuer as a detached PDF among
 * several, and "3 of 5" is what tells a reader whether they have the whole
 * document.
 *
 * `flushPages` afterwards, because a buffered document that is never flushed
 * writes nothing.
 */
export function footer(doc: Pdf, text: string): void {
  const range = doc.bufferedPageRange();

  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#b8b8c2")
      .text(
        `${text} · page ${index + 1} of ${range.count}`,
        MARGIN,
        doc.page.height - MARGIN - 10,
        { width: contentWidth(doc), align: "center" },
      );
  }

  doc.flushPages();
}
