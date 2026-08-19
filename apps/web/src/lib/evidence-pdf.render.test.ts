import { writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { packDocuments, type PackHoldings } from "@sailo/core/disputes";
import { renderEvidenceDocument } from "./evidence-pdf";

/**
 * Render a real pack, and check what is actually on the page.
 *
 * `PRODUCTION-PLAN.md`'s rule — render it and read the visible text — applies to
 * a document more than to a page: a PDF that compiles and lays out wrongly
 * passes every content test in `packages/core`, because those assert the
 * *sections* and this is the only thing that asserts the *bytes*.
 *
 * The extraction below is deliberately crude. It pulls the text-showing
 * operators straight out of the content stream rather than parsing the PDF,
 * which is enough to answer the two questions that matter — is the argument on
 * the page, and did anything Sailo does not hold get printed as though it did —
 * without adding a PDF parser to the dependency tree for one test.
 *
 * `SAILO_PACK_OUT=/tmp/pack.pdf` writes the file out so a human can open it.
 */

const RENDERED = new Date("2026-08-19T12:00:00.000Z");

const holdings: PackHoldings = {
  orderReference: "8f2c1d94-0000-4000-8000-000000000001",
  placedAt: new Date("2026-08-01T09:15:00.000Z"),
  kind: "digital",
  currency: "usd",
  totalCents: 4200,
  productDescription: "1 x Lightroom Preset Pack (SKU LR-01)",
  statementDescriptor: "ADAS CERAMICS",
  shopName: "Ada's Ceramics",
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
  billingAddress: "12 Bridge Street, Lisbon, 1200-433, PT",
  shippingAddress: null,
  buyerIp: "203.0.113.7",
  buyerUserAgent: "Mozilla/5.0 (Macintosh)",
  cardBrand: "visa",
  cardLast4: "4242",
  invoiceNumber: "INV-0007",
  invoiceIssuedAt: new Date("2026-08-01T09:16:00.000Z"),
  termsAcceptedAt: new Date("2026-08-01T09:14:50.000Z"),
  policyText: "Refunds are available within 14 days of delivery.",
  policyCapturedAt: new Date("2026-07-20T00:00:00.000Z"),
  policySource: "shop_page",
  policySourceUrl: null,
  shippingCarrier: null,
  shippingTrackingNumber: null,
  shippingTrackingUrl: null,
  shippedAt: null,
  deliveredAt: null,
  deliveredSource: null,
  deliverySignedBy: null,
  scheduledFor: null,
  serviceLocation: null,
  serviceCompletedAt: null,
  ticketCode: null,
  ticketUsedAt: null,
  ticketCheckedInBy: null,
  membershipStatus: null,
  membershipPeriodEnd: null,
  checkIns: [],
  renewalInvoices: [],
  downloads: [
    { at: new Date("2026-08-01T09:20:00.000Z"), ip: "203.0.113.7", fileName: "presets.zip" },
    { at: new Date("2026-08-03T18:02:00.000Z"), ip: "198.51.100.4", fileName: "guide.pdf" },
  ],
  downloadReleasedAt: new Date("2026-08-01T09:16:05.000Z"),
  messages: [
    {
      at: new Date("2026-08-01T09:16:10.000Z"),
      kind: "confirmation",
      direction: "outbound",
      toAddress: "ada@example.com",
      subject: "Your order",
      bodyText: "Thanks",
      status: "delivered",
    },
  ],
  refundedCents: 0,
  refundedAt: null,
  renderedAt: RENDERED,
};

/**
 * Every string pdfkit actually wrote onto the page, in order.
 *
 * Three things had to be handled, and each was a way this test could have passed
 * while asserting nothing:
 *
 *   - the content streams are **deflated**, so the text is not in the file as
 *     text and a naive `toString` finds none of it;
 *   - pdfkit emits `[<hex> kern <hex>] TJ` arrays rather than `(literal) Tj`,
 *     because it kerns — so a `Tj` matcher finds zero strings on a page full of
 *     them;
 *   - the hex is UTF-16BE for the built-in fonts' subset encoding, which is
 *     why the bytes are read two at a time.
 *
 * Crude on purpose. It answers the two questions that matter — is the argument
 * on the page, and did anything Sailo does not hold get printed as though it did
 * — without adding a PDF parser to the tree for one test.
 */
function visibleText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const pieces: string[] = [];

  for (const stream of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(stream[1] ?? "", "latin1")).toString("latin1");
    } catch {
      // An uncompressed stream — a font descriptor, usually. Nothing to read.
      continue;
    }

    for (const show of content.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      const run = show[1] ?? "";
      let text = "";
      for (const chunk of run.matchAll(/<([0-9a-fA-F]+)>|\(((?:\\.|[^\\()])*)\)/g)) {
        if (chunk[1]) {
          const hex = chunk[1];
          for (let i = 0; i + 1 < hex.length; i += 2) {
            text += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
          }
        } else if (chunk[2] !== undefined) {
          text += chunk[2].replace(/\\([()\\])/g, "$1");
        }
      }
      pieces.push(text);
    }
  }

  return pieces.join("\n");
}

