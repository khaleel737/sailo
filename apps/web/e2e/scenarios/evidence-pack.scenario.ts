import type * as payments from "@sailo/payments/disputes";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  disputeEvidenceFiles,
  disputes,
  downloadEvents,
  invoices,
  orderMessages,
  orders,
  policySnapshots,
  products,
  shops,
  user,
} from "@sailo/db/schema";

/**
 * Spec 45 — the order evidence pack, against a real database.
 *
 * The content rules are pinned in `packages/core` and the rendering is pinned by
 * `src/lib/evidence-pdf.render.test.ts`, which reads the bytes off the page.
 * What is left, and what is here, is everything that needs rows:
 *
 *   - a dispute on a digital order registers a fulfilment document carrying the
 *     download log **and the purchase IP**, so the match is visible rather than
 *     inferred;
 *   - a physical one registers tracking, and labels a seller-marked delivery as
 *     seller-marked — the line the whole feature turns on;
 *   - a seller's own proof of delivery **displaces** Sailo's generated document
 *     rather than being blocked by it;
 *   - a platform-scope dispute is refused, because there is no order behind one;
 *   - the pack renders for every kind on an order with no invoice, no messages,
 *     no policy snapshot and no delivery.
 *
 * Stripe's Files API is stubbed. It has no delete, so a scenario that uploaded
 * for real would leave an orphan on the account for every run — and what is
 * under test here is which documents are chosen and registered, not that Stripe
 * accepts a PDF.
 */

const uploads: { filename: string; bytes: number }[] = [];

vi.mock("@sailo/payments/disputes", async (importOriginal) => ({
  ...(await importOriginal<typeof payments>()),
  uploadEvidenceFile: async (opts: { filename: string; bytes: Uint8Array }) => {
    uploads.push({ filename: opts.filename, bytes: opts.bytes.byteLength });
    return {
      ok: true as const,
      file: {
        stripeFileId: `file_${crypto.randomUUID().slice(0, 12)}`,
        filename: opts.filename,
        contentType: "application/pdf",
        bytes: opts.bytes.byteLength,
      },
    };
  },
}));

const { autoFillEvidence, renderOrderPack } = await import("@/lib/evidence-pack");
const { packHoldingsForOrder, evictGeneratedFor, SAILO_UPLOADER } = await import(
  "@sailo/commerce/disputes"
);
const { packDocuments } = await import("@sailo/core/disputes");

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "pack-";
const NOW = new Date("2026-08-19T12:00:00.000Z");

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
});

beforeEach(() => {
  uploads.length = 0;
});

