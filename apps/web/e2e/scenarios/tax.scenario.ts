import { beforeAll, describe, expect, it, vi } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  invoices,
  orders,
  paymentMethods,
  products,
  shops,
  taxCountryRules,
  taxJurisdictions,
  taxRevenueDaily,
  user,
} from "@sailo/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import {
  countryGateFor,
  placeRevenueFor,
  rollUpTaxRevenue,
  runTaxMonitor,
  setCountrySales,
  shopThresholds,
  taxReport,
  taxReportCsv,
} from "@sailo/commerce/tax/server";
import { isCountryBlocked } from "@sailo/commerce/tax";

/**
 * Spec 38's money path, against a database we are allowed to dirty.
 *
 * Four things are only true against real rows, and each one is a way the
 * feature could be wrong while every unit test passed:
 *
 *   1. **The fold sums stored minor units.** The arithmetic is unit-tested;
 *      what is not is that the SQL reads `tax_cents` off the order rather than
 *      re-deriving it, and that a refund lowers the *day of the sale* rather
 *      than the day of the refund.
 *   2. **The country gate is enforced at the checkout, not only in the picker.**
 *      A test that called the predicate would prove nothing about
 *      `createOrderIntent`, which is where a real POST lands.
 *   3. **A disabled country does not break a renewal.** The rule is "the switch
 *      governs new checkouts", and the only way to show it is to place one and
 *      raise the other.
 *   4. **The report reconciles to the invoice sequence.** That is the whole
 *      claim of a filable report and it is a join, not a formula.
 *
 * Run with:
 *   npx dotenv -e .env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts e2e/scenarios/tax.scenario.ts
 */

const db = getDb();
const uid = () => crypto.randomUUID();

/*
 * The threshold mail, intercepted. Not a convenience: "sent once" is the whole
 * claim of the rung and a test that cannot count sends cannot check it.
 */
const outbox = vi.hoisted(() => [] as { to: string; place: string; rung: string }[]);

vi.mock("@sailo/email/shop", async (importOriginal) => {
  const real = await importOriginal<typeof import("@sailo/email/shop")>();
  return {
    ...real,
    sendSellerTaxThreshold: async (opts: {
      to: string;
      place: string;
      rung: string;
    }) => {
      outbox.push({ to: opts.to, place: opts.place, rung: opts.rung });
      return { sent: true as const, id: `scenario-${outbox.length}` };
    },
  };
});