async function render(over: Partial<PackHoldings> = {}): Promise<string> {
  const h = { ...holdings, ...over };
  const [pack] = packDocuments(h);
  const bytes = await renderEvidenceDocument({
    document: pack!,
    shopName: h.shopName,
    renderedAt: RENDERED,
    packVersion: "2026-08",
  });
  if (process.env.SAILO_PACK_OUT && Object.keys(over).length === 0) {
    writeFileSync(process.env.SAILO_PACK_OUT, bytes);
  }
  return visibleText(bytes);
}

describe("the rendered pack", () => {
  it("puts the argument on the page", async () => {
    const text = await render();

    expect(text).toContain("Evidence pack");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("ada@example.com");
    expect(text).toContain("203.0.113.7");
    expect(text).toContain("INV-0007");
    expect(text).toContain("ADAS CERAMICS");
    // The download log, which on a digital sale is the whole case.
    expect(text).toContain("presets.zip");
    expect(text).toContain("198.51.100.4");
    // And the policy as it stood.
    expect(text).toContain("Refunds are available within 14 days");
  });

  it("prints a card as brand and last four, and nothing else", async () => {
    const text = await render();
    expect(text).toContain("ending 4242");
    expect(text).not.toMatch(/4242\s*4242/);
  });

  it("says 'Not on record' where Sailo holds nothing", async () => {
    const text = await render({
      buyerIp: null,
      statementDescriptor: null,
      invoiceNumber: null,
      customerEmail: null,
    });
    expect(text).toContain("Not on record");
    /*
     * And nothing turned into the word "undefined" on the way to the page,
     * which is the failure this whole feature is written against.
     */
    expect(text).not.toContain("undefined");
  });

  it("prints a seller's tick as a seller's tick", async () => {
    const text = await render({
      kind: "physical",
      shippedAt: new Date("2026-08-02T00:00:00.000Z"),
      deliveredAt: new Date("2026-08-05T00:00:00.000Z"),
      deliveredSource: "seller",
      shippingCarrier: "DHL",
      shippingTrackingNumber: "JD0002",
    });
    expect(text).toContain("Marked delivered by the seller");
    expect(text).toContain("No carrier confirmation");
  });

  it("renders every kind without throwing, however empty the order", async () => {
    // No invoice, no messages, no policy snapshot, no delivery — the ordinary
    // case for a shop that has just started.
    for (const kind of ["physical", "digital", "service", "event", "membership"] as const) {
      const text = await render({
        kind,
        invoiceNumber: null,
        invoiceIssuedAt: null,
        policyText: null,
        termsAcceptedAt: null,
        messages: [],
        downloads: [],
        downloadReleasedAt: null,
        shippedAt: null,
        deliveredAt: null,
        deliveredSource: null,
      });
      expect(text.length, kind).toBeGreaterThan(200);
      expect(text, kind).toContain("Not on record");
    }
  });

  it("renders the same bytes twice", async () => {
    /*
     * The property that makes "re-render the case exactly" true. pdfkit stamps
     * no creation date of its own here — the only clock in the document is the
     * `renderedAt` passed in.
     */
    const h = { ...holdings };
    const [pack] = packDocuments(h);
    const one = await renderEvidenceDocument({
      document: pack!,
      shopName: h.shopName,
      renderedAt: RENDERED,
      packVersion: "2026-08",
    });
    const two = await renderEvidenceDocument({
      document: pack!,
      shopName: h.shopName,
      renderedAt: RENDERED,
      packVersion: "2026-08",
    });
    /*
     * **Byte** identity, not merely the same words. pdfkit stamps `CreationDate`
     * from the wall clock by default, so an earlier version of this passed on
     * `visibleText` while the files differed one second apart — which is exactly
     * the failure spec 45 forbids: *same inputs, byte-identical PDF*.
     */
    expect(one.equals(two)).toBe(true);
    expect(visibleText(one)).toBe(visibleText(two));
  });

  it("never exceeds the page ceiling the Files API enforces", async () => {
    /*
     * Measured against the live API in test mode on 19 August 2026: an upload of
     * more than 50 pages is refused with a 400, not merely discouraged. A pack
     * built from a real seller's terms reached 98 pages before this cap, and the
     * refusal would have left the evidence slot silently empty.
     */
    const long = Array.from({ length: 6_000 }, (_, i) => `Clause ${i}.`).join("\n");
    const [pack] = packDocuments({ ...holdings, policyText: long });
    const bytes = await renderEvidenceDocument({
      document: pack!,
      shopName: holdings.shopName,
      renderedAt: RENDERED,
      packVersion: "2026-08",
    });

    const pages = (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeLessThan(50);

    /*
     * And the shortening is *stated*. `PACK_POLICY_LINE_CAP` does the work here
     * — 6,000 clauses become 600 and eleven pages — so the caption is the
     * section's own, not the renderer's last-resort note. A document that stops
     * without saying so reads to an adjudicator as the whole record.
     */
    expect(visibleText(bytes)).toContain("Showing the first 600 of 6000 entries");
  });

  it("stays small enough to matter inside the 4.5 MB budget", async () => {
    const [pack] = packDocuments(holdings);
    const bytes = await renderEvidenceDocument({
      document: pack!,
      shopName: holdings.shopName,
      renderedAt: RENDERED,
      packVersion: "2026-08",
    });
    // No images, no embedded fonts: a pack should be tens of kilobytes, not
    // hundreds, because every one comes out of a budget shared with a seller's
    // own carrier scan.
    expect(bytes.byteLength).toBeLessThan(120_000);
  });
});