async function sellerShop() {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `${PREFIX}${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `${PREFIX}${userId.slice(0, 8)}`,
      name: "Ada's Ceramics",
      currency: "USD",
      isPublished: true,
      plan: "business",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

async function anOrder(shopId: string, over: Partial<typeof orders.$inferInsert> = {}) {
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      productTitle: "Speckled Mug",
      productKind: "physical",
      quantity: 1,
      unitPriceCents: 4200,
      subtotalCents: 4200,
      totalCents: 4200,
      currency: "USD",
      customerName: "Ada Lovelace",
      customerEmail: `${PREFIX}buyer-${uid().slice(0, 8)}@example.com`,
      addressLine1: "12 Bridge Street",
      city: "Lisbon",
      country: "PT",
      buyerIp: "203.0.113.7",
      buyerUserAgent: "Mozilla/5.0",
      statementDescriptor: "ADAS CERAMICS",
      paymentMethod: "card",
      paymentStatus: "paid",
      status: "confirmed",
      ...over,
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");
  return order;
}

async function aDispute(
  shopId: string,
  orderId: string | null,
  over: Partial<typeof disputes.$inferInsert> = {},
) {
  const [row] = await db
    .insert(disputes)
    .values({
      shopId,
      orderId,
      scope: "connected",
      stripeDisputeId: `dp_${uid().replace(/-/g, "").slice(0, 20)}`,
      amountCents: 4200,
      feeCents: 1500,
      deductedCents: 5700,
      currency: "usd",
      reason: "product_not_received",
      status: "needs_response",
      caseType: "chargeback",
      stripeCreatedAt: new Date(),
      dueBy: new Date(Date.now() + 5 * 86_400_000),
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: dispute was not inserted");
  return row;
}

const filesOn = (disputeId: string) =>
  db.select().from(disputeEvidenceFiles).where(eq(disputeEvidenceFiles.disputeId, disputeId));

/* ------------------------------------------------------------------------- */

describe("what a dispute auto-fills", () => {
  it("registers a digital fulfilment document with the log and the purchase IP", async () => {
    const shop = await sellerShop();
    const order = await anOrder(shop.id, { productKind: "digital" });

    await db.insert(downloadEvents).values([
      { orderId: order.id, fileName: "presets.zip", ip: "203.0.113.7" },
      { orderId: order.id, fileName: "guide.pdf", ip: "198.51.100.4" },
    ]);

    const dispute = await aDispute(shop.id, order.id);
    const filled = await autoFillEvidence({ dispute, order, shop, now: NOW });

    expect(filled.filled).toContain("service_documentation");
    expect(filled.filled).toContain("uncategorized_file");

    const rows = await filesOn(dispute.id);
    expect(rows.every((row) => row.uploadedBy === SAILO_UPLOADER)).toBe(true);

    /*
     * And the content actually carries the argument. The download log is the
     * whole case on a digital sale, and the purchase IP printed beside it is
     * what lets an adjudicator read the match rather than infer it.
     */
    const holdings = await packHoldingsForOrder(order, { shop, renderedAt: NOW });
    const fulfilment = packDocuments(holdings).find(
      (document) => document.kind === "fulfilment",
    );
    const text = JSON.stringify(fulfilment);
    expect(text).toContain("203.0.113.7");
    expect(text).toContain("presets.zip");
  });

  it("labels a seller-marked delivery as seller-marked", async () => {
    /*
     * THE LINE THIS FEATURE TURNS ON. A pack that said "delivered" because a
     * seller ticked a box would be a false claim to a bank made in Sailo's name
     * on that seller's behalf.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id, {
      trackingCarrier: "DHL",
      trackingNumber: "JD0002",
      shippedAt: new Date("2026-08-02T00:00:00.000Z"),
      deliveredAt: new Date("2026-08-05T00:00:00.000Z"),
      deliveredSource: "seller",
    });

    const holdings = await packHoldingsForOrder(order, { shop, renderedAt: NOW });
    const fulfilment = packDocuments(holdings).find(
      (document) => document.kind === "fulfilment",
    );
    const delivered = fulfilment?.sections[0]?.lines.find(
      (line) => line.label === "Delivered",
    );

    expect(delivered?.provenance).toMatch(/Marked delivered by the seller/);
    expect(delivered?.provenance).toMatch(/No carrier confirmation/);
    expect(delivered?.provenance).not.toMatch(/signed/i);

    const dispute = await aDispute(shop.id, order.id);
    const filled = await autoFillEvidence({ dispute, order, shop, now: NOW });
    expect(filled.filled).toContain("shipping_documentation");
  });

  it("prints the policy the buyer agreed to, not the shop's current text", async () => {
    const shop = await sellerShop();

    const [snapshot] = await db
      .insert(policySnapshots)
      .values({
        shopId: shop.id,
        kind: "terms",
        contentHash: `pack-${uid()}`,
        body: "Refunds within 14 days, as it stood in March.",
        source: "shop_page",
      })
      .returning();

    const order = await anOrder(shop.id, {
      termsAcceptedAt: new Date("2026-03-01T00:00:00.000Z"),
      termsSnapshotId: snapshot!.id,
    });

    // The shop rewrites its policy afterwards.
    await db.insert(policySnapshots).values({
      shopId: shop.id,
      kind: "terms",
      contentHash: `pack-${uid()}`,
      body: "No refunds under any circumstances.",
      source: "shop_page",
    });

    const holdings = await packHoldingsForOrder(order, { shop, renderedAt: NOW });
    expect(holdings.policyText).toContain("as it stood in March");
    expect(holdings.policyText).not.toContain("No refunds");
    expect(holdings.policySource).toBe("shop_page");
  });

  it("refuses a platform dispute outright", async () => {
    /*
     * There is no order behind one, and spec 46's pack is a different document
     * assembled from different holdings. Pointing this generator at it would
     * produce a pack about a sale that does not exist.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id);
    const dispute = await aDispute(shop.id, null, { scope: "platform" });

    const filled = await autoFillEvidence({ dispute, order, shop, now: NOW });
    expect(filled.filled).toEqual([]);
    expect(await filesOn(dispute.id)).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it("never overwrites a document the seller uploaded themselves", async () => {
    const shop = await sellerShop();
    const order = await anOrder(shop.id, {
      shippedAt: new Date(),
      deliveredAt: new Date(),
      deliveredSource: "carrier",
      trackingNumber: "JD0002",
    });
    const dispute = await aDispute(shop.id, order.id);

    await db.insert(disputeEvidenceFiles).values({
      disputeId: dispute.id,
      field: "shipping_documentation",
      stripeFileId: "file_seller",
      filename: "carrier-pod.pdf",
      contentType: "application/pdf",
      bytes: 90_000,
      uploadedBy: "seller@example.com",
    });

    const filled = await autoFillEvidence({ dispute, order, shop, now: NOW });

    expect(filled.deferredToSeller).toContain("shipping_documentation");
    const rows = await filesOn(dispute.id);
    const pod = rows.find((row) => row.field === "shipping_documentation");
    // Theirs, untouched.
    expect(pod?.filename).toBe("carrier-pod.pdf");
    expect(pod?.uploadedBy).toBe("seller@example.com");
  });

  it("is idempotent — a second run replaces rather than duplicates", async () => {
    const shop = await sellerShop();
    const order = await anOrder(shop.id, { productKind: "digital" });
    await db.insert(downloadEvents).values({ orderId: order.id, fileName: "a.zip", ip: "203.0.113.7" });
    const dispute = await aDispute(shop.id, order.id);

    await autoFillEvidence({ dispute, order, shop, now: NOW });
    const first = await filesOn(dispute.id);
    await autoFillEvidence({ dispute, order, shop, now: NOW });
    const second = await filesOn(dispute.id);

    expect(second).toHaveLength(first.length);
  });
});

/* ------------------------------------------------------------------------- */

describe("the 4.5 MB budget", () => {
  it("lets a seller's real proof of delivery displace Sailo's generated document", async () => {
    /*
     * The asymmetry that matters. Ours is an account of what Sailo saw; theirs
     * is what wins the case. A generator that could block a carrier's own scan
     * at the one moment it matters would be the worst bug in this feature.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id, { productKind: "digital" });
    const dispute = await aDispute(shop.id, order.id);

    await db.insert(downloadEvents).values({ orderId: order.id, fileName: "a.zip", ip: "203.0.113.7" });
    await autoFillEvidence({ dispute, order, shop, now: NOW });

    const generated = await filesOn(dispute.id);
    expect(generated.length).toBeGreaterThan(0);

    // Inflate what Sailo generated so the incoming file genuinely will not fit.
    await db
      .update(disputeEvidenceFiles)
      .set({ bytes: 2_300_000 })
      .where(eq(disputeEvidenceFiles.disputeId, dispute.id));

    const evicted = await evictGeneratedFor(dispute.id, 3_000_000);
    expect(evicted).toBeGreaterThan(0);

    const left = await filesOn(dispute.id);
    const bytesLeft = left.reduce((sum, row) => sum + row.bytes, 0);
    expect(bytesLeft + 3_000_000).toBeLessThanOrEqual(4_500_000);
  });

  it("evicts nothing when the incoming file already fits", async () => {
    const shop = await sellerShop();
    const order = await anOrder(shop.id, { productKind: "digital" });
    await db.insert(downloadEvents).values({ orderId: order.id, fileName: "a.zip", ip: "203.0.113.7" });
    const dispute = await aDispute(shop.id, order.id);
    await autoFillEvidence({ dispute, order, shop, now: NOW });

    expect(await evictGeneratedFor(dispute.id, 10_000)).toBe(0);
  });
});

/* ------------------------------------------------------------------------- */

describe("rendering", () => {
  it("renders for every kind on an order that has nothing on it", async () => {
    /*
     * No invoice, no messages, no policy snapshot, no delivery — the ordinary
     * case for a shop that has just started, and the case a generator most
     * easily throws on.
     */
    const shop = await sellerShop();

    for (const kind of ["physical", "digital", "service", "event", "membership"]) {
      const order = await anOrder(shop.id, {
        productKind: kind,
        buyerIp: null,
        statementDescriptor: null,
      });
      const rendered = await renderOrderPack({ order, shop, renderedAt: NOW });
      expect(rendered.bytes.byteLength, kind).toBeGreaterThan(1_000);
      expect(rendered.filename, kind).toMatch(/^evidence-[0-9a-f]{8}\.pdf$/);
    }
  });

  it("renders the same bytes twice for the same order", async () => {
    /*
     * What makes "re-render the case exactly" true rather than approximate: the
     * only clock in the document is the `renderedAt` handed in.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id);

    const one = await renderOrderPack({ order, shop, renderedAt: NOW });
    const two = await renderOrderPack({ order, shop, renderedAt: NOW });
    expect(one.bytes.equals(two.bytes)).toBe(true);
  });

  it("describes the order from its lines, and includes the invoice when there is one", async () => {
    const shop = await sellerShop();
    const [product] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Speckled Mug",
        slug: `mug-${uid().slice(0, 8)}`,
        priceCents: 4200,
        isPublished: true,
      })
      .returning();
    const order = await anOrder(shop.id, { productId: product!.id });

    await db.insert(invoices).values({
      shopId: shop.id,
      orderId: order.id,
      number: "INV-0007",
      token: uid().replace(/-/g, ""),
    });
    await db.insert(orderMessages).values({
      orderId: order.id,
      shopId: shop.id,
      kind: "confirmation",
      toAddress: order.customerEmail,
      subject: "Your order",
      status: "delivered",
    });

    const holdings = await packHoldingsForOrder(order, { shop, renderedAt: NOW });
    expect(holdings.invoiceNumber).toBe("INV-0007");
    expect(holdings.messages).toHaveLength(1);

    const fields = packDocuments(holdings).map((document) => document.field);
    expect(fields).toContain("receipt");
    expect(fields).toContain("customer_communication");
  });
});
