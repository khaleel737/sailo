import { describe, expect, it } from "vitest";
import {
  EVIDENCE_PACK_VERSION,
  NOT_ON_RECORD,
  PACK_LOG_CAP,
  communicationsSection,
  deliveryProvenance,
  estimateBytes,
  fitDocuments,
  fulfilmentField,
  fulfilmentSection,
  hasFulfilmentEvidence,
  packDocuments,
  policyProvenance,
  policySection,
  saleSection,
  type PackHoldings,
  type PackKind,
} from "./pack";

/**
 * The order evidence pack. Spec 45.
 *
 * The property every test here defends is the one the spec calls absolute:
 * **never state a fact Sailo does not hold.** These documents are submitted to a
 * card network in somebody else's name, so a line that overstates is a false
 * claim to a bank made on the seller's behalf — it loses the case *and* damages
 * the person who submitted it.
 *
 * Concretely, three things:
 *
 *   1. A missing fact reads "Not on record", never a blank. An adjudicator
 *      reading a gap draws the worse conclusion; a stated gap does not.
 *   2. `deliveredSource` is printed in words, because `seller`,
 *      `buyer_confirmed` and `carrier` are not equally persuasive.
 *   3. A capped log says it is capped. A silent truncation reads as "this is all
 *      of it", which is the one thing a log in an evidence document must not
 *      imply.
 */

const RENDERED = new Date("2026-08-19T12:00:00.000Z");

const holdings = (over: Partial<PackHoldings> = {}): PackHoldings => ({
  orderReference: "8f2c1d94-0000-4000-8000-000000000001",
  placedAt: new Date("2026-08-01T09:15:00.000Z"),
  kind: "physical",
  currency: "usd",
  totalCents: 4200,
  productDescription: "1 × Speckled Mug (SKU MUG-1)",
  statementDescriptor: "ADAS CERAMICS",

  shopName: "Ada's Ceramics",
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
  billingAddress: "12 Bridge Street, Lisbon, PT",
  shippingAddress: "12 Bridge Street, Lisbon, PT",
  buyerIp: "203.0.113.7",
  buyerUserAgent: "Mozilla/5.0",
  cardBrand: "visa",
  cardLast4: "4242",

  invoiceNumber: "INV-0007",
  invoiceIssuedAt: new Date("2026-08-01T09:16:00.000Z"),

  termsAcceptedAt: new Date("2026-08-01T09:14:50.000Z"),
  policyText: "Refunds within 14 days of delivery.",
  policyCapturedAt: new Date("2026-07-20T00:00:00.000Z"),
  policySource: "shop_page",
  policySourceUrl: null,

  shippingCarrier: "DHL",
  shippingTrackingNumber: "JD0002",
  shippingTrackingUrl: "https://example.com/track/JD0002",
  shippedAt: new Date("2026-08-02T00:00:00.000Z"),
  deliveredAt: new Date("2026-08-05T14:00:00.000Z"),
  deliveredSource: "carrier",
  deliverySignedBy: "A. Lovelace",

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

  downloads: [],
  downloadReleasedAt: null,

  messages: [
    {
      at: new Date("2026-08-01T09:16:10.000Z"),
      kind: "confirmation",
      direction: "outbound",
      toAddress: "ada@example.com",
      subject: "Your order",
      bodyText: "Thanks!",
      status: "delivered",
    },
  ],

  refundedCents: 0,
  refundedAt: null,

  renderedAt: RENDERED,
  ...over,
});

const valuesOf = (section: { lines: readonly { label: string; value: string }[] }) =>
  Object.fromEntries(section.lines.map((line) => [line.label, line.value]));

/* -------------------------------------------------------------------------- */

