import "server-only";
import type { PackDocument, PackSection } from "@sailo/core/disputes";
import {
  INK,
  MARGIN,
  MUTED,
  body,
  caption,
  contentWidth,
  footer,
  newPdf,
  pageBreakIfNeeded,
  rule,
  type Pdf,
} from "./pdf-kit";

/**
 * The most pages a generated document may reach.
 *
 * ─── MEASURED AGAINST THE LIVE API IN TEST MODE, 19 AUGUST 2026 ────────────
 *
 * The Files API **enforces** a page ceiling and refuses the upload outright:
 * *"The file you uploaded was too long. Please upload a file with fewer than 50
 * pages."* `PAGE_GUIDANCE` in `@sailo/core/disputes` described that as advice
 * carried rather than enforced, which was read off Stripe's own best-practices
 * page and is wrong at the API.
 *
 * It matters because the failure is silent in the direction that costs a case: a
 * refused upload leaves `autoFillEvidence` with nothing to register, so the
 * evidence slot the seller believed was handled simply stays empty. A pack built
 * from a real seller's terms reached **98 pages** in a measurement.
 *
 * Forty, not forty-nine. The count is checked before each block rather than
 * after, so a section that runs long must have somewhere to land — and a
 * document that stops nine pages early is a document that uploads.
 */
const MAX_PACK_PAGES = 40;

/**
 * Rendering an evidence document. Spec 45.
 *
 * The *content* — which sections, in what order, from what facts, with what
 * provenance — is `@sailo/core/disputes/pack.ts`, which is pure and tested from
 * object literals. This is the positional half, and it lives beside
 * `invoice-pdf.ts` because that is where positional layout belongs.
 *
 * ─── WHAT THE LAYOUT IS FOR ────────────────────────────────────────────────
 *
 * An adjudicator reads thousands of these. Stripe's own guidance is that burying
 * the argument loses cases a shorter one wins, so the shape is: a heading, then
 * label/value pairs with the provenance under each in smaller type, then any log
 * as plain lines. No tables, no colour beyond two greys, nothing to decode.
 *
 * ─── AND WHAT IT DELIBERATELY LACKS ────────────────────────────────────────
 *
 * No images, no embedded fonts beyond pdfkit's built-in Helvetica, no logo.
 * Every byte comes out of a 4.5 MB budget shared with the seller's own carrier
 * documents, and a shop's logo is the least persuasive kilobyte on the page.
 *
 * Deterministic: nothing here reads a clock. `renderedAt` is passed in, which is
 * what makes "re-render the case exactly" true rather than approximate.
 */

export async function renderEvidenceDocument(opts: {
  document: PackDocument;
  /** The shop's trading name, for the footer. Never a logo. */
  shopName: string;
  /** Passed in — see the header. */
  renderedAt: Date;
  packVersion: string;
}): Promise<Buffer> {
  const { doc, bytes } = newPdf({ createdAt: opts.renderedAt });
  const width = contentWidth(doc);
  let y = MARGIN;

  y = body(doc, opts.document.title, MARGIN, y, width, { bold: true, size: 16 });
  y += 4;
  y = body(
    doc,
    `Prepared by Sailo for ${opts.shopName}. Rendered ${opts.renderedAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 19)} UTC.`,
    MARGIN,
    y,
    width,
    { color: MUTED, size: 8 },
  );
  y += 6;
  y = rule(doc, y) + 14;

  /*
   * The sentence that makes the rest readable as evidence.
   *
   * Every value below either states a fact Sailo recorded or says "Not on
   * record", and every one carries where it came from. Saying so at the top is
   * what lets an adjudicator weigh a "marked delivered by the seller" line for
   * what it is rather than for what it looks like.
   */
  y = body(
    doc,
    "Every line below is either a fact recorded by Sailo at the time it happened, with its source " +
      "stated, or the words “Not on record”. Nothing here is inferred, and nothing is " +
      "restated from a later edit.",
    MARGIN,
    y,
    width,
    { color: MUTED, size: 8 },
  );
  y += 16;

  let truncated = false;
  for (const section of opts.document.sections) {
    if (doc.bufferedPageRange().count >= MAX_PACK_PAGES) {
      truncated = true;
      break;
    }
    const result = renderSection(doc, section, y, width);
    y = result.y;
    if (result.truncated) {
      truncated = true;
      break;
    }
  }

  if (truncated) {
    /*
     * Stated, never silent. A document that stops without saying so is one an
     * adjudicator reads as the whole record — which is the same failure a capped
     * log without its caption would be, and the reason `entriesCapped` exists.
     */
    y = pageBreakIfNeeded(doc, y, 40);
    body(
      doc,
      "This document was shortened to stay inside the card networks' page limit for " +
        "submitted evidence. The remainder is on record and can be produced on request.",
      MARGIN,
      y + 8,
      width,
      { color: MUTED, size: 8 },
    );
  }

  footer(doc, `${opts.shopName} · Sailo evidence pack ${opts.packVersion}`);
  doc.end();
  return bytes;
}