beforeAll(() => {
  assertLocalDatabase();
});

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `tax-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `tax-${userId.slice(0, 8)}`,
      name: "Tax Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      contactEmail: "seller@example.com",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "cod",
    label: "cod",
    config: {} as never,
    isEnabled: true,
    position: 0,
  });
  return shop;
}

async function makeProduct(shopId: string, over: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Test Product",
      slug: `p-${uid().slice(0, 8)}`,
      kind: "physical",
      priceCents: 2000,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: product was not inserted");
  return p;
}

/**
 * A paid order, written directly.
 *
 * The fold reads `orders`, so writing one is the honest fixture — going through
 * `createOrderIntent` for every row would make each of these tests also a test
 * of the checkout, and the checkout has its own file. The two places that need
 * a *real* checkout call it below.
 */
async function paidOrder(
  shopId: string,
  over: Partial<typeof orders.$inferInsert> = {},
) {
  const [row] = await db
    .insert(orders)
    .values({
      shopId,
      productTitle: "Test Product",
      currency: "USD",
      subtotalCents: 10_000,
      taxCents: 2_000,
      totalCents: 12_000,
      paymentStatus: "paid",
      status: "confirmed",
      country: "US",
      region: "CO",
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: order was not inserted");
  return row;
}

const YEAR = new Date().getUTCFullYear();
const window = {
  from: new Date(Date.UTC(YEAR, 0, 1)),
  to: new Date(Date.UTC(YEAR, 11, 31)),
};

describe("the daily fold", () => {
  it("sums what was charged, and never re-derives it from a rate", async () => {
    const shop = await makeShop();
    // Two orders whose tax is deliberately *not* `rate × net`: the rate moved
    // between them, which is exactly the case a re-derivation gets wrong.
    await paidOrder(shop.id, { taxCents: 2_000, taxRateBp: 2_000 });
    await paidOrder(shop.id, {
      subtotalCents: 10_000,
      taxCents: 500,
      taxRateBp: 500,
      totalCents: 10_500,
    });

    await rollUpTaxRevenue({ shopId: shop.id });

    const rows = await placeRevenueFor({ shopId: shop.id, ...window });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taxMinor).toBe(2_500);
    // net = total - tax, summed: (12000-2000) + (10500-500)
    expect(rows[0]!.netB2cMinor).toBe(20_000);
    expect(rows[0]!.orderCount).toBe(2);
  });

  it("keeps business sales out of the figure a threshold reads", async () => {
    const shop = await makeShop();
    await paidOrder(shop.id);
    await paidOrder(shop.id, { buyerTaxId: "DE123456789", buyerTaxIdType: "eu_vat" });
    // The reverse charge is the other way a sale is B2B, and it carries no
    // tax id of its own on every rail.
    await paidOrder(shop.id, { taxReverseCharge: true, taxCents: 0, totalCents: 10_000 });

    await rollUpTaxRevenue({ shopId: shop.id });
    const [row] = await placeRevenueFor({ shopId: shop.id, ...window });

    expect(row!.netB2cMinor).toBe(10_000);
    expect(row!.netB2bMinor).toBe(10_000 + 10_000);
  });

  it("lowers the day of the sale when money is handed back", async () => {
    const shop = await makeShop();
    const order = await paidOrder(shop.id);

    await rollUpTaxRevenue({ shopId: shop.id });
    expect((await placeRevenueFor({ shopId: shop.id, ...window }))[0]!.netB2cMinor).toBe(10_000);

    // A refund a month later. The fold re-reads rather than accumulating, so
    // the reduction lands on the period the order belongs to.
    await db
      .update(orders)
      .set({ refundedCents: 12_000, refundedAt: new Date() })
      .where(eq(orders.id, order.id));

    await rollUpTaxRevenue({ shopId: shop.id });
    const [row] = await placeRevenueFor({ shopId: shop.id, ...window });
    expect(row!.netB2cMinor).toBe(-2_000);
    // Tax comes off entirely: a refunded order handed it back, and Sailo does
    // not store how a partial refund split, so apportioning it would be the
    // re-derivation the spec forbids.
    expect(row!.taxMinor).toBe(0);
  });

  it("is idempotent — two ticks write the same numbers, not double them", async () => {
    const shop = await makeShop();
    await paidOrder(shop.id);

    await rollUpTaxRevenue({ shopId: shop.id });
    await rollUpTaxRevenue({ shopId: shop.id });

    const rows = await db
      .select()
      .from(taxRevenueDaily)
      .where(eq(taxRevenueDaily.shopId, shop.id));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.netCents)).toBe(10_000);
  });

  it("counts unpaid and cancelled orders as nothing", async () => {
    const shop = await makeShop();
    await paidOrder(shop.id, { paymentStatus: "unpaid" });
    await paidOrder(shop.id, { status: "cancelled" });

    await rollUpTaxRevenue({ shopId: shop.id });
    expect(await placeRevenueFor({ shopId: shop.id, ...window })).toEqual([]);
  });
});

describe("thresholds", () => {
  it("adds EU member states into one figure and leaves home out", async () => {
    const shop = await makeShop({ currency: "EUR", invoiceCountry: "DE" });
    const euro = { currency: "EUR", region: null, taxCents: 0 };
    await paidOrder(shop.id, { ...euro, country: "FR", subtotalCents: 600_000, totalCents: 600_000 });
    await paidOrder(shop.id, { ...euro, country: "IT", subtotalCents: 300_000, totalCents: 300_000 });
    await paidOrder(shop.id, { ...euro, country: "DE", subtotalCents: 900_000, totalCents: 900_000 });

    await rollUpTaxRevenue({ shopId: shop.id });
    const { watches } = await shopThresholds(shop);

    const eu = watches.find((w) => w.key === "EU")!;
    expect(eu.netB2cMinor).toBe(900_000); // FR + IT, not DE
    expect(eu.state).toBe("near"); // 9,000 of 10,000
    expect(watches.find((w) => w.key === "DE")?.state).toBe("untracked");
  });

  it("counts a registration as answered", async () => {
    const shop = await makeShop({ currency: "USD" });
    await paidOrder(shop.id, {
      region: "CO",
      subtotalCents: 20_000_000,
      taxCents: 0,
      totalCents: 20_000_000,
    });
    await db.insert(taxJurisdictions).values({
      shopId: shop.id,
      country: "US",
      region: "CO",
    });

    await rollUpTaxRevenue({ shopId: shop.id });
    const { watches } = await shopThresholds(shop);
    const co = watches.find((w) => w.key === "US-CO")!;
    expect(co.state).toBe("crossed");
    expect(co.registered).toBe(true);
  });
});

describe("the alert rungs", () => {
  it("mails 70 once across two ticks, then 90 when it moves", async () => {
    const shop = await makeShop({ currency: "USD" });
    outbox.length = 0;

    // 75% of Colorado's $100,000.
    const order = await paidOrder(shop.id, {
      region: "CO",
      subtotalCents: 7_500_000,
      taxCents: 0,
      totalCents: 7_500_000,
    });
    await rollUpTaxRevenue({ shopId: shop.id });

    await runTaxMonitor({ shopId: shop.id });
    await runTaxMonitor({ shopId: shop.id });

    expect(outbox.filter((m) => m.rung === "70")).toHaveLength(1);

    // Past 90% — a second rung, and only one of it.
    await db
      .update(orders)
      .set({ subtotalCents: 9_500_000, totalCents: 9_500_000 })
      .where(eq(orders.id, order.id));
    await rollUpTaxRevenue({ shopId: shop.id });
    await runTaxMonitor({ shopId: shop.id });
    await runTaxMonitor({ shopId: shop.id });

    expect(outbox.filter((m) => m.rung === "90")).toHaveLength(1);
    expect(outbox.every((m) => m.to === "seller@example.com")).toBe(true);

    const [rule] = await db
      .select()
      .from(taxCountryRules)
      .where(and(eq(taxCountryRules.shopId, shop.id), eq(taxCountryRules.country, "US")));
    expect(rule!.alertedRungs.toSorted()).toEqual(["CO:70", "CO:90"]);
    expect(rule!.alertedYear).toBe(YEAR);
  });

  it("says nothing about a place the seller is registered in", async () => {
    const shop = await makeShop({ currency: "USD" });
    outbox.length = 0;
    await paidOrder(shop.id, {
      region: "CO",
      subtotalCents: 9_900_000,
      taxCents: 0,
      totalCents: 9_900_000,
    });
    await db.insert(taxJurisdictions).values({
      shopId: shop.id,
      country: "US",
      region: "CO",
    });

    await rollUpTaxRevenue({ shopId: shop.id });
    await runTaxMonitor({ shopId: shop.id });
    expect(outbox).toHaveLength(0);
  });

  it("switches a country off only when the seller asked for it", async () => {
    const over = {
      region: "CO",
      subtotalCents: 12_000_000,
      taxCents: 0,
      totalCents: 12_000_000,
    };

    const quiet = await makeShop({ currency: "USD" });
    await paidOrder(quiet.id, over);
    await rollUpTaxRevenue({ shopId: quiet.id });
    await runTaxMonitor({ shopId: quiet.id });
    expect((await countryGateFor(quiet)).disabled.has("US")).toBe(false);

    const strict = await makeShop({ currency: "USD", taxDisableOnThreshold: true });
    await paidOrder(strict.id, over);
    await rollUpTaxRevenue({ shopId: strict.id });
    await runTaxMonitor({ shopId: strict.id });

    const [rule] = await db
      .select()
      .from(taxCountryRules)
      .where(
        and(eq(taxCountryRules.shopId, strict.id), eq(taxCountryRules.country, "US")),
      );
    expect(rule!.salesEnabled).toBe(false);
    // The reason is written because a seller who finds a country missing with
    // no explanation cannot tell the panel from a bug.
    expect(rule!.autoDisabledReason).toMatch(/threshold/i);
    expect(rule!.autoDisabledAt).not.toBeNull();
  });

  it("leaves a country the seller turned back on alone", async () => {
    const shop = await makeShop({ currency: "USD", taxDisableOnThreshold: true });
    await paidOrder(shop.id, {
      region: "CO",
      subtotalCents: 12_000_000,
      taxCents: 0,
      totalCents: 12_000_000,
    });
    await rollUpTaxRevenue({ shopId: shop.id });
    await runTaxMonitor({ shopId: shop.id });

    await setCountrySales(shop.id, "US", true);
    await runTaxMonitor({ shopId: shop.id });

    const [rule] = await db
      .select()
      .from(taxCountryRules)
      .where(and(eq(taxCountryRules.shopId, shop.id), eq(taxCountryRules.country, "US")));
    // Without the `auto_disabled_at is null` guard on the claim, the next tick
    // closes it again, for ever, and the seller can never overrule the panel.
    expect(rule!.salesEnabled).toBe(true);
  });
});

describe("country control at the checkout", () => {
  it("refuses a country that is switched off, however the order arrives", async () => {
    const shop = await makeShop();
    const product = await makeProduct(shop.id);
    await setCountrySales(shop.id, "DE", false);

    const gate = await countryGateFor(shop);
    expect(isCountryBlocked(gate, "DE")).toBe(true);

    const refused = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      customerName: "Buyer",
      customerEmail: "buyer@example.com",
      addressLine1: "1 Hauptstrasse",
      city: "Berlin",
      country: "DE",
    });
    expect(refused.ok).toBe(false);

    // Nothing was written: the gate sits above every write, beside the terms
    // gate, so a refusal cannot strand reserved stock.
    const written = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.shopId, shop.id));
    expect(written).toHaveLength(0);

    // Any other country still sells.
    const allowed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      customerName: "Buyer",
      customerEmail: "buyer@example.com",
      addressLine1: "1 Rue de Rivoli",
      city: "Paris",
      country: "FR",
    });
    expect(allowed).toMatchObject({ ok: true });
  });

  it("takes an order with no country at all", async () => {
    // A digital sale has no address and never had one. Refusing every order
    // that failed to state a country would turn a compliance switch into a
    // checkout outage for most of the catalogue.
    const shop = await makeShop();
    const product = await makeProduct(shop.id);
    await setCountrySales(shop.id, "DE", false);

    const result = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      customerName: "Buyer",
      customerEmail: "buyer@example.com",
      addressLine1: "1 High Street",
      city: "Leeds",
    });
    if (!result.ok) throw new Error(`order refused: ${result.error}`);
  });

  it("refuses the immediate-obligation list only when asked to", async () => {
    const relaxed = await makeShop();
    expect(isCountryBlocked(await countryGateFor(relaxed), "PE")).toBe(false);

    const strict = await makeShop({ taxDisableImmediateObligation: true });
    expect(isCountryBlocked(await countryGateFor(strict), "PE")).toBe(true);
    // And nothing else moves.
    expect(isCountryBlocked(await countryGateFor(strict), "FR")).toBe(false);
  });

  it("does not stop a membership already running from renewing", async () => {
    /*
     * Spec 38: "A disabled country must not break an existing subscription's
     * renewal." The switch governs new checkouts, and the proof is that the
     * renewal path never reaches `createOrderIntent` — a renewal writes its
     * order directly, which is what this asserts by placing one.
     */
    const shop = await makeShop();
    await setCountrySales(shop.id, "DE", false);

    const renewal = await paidOrder(shop.id, { country: "DE", region: null });
    expect(renewal.id).toBeTruthy();

    const rows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.shopId, shop.id), eq(orders.country, "DE")));
    expect(rows).toHaveLength(1);
  });
});

describe("the report", () => {
  it("reconciles to the orders and the invoice sequence", async () => {
    const shop = await makeShop();
    const a = await paidOrder(shop.id, { country: "US", region: "CO" });
    const b = await paidOrder(shop.id, { country: "FR", region: null, taxCents: 1_000, totalCents: 11_000 });

    await db.insert(invoices).values([
      { shopId: shop.id, orderId: a.id, number: "INV-0001", token: uid() },
      { shopId: shop.id, orderId: b.id, number: "INV-0002", token: uid() },
    ]);

    await rollUpTaxRevenue({ shopId: shop.id });
    const report = await taxReport({ shopId: shop.id, ...window });

    expect(report.reconciliation.agrees).toBe(true);
    expect(report.reconciliation.orderCount).toBe(2);
    expect(report.reconciliation.foldedOrderCount).toBe(2);
    expect(report.reconciliation.invoiceCount).toBe(2);
    expect(report.totals).toEqual([
      { currency: "USD", netCents: 10_000 + 10_000, taxCents: 3_000, orderCount: 2 },
    ]);

    const csv = taxReportCsv(report);
    // Minor units *and* a decimal, because the commonest integration bug is
    // mapping the integer and telling an accountant 4999.
    expect(csv).toContain("net_minor");
    // Per place, so each row is 100.00 net — and the minor units beside it.
    expect(csv).toContain("100.00");
    expect(csv).toContain("10000");
  });

  it("says so when the fold does not describe the orders", async () => {
    const shop = await makeShop();
    await paidOrder(shop.id);
    // Never folded — the nightly job has not reached this shop.
    const report = await taxReport({ shopId: shop.id, ...window });

    expect(report.reconciliation.agrees).toBe(false);
    expect(report.reconciliation.orderCount).toBe(1);
    expect(report.reconciliation.foldedOrderCount).toBe(0);
  });

  it("reports the refunded orders whose tax it left out", async () => {
    const shop = await makeShop();
    await paidOrder(shop.id, { refundedCents: 5_000 });
    await rollUpTaxRevenue({ shopId: shop.id });

    const report = await taxReport({ shopId: shop.id, ...window });
    expect(report.reconciliation.refundedOrderCount).toBe(1);
    expect(report.reconciliation.taxOutsideFold).toBe(2_000);
    // Visible rather than silent — no silent caps.
    expect(report.rows[0]!.taxCents).toBe(0);
  });
});