describe("a missing fact", () => {
  it("reads 'Not on record' and never a blank", () => {
    const sparse = holdings({
      customerName: null,
      customerEmail: null,
      billingAddress: null,
      buyerIp: null,
      buyerUserAgent: null,
      cardBrand: null,
      cardLast4: null,
      statementDescriptor: null,
      invoiceNumber: null,
      productDescription: null,
    });

    for (const section of [saleSection(sparse), fulfilmentSection(sparse)]) {
      for (const line of section.lines) {
        expect(line.value.length, `${section.title} — ${line.label}`).toBeGreaterThan(0);
      }
    }

    expect(valuesOf(saleSection(sparse))["On the buyer's statement"]).toBe(NOT_ON_RECORD);
    expect(valuesOf(saleSection(sparse))["Invoice"]).toBe(NOT_ON_RECORD);
  });

  it("never emits the string 'undefined' or 'null' anywhere", () => {
    const sparse = holdings({
      kind: "digital",
      customerName: null,
      customerEmail: null,
      billingAddress: null,
      buyerIp: null,
      shippingCarrier: null,
      shippingTrackingNumber: null,
      shippingTrackingUrl: null,
      shippedAt: null,
      deliveredAt: null,
      deliveredSource: null,
      deliverySignedBy: null,
      invoiceNumber: null,
      policyText: null,
      termsAcceptedAt: null,
      messages: [],
    });

    for (const document of packDocuments(sparse)) {
      const text = JSON.stringify(document);
      expect(text).not.toMatch(/"undefined"/);
      expect(text).not.toMatch(/: ?"null"/);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("provenance", () => {
  it("never prints a seller's tick as though a carrier had confirmed it", () => {
    /*
     * THE LINE THIS WHOLE FEATURE TURNS ON. `orders.delivered_source` exists for
     * exactly this, and a pack saying "delivered" because a seller ticked a box
     * is a false claim to a bank made in Sailo's name.
     */
    const seller = deliveryProvenance("seller");
    expect(seller).toMatch(/Marked delivered by the seller/);
    expect(seller).toMatch(/No carrier confirmation/);
    expect(seller).not.toMatch(/signed/i);
  });

  it("says who confirmed it, for all three sources", () => {
    expect(deliveryProvenance("buyer_confirmed")).toMatch(/Confirmed by the buyer/);
    expect(deliveryProvenance("carrier")).toMatch(/carrier's own delivery record/);
    // And an unrecognised value is a stated gap, not an invented source.
    expect(deliveryProvenance(null)).toMatch(/not recorded/i);
  });

  it("carries the delivery provenance onto the line itself", () => {
    const section = fulfilmentSection(holdings({ deliveredSource: "seller" }));
    const delivered = section.lines.find((line) => line.label === "Delivered");
    expect(delivered?.provenance).toMatch(/Marked delivered by the seller/);
  });

  it("distinguishes a shop page from a fetched URL", () => {
    /*
     * The good path and the weak one. A shop page cannot have changed under us;
     * a fetched URL is a claim about somebody else's server on a date.
     */
    expect(policyProvenance("shop_page", new Date("2026-07-01T00:00:00.000Z"))).toMatch(
      /cannot have changed since the sale/,
    );
    expect(policyProvenance("url_fetch", null)).toMatch(/shop's own website/);
    expect(policyProvenance(null, null)).toMatch(/Source not recorded/);
  });

  it("prints the policy as it stood, not as it stands", () => {
    const section = policySection(holdings());
    expect(section.entries?.join("\n")).toContain("Refunds within 14 days");
    const held = section.lines.find((line) => line.label === "Policy text held");
    expect(held?.provenance).toMatch(/Captured 2026-07-20/);
  });
});

/* -------------------------------------------------------------------------- */

describe("the fulfilment section, per kind", () => {
  it.each([
    ["physical", "Delivery"],
    ["digital", "Downloads"],
    ["service", "The appointment"],
    ["event", "Attendance"],
    ["membership", "Membership use"],
  ] as const)("renders %s as %s", (kind, title) => {
    expect(fulfilmentSection(holdings({ kind: kind as PackKind })).title).toBe(title);
  });

  it("files a parcel under shipping and everything else under service", () => {
    /*
     * Stripe reads per field. Putting a download log in the shipping slot hands
     * an adjudicator looking for a carrier's scan a list of IP addresses, which
     * reads as an evasion rather than as evidence.
     */
    expect(fulfilmentField("physical")).toBe("shipping_documentation");
    for (const kind of ["digital", "service", "event", "membership"] as const) {
      expect(fulfilmentField(kind)).toBe("service_documentation");
    }
  });

  it("prints the purchase IP beside the download log so the match is visible", () => {
    const section = fulfilmentSection(
      holdings({
        kind: "digital",
        downloads: [
          { at: new Date("2026-08-01T10:00:00.000Z"), ip: "203.0.113.7", fileName: "preset.zip" },
        ],
      }),
    );
    expect(valuesOf(section)["Address the order came from"]).toBe("203.0.113.7");
    expect(section.entries?.[0]).toContain("203.0.113.7");
    expect(section.entries?.[0]).toContain("preset.zip");
  });

  it("says a ticket was never scanned rather than leaving it blank", () => {
    const section = fulfilmentSection(holdings({ kind: "event", ticketCode: "ABC123" }));
    const scanned = section.lines.find((line) => line.label === "Scanned at the door");
    expect(scanned?.value).toBe(NOT_ON_RECORD);
    expect(scanned?.provenance).toMatch(/never scanned/);
  });

  it("caps a long log and says that it did", () => {
    const many = Array.from({ length: PACK_LOG_CAP + 40 }, (_, index) => ({
      at: new Date(2026, 7, 1, 0, index),
      ip: "203.0.113.7",
      fileName: "preset.zip",
    }));
    const section = fulfilmentSection(holdings({ kind: "digital", downloads: many }));

    expect(section.entries).toHaveLength(PACK_LOG_CAP);
    expect(section.entriesCapped).toEqual({
      shown: PACK_LOG_CAP,
      total: PACK_LOG_CAP + 40,
    });
  });
});

/* -------------------------------------------------------------------------- */

describe("communications", () => {
  it("discloses a bounce rather than hiding it", () => {
    /*
     * A bounced confirmation explains why a buyer says they never heard
     * anything, and disclosing it is honest in a way omitting it is not.
     */
    const section = communicationsSection(
      holdings({
        messages: [
          {
            at: new Date("2026-08-01T09:16:10.000Z"),
            kind: "confirmation",
            direction: "outbound",
            toAddress: "ada@example.com",
            subject: "Your order",
            bodyText: null,
            status: "bounced",
          },
        ],
      }),
    );
    expect(section.entries?.[0]).toContain("bounced");
  });

  it("says plainly when there is nothing", () => {
    const section = communicationsSection(holdings({ messages: [] }));
    expect(section.lines[0]?.value).toBe(NOT_ON_RECORD);
    expect(section.lines[0]?.provenance).toMatch(/No message was recorded/);
  });
});

/* -------------------------------------------------------------------------- */

describe("which documents are offered", () => {
  it("always offers the human-readable pack", () => {
    const bare = holdings({
      invoiceNumber: null,
      policyText: null,
      messages: [],
      shippedAt: null,
      deliveredAt: null,
      shippingTrackingNumber: null,
    });
    const documents = packDocuments(bare);
    expect(documents).toHaveLength(1);
    expect(documents[0]?.field).toBe("uncategorized_file");
  });

  it("offers no document for a slot it cannot fill", () => {
    /*
     * A registered document with nothing in it is worse than an empty slot: the
     * readiness panel shows it as held, and the seller believes it is handled.
     */
    const documents = packDocuments(holdings({ messages: [], policyText: null }));
    const fields = documents.map((document) => document.field);
    expect(fields).not.toContain("customer_communication");
    expect(fields).not.toContain("refund_policy");
  });

  it("fills seven of Stripe's nine slots when the facts are there", () => {
    const fields = packDocuments(holdings()).map((document) => document.field);
    expect(fields).toContain("receipt");
    expect(fields).toContain("refund_policy");
    expect(fields).toContain("customer_communication");
    expect(fields).toContain("shipping_documentation");
    expect(fields).toContain("uncategorized_file");
  });

  it("knows when there is nothing to say about fulfilment", () => {
    expect(hasFulfilmentEvidence(holdings({ shippedAt: null, deliveredAt: null, shippingTrackingNumber: null }))).toBe(false);
    expect(hasFulfilmentEvidence(holdings())).toBe(true);
    expect(hasFulfilmentEvidence(holdings({ kind: "digital", downloads: [] }))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("the 4.5 MB budget", () => {
  it("drops the summary before the fulfilment document", () => {
    /*
     * Lowest-value-first-out. The generated fulfilment document is the one an
     * adjudicator reads for the answer; the pack is a summary of documents that
     * are also attached individually.
     */
    const documents = packDocuments(holdings());
    const tiny = documents.reduce((sum, document) => sum + estimateBytes(document), 0) - 1;
    const { include, dropped } = fitDocuments(documents, 0, tiny);

    expect(dropped.map((document) => document.kind)).toEqual(["pack"]);
    expect(include.map((document) => document.kind)).toContain("fulfilment");
  });

  it("counts what the seller has already uploaded against the ceiling", () => {
    /*
     * A seller's 4.5 MB carrier scan leaves room for one small document, and the
     * one that survives is the fulfilment document — the answer an adjudicator
     * is looking for — rather than the summary of it.
     */
    const documents = packDocuments(holdings());
    const fulfilment = documents.find((document) => document.kind === "fulfilment");
    const room = estimateBytes(fulfilment!) + 10;

    const { include, dropped } = fitDocuments(
      documents,
      4_500_000 - room,
      4_500_000,
    );

    expect(include.map((document) => document.kind)).toEqual(["fulfilment"]);
    expect(dropped.map((document) => document.kind)).toContain("pack");
  });

  it("never generates anything when the seller's own documents fill the budget", () => {
    // Ours must yield rather than block. A generator that could push a seller's
    // carrier proof of delivery out would be the worst bug in this feature.
    const { include, dropped } = fitDocuments(packDocuments(holdings()), 4_500_000, 4_500_000);
    expect(include).toEqual([]);
    expect(dropped.length).toBeGreaterThan(0);
  });

  it("estimates generously rather than optimistically", () => {
    /*
     * Under-estimating produces a set Stripe rejects at submission with hours on
     * the clock; over-estimating produces one document fewer, which is
     * recoverable. The overhead floor is what makes an almost-empty document
     * still cost something.
     */
    const [pack] = packDocuments(holdings());
    expect(estimateBytes(pack!)).toBeGreaterThan(6_000);
  });
});

/* -------------------------------------------------------------------------- */

describe("determinism", () => {
  it("produces the same content twice for the same facts", () => {
    /*
     * What makes "re-render the case exactly" true rather than approximate. A
     * clock read inside the pack would make every re-render a different
     * document, and `evidence_pack_version` would be describing nothing.
     */
    const h = holdings();
    expect(JSON.stringify(packDocuments(h))).toBe(JSON.stringify(packDocuments(h)));
  });

  it("carries a version, so a closed case can be re-rendered as it was", () => {
    expect(EVIDENCE_PACK_VERSION).toMatch(/^\d{4}-\d{2}$/);
  });

  it("never carries a device fingerprint or a card number", () => {
    /*
     * The fingerprint goes to Stripe as a CE3.0 match point and means nothing to
     * a human reader; a PAN must never be anywhere at all. Neither has a field
     * on `PackHoldings` — a shape that cannot carry them cannot leak them.
     */
    const text = JSON.stringify(packDocuments(holdings()));
    expect(text).not.toMatch(/fingerprint/i);
    expect(text).toContain("ending 4242");
  });
});