function renderSection(
  doc: Pdf,
  section: PackSection,
  startY: number,
  width: number,
): { y: number; truncated: boolean } {
  /** True once the page ceiling is reached — see `MAX_PACK_PAGES`. */
  const full = () => doc.bufferedPageRange().count >= MAX_PACK_PAGES;

  let y = pageBreakIfNeeded(doc, startY, 90);

  y = body(doc, section.title, MARGIN, y, width, { bold: true, size: 11 });
  y += 2;

  if (section.note) {
    y = body(doc, section.note, MARGIN, y, width, { color: MUTED, size: 8 });
    y += 2;
  }

  y = rule(doc, y + 4) + 8;

  const labelWidth = 150;
  const valueX = MARGIN + labelWidth + 10;
  const valueWidth = width - labelWidth - 10;

  for (const entry of section.lines) {
    if (full()) return { y, truncated: true };
    const broke = y;
    y = pageBreakIfNeeded(doc, y, 44);
    /*
     * A heading that stayed on the previous page is a heading that is not on
     * this one, and the first line under it then reads as belonging to whatever
     * came before. On a document an adjudicator scans rather than reads, an
     * orphaned "ADDRESS THE ORDER CAME FROM" at the top of page two is a fact
     * with no section attached — so the title is repeated, marked continued.
     */
    if (y !== broke) y = continuedHeading(doc, section.title, y, width);

    caption(doc, entry.label, MARGIN, y, labelWidth);

    let bottom = body(doc, entry.value, valueX, y, valueWidth, {
      /*
       * The gap is muted and the fact is not. An adjudicator scanning the column
       * should see at a glance which lines carry something, and a "Not on
       * record" set in the same ink as a tracking number reads as a value.
       */
      color: entry.value === "Not on record" ? MUTED : INK,
      size: 10,
    });

    if (entry.provenance) {
      bottom = body(doc, entry.provenance, valueX, bottom + 1, valueWidth, {
        color: MUTED,
        size: 8,
      });
    }

    y = bottom + 8;
  }

  if (section.entries && section.entries.length > 0) {
    y = pageBreakIfNeeded(doc, y, 40) + 4;
    for (const entry of section.entries) {
      if (full()) return { y, truncated: true };
      const broke = y;
      y = pageBreakIfNeeded(doc, y, 20);
      if (y !== broke) y = continuedHeading(doc, section.title, y, width);
      y = body(doc, entry, MARGIN, y, width, { size: 8, color: INK }) + 2;
    }
  }

  if (section.entriesCapped) {
    /*
     * Stated, always. A silent truncation reads as "this is all of it", which is
     * the one thing a log in an evidence document must never imply.
     */
    y = pageBreakIfNeeded(doc, y, 24);
    y =
      body(
        doc,
        `Showing the first ${section.entriesCapped.shown} of ${section.entriesCapped.total} entries. ` +
          "The remainder are on record and can be produced on request.",
        MARGIN,
        y + 4,
        width,
        { color: MUTED, size: 8 },
      ) + 2;
  }

  return { y: y + 18, truncated: false };
}

/** The section's own title again, at the top of a page it ran onto. */
function continuedHeading(doc: Pdf, title: string, y: number, width: number): number {
  const after = body(doc, `${title} (continued)`, MARGIN, y, width, {
    bold: true,
    size: 11,
  });
  return rule(doc, after + 4) + 8;
}
