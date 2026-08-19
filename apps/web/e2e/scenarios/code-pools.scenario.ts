import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  licenseKeys,
  orders,
  paymentMethods,
  productCodes,
  products,
  shops,
  user,
} from "@sailo/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { releaseDownloads } from "@/lib/downloads";
import { addCodes, claimCode, poolCounts } from "@sailo/commerce/catalog";
import {
  activateLicense,
  applyOrderStatus,
  deactivateLicense,
  digitalAccessForOrder,
  licensesForOrder,
  refundOrder,
  validateLicense,
} from "@sailo/commerce/orders/server";

/**
 * Code pools and licence keys, end to end — spec 48.
 *
 * WHY THIS SUITE EXISTS RATHER THAN UNIT TESTS
 *
 * Every interesting property here is a property of a *statement*. "Two
 * concurrent claims take two different codes" is a claim about `FOR UPDATE
 * SKIP LOCKED`, which a mock cannot have; "an abandoned checkout burns no key"
 * is a claim about *when* the claim runs relative to the release; and "a
 * refund does not return the code to the pool" is a claim about two functions
 * agreeing at a distance. The original memberships release found four defects
 * exactly this way and none of them by reading.
 *
 * The concurrency test below is the one the wave prompt names. **It fails if
 * the guard is removed** — take `SKIP LOCKED` out and two callers block rather
 * than diverge; take the whole claim out and replace it with a read-then-write
 * and two callers get the same string. Either way the assertion that two
 * buyers hold two different codes is the one that goes red.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

const buyer = {
  customerName: "Buyer",
  customerEmail: "buyer@example.com",
  customerPhone: "+15551234567",
  addressLine1: "1 High Street",
  city: "Leeds",
  postalCode: "LS1 1AA",
  country: "UK",
};

async function makeShop() {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `seller-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `shop-${userId.slice(0, 8)}`,
      name: "Key Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  /*
   * Bank transfer, not cash on delivery.
   *
   * `cartCanPayInPerson` refuses a pay-in-person rail for a basket with
   * nothing to hand over at a doorstep, and a digital product is exactly that
   * — so `cod` is not a rail these products can be sold on, and using it here
   * would be testing the refusal rather than the pool. Transfer also settles
   * *later*, which is the case that matters: the code must not be spent until
   * the seller says the money arrived.
   */
  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "bank_transfer",
    label: "bank_transfer",
    config: {
      bankName: "Test Bank",
      accountName: "Key Shop Ltd",
      accountNumber: "12345678",
    } as never,
    isEnabled: true,
    position: 0,
  });
  return shop;
}

/**
 * A pooled digital product with `n` codes in it.
 *
 * `releaseOnPayment` on, which is the default and the case that matters: the
 * pool must not be spent until the seller says the money arrived.
 */
async function makePooled(shopId: string, codes: string[], over = {}) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Plugin licence",
      slug: `p-${uid().slice(0, 8)}`,
      kind: "digital",
      digitalDelivery: "code",
      codeSource: "pool",
      priceCents: 4900,
      releaseOnPayment: true,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: product was not inserted");

  if (codes.length > 0) {
    await addCodes({ productId: p.id, codes, deliversLinks: false });
  }
  return p;
}

const orderRow = (id: string) =>
  db.query.orders.findFirst({ where: eq(orders.id, id) });

async function placedOrder(shopId: string, productId: string, quantity = 1) {
  const r = await createOrderIntent({
    shopId,
    items: [{ productId, quantity }],
    paymentMethod: "bank_transfer",
    ...buyer,
  });
  return r;
}

async function mustPlace(shopId: string, productId: string, quantity = 1) {
  const r = await placedOrder(shopId, productId, quantity);
  if (!r.ok) throw new Error(`order refused: ${r.error}`);
  return r.orderId;
}


beforeAll(async () => {
  assertLocalDatabase();
});

describe("the pool is stock", () => {
  it("uploading codes makes the product sellable and counts them", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["AAA-1", "AAA-2", "AAA-3"]);

    const row = await db.query.products.findFirst({
      where: eq(products.id, product.id),
    });
    // The pool *is* the stock: nothing invented a second sold-out concept, so
    // the storefront, the buy box and `reserveStock` all keep working unchanged.
    expect(row?.trackInventory).toBe(true);
    expect(row?.stockQuantity).toBe(3);
    expect(await poolCounts(product.id)).toEqual({
      available: 3,
      claimed: 0,
      revoked: 0,
    });
  });

  it("skips a code already in the pool rather than duplicating it", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["DUP-1"]);

    const again = await addCodes({
      productId: product.id,
      codes: ["DUP-1", "DUP-2"],
      deliversLinks: false,
    });
    expect(again).toEqual({ added: 1, duplicates: 1, rejected: 0 });

    // Stock moved by what was *written*, not by what was offered — counting the
    // input would credit the seller for the duplicate and let them oversell.
    const row = await db.query.products.findFirst({
      where: eq(products.id, product.id),
    });
    expect(row?.stockQuantity).toBe(2);
  });

  it("refuses a URL that is not public when the pool holds links", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, [], { digitalDelivery: "link" });

    const result = await addCodes({
      productId: product.id,
      codes: [
        "https://notion.so/invite/abc",
        "http://169.254.169.254/latest/meta-data/",
        "javascript:alert(1)",
      ],
      deliversLinks: true,
    });
    // The guard is at the write, where the value arrives — not wherever the
    // link is later rendered as an anchor on a buyer's page.
    expect(result.added).toBe(1);
    expect(result.rejected).toBe(2);
  });

  it("a fourth buyer is refused when the pool holds three", { timeout: 90_000 }, async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["S-1", "S-2", "S-3"]);

    for (let i = 0; i < 3; i += 1) {
      expect((await placedOrder(shop.id, product.id)).ok).toBe(true);
    }
    const fourth = await placedOrder(shop.id, product.id);
    expect(fourth.ok).toBe(false);
  });
});

describe("the claim", () => {
  /*
   * THE ONE THE WAVE PROMPT NAMES.
   *
   * Two callers, one pool, at the same moment. `FOR UPDATE SKIP LOCKED` is
   * what makes the second take the *next* row rather than blocking on the
   * first and then finding it gone. Without the conditional claim — a read
   * followed by a write — both would read the same oldest unclaimed row and
   * both would be handed it, which is one licence key sold twice.
   */
  it("hands two concurrent callers two different codes, never one twice", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["C-1", "C-2"]);
    const a = uid();
    const b = uid();

    const [first, second] = await Promise.all([
      claimCode({ productId: product.id, variantId: null, orderId: a }),
      claimCode({ productId: product.id, variantId: null, orderId: b }),
    ]);

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);

    // And each row is claimed by exactly one order.
    const rows = await db.query.productCodes.findMany({
      where: eq(productCodes.productId, product.id),
    });
    expect(new Set(rows.map((r) => r.claimedByOrderId)).size).toBe(2);
  });

  it("hands the fourth of four concurrent callers nothing, on a pool of three", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["Q-1", "Q-2", "Q-3"]);

    const claims = await Promise.all(
      Array.from({ length: 4 }, () =>
        claimCode({ productId: product.id, variantId: null, orderId: uid() }),
      ),
    );

    const handed = claims.filter((c): c is string => c !== null);
    expect(handed).toHaveLength(3);
    // Three distinct strings, not one string three times.
    expect(new Set(handed).size).toBe(3);
    expect(claims.filter((c) => c === null)).toHaveLength(1);
  });

  it("spends nothing until the order is released", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["R-1", "R-2"]);
    const orderId = await mustPlace(shop.id, product.id);

    // The stock came off the shelf at checkout, as it always has — but the
    // code is the *good*, and an abandoned card session must burn none of it.
    expect(await poolCounts(product.id)).toMatchObject({ available: 2, claimed: 0 });
    const order = await orderRow(orderId);
    expect(order?.downloadReleasedAt).toBeNull();

    await releaseDownloads(orderId);
    expect(await poolCounts(product.id)).toMatchObject({ available: 1, claimed: 1 });
  });

  it("burns no code when a checkout is abandoned", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["A-1"]);
    const orderId = await mustPlace(shop.id, product.id);

    // Cancelled without ever being released — the sweep's own path.
    await applyOrderStatus({
      shopId: shop.id,
      orderId,
      status: "cancelled",
    });

    const counts = await poolCounts(product.id);
    expect(counts.claimed).toBe(0);
    expect(counts.revoked).toBe(0);
    // And the unit went back on the shelf, because nothing was spent.
    const row = await db.query.products.findFirst({
      where: eq(products.id, product.id),
    });
    expect(row?.stockQuantity).toBe(1);
  });

  it("gives one buyer one code however many times the release is re-run", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["I-1", "I-2", "I-3"]);
    const orderId = await mustPlace(shop.id, product.id);

    await releaseDownloads(orderId);
    // A seller toggling paid → unpaid → paid reaches this a second time. The
    // count of codes the order already holds is what stops the pool draining
    // one re-save at a time.
    await db
      .update(orders)
      .set({ downloadReleasedAt: null })
      .where(eq(orders.id, orderId));
    await releaseDownloads(orderId);

    expect(await poolCounts(product.id)).toMatchObject({ available: 2, claimed: 1 });
  });

  it("fans quantity out — three licences bought is three codes", { timeout: 60_000 }, async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["F-1", "F-2", "F-3", "F-4"]);
    const orderId = await mustPlace(shop.id, product.id, 3);
    await releaseDownloads(orderId);

    expect(await poolCounts(product.id)).toMatchObject({ available: 1, claimed: 3 });
  });
});

describe("a refund revokes and does not give the code back", () => {
  it("revokes the buyer's code and leaves the pool no larger", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["V-1", "V-2"]);
    const orderId = await mustPlace(shop.id, product.id);
    await releaseDownloads(orderId);

    expect(await poolCounts(product.id)).toMatchObject({ available: 1, claimed: 1 });

    await applyOrderStatus({ shopId: shop.id, orderId, status: "refunded" });

    const counts = await poolCounts(product.id);
    // Revoked, not returned. The buyer has already seen it: they may have
    // redeemed it, sold it, or pasted it in a forum, and none of that is
    // visible from here.
    expect(counts).toEqual({ available: 1, claimed: 0, revoked: 1 });

    // And the *unit* did not come back either, or the seller would oversell
    // against a pool that is emptier than the stock count claims.
    const row = await db.query.products.findFirst({
      where: eq(products.id, product.id),
    });
    expect(row?.stockQuantity).toBe(1);
  });

  it("still revokes when the seller declines to restock", { timeout: 90_000 }, async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["D-1"]);
    const orderId = await mustPlace(shop.id, product.id);
    await releaseDownloads(orderId);

    const refund = await refundOrder({
      shop,
      orderId,
      // Blank refunds whatever is left, which on an untouched order is all of it.
      amountCents: null,
      restock: false,
    });
    expect(refund.ok).toBe(true);

    /*
     * The guard-at-one-sink shape, caught. Whether a damaged mug goes back on
     * the shelf is a stock question; whether a refunded buyer keeps a live
     * licence key is not, and hanging the second off the first would leave the
     * code working.
     */
    expect(await poolCounts(product.id)).toMatchObject({ revoked: 1 });
  });

  it("never hands a revoked code to the next buyer", { timeout: 90_000 }, async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["N-1", "N-2"]);

    const first = await mustPlace(shop.id, product.id);
    await releaseDownloads(first);
    const firstCode = (
      await db.query.productCodes.findFirst({
        where: eq(productCodes.claimedByOrderId, first),
      })
    )?.code;

    await applyOrderStatus({ shopId: shop.id, orderId: first, status: "refunded" });

    const second = await mustPlace(shop.id, product.id);
    await releaseDownloads(second);
    const secondCode = (
      await db.query.productCodes.findFirst({
        where: eq(productCodes.claimedByOrderId, second),
      })
    )?.code;

    expect(firstCode).toBeTruthy();
    expect(secondCode).toBeTruthy();
    expect(secondCode).not.toBe(firstCode);
  });
});

describe("what the buyer can see", () => {
  it("shows nothing until release, then their own code and not the pool", { timeout: 60_000 }, async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["P-1", "P-2", "P-3"]);
    const orderId = await mustPlace(shop.id, product.id);

    const before = await orderRow(orderId);
    if (!before) throw new Error("fixture: order vanished");
    const locked = await digitalAccessForOrder(before);
    expect(locked[0]?.value).toBeNull();
    expect(locked[0]?.values).toEqual([]);

    await releaseDownloads(orderId);
    const after = await orderRow(orderId);
    if (!after) throw new Error("fixture: order vanished");
    const open = await digitalAccessForOrder(after);

    expect(open[0]?.values).toHaveLength(1);
    // One code, theirs — never the two still sitting unclaimed in the pool.
    const mine = await db.query.productCodes.findMany({
      where: eq(productCodes.claimedByOrderId, orderId),
    });
    expect(open[0]?.values).toEqual(mine.map((c) => c.code));
  });

  it("never renders an unclaimed code anywhere an order can reach", async () => {
    const shop = await makeShop();
    const product = await makePooled(shop.id, ["U-1", "U-2", "U-3"]);
    const orderId = await mustPlace(shop.id, product.id);
    await releaseDownloads(orderId);

    const order = await orderRow(orderId);
    if (!order) throw new Error("fixture: order vanished");
    const access = await digitalAccessForOrder(order);

    const unclaimed = await db.query.productCodes.findMany({
      where: and(
        eq(productCodes.productId, product.id),
        isNull(productCodes.claimedAt),
      ),
    });
    expect(unclaimed).toHaveLength(2);

    const rendered = JSON.stringify(access);
    for (const row of unclaimed) {
      expect(rendered).not.toContain(row.code);
    }
  });
});

describe("licence keys", () => {
  async function makeLicensed(shopId: string, over = {}) {
    const [p] = await db
      .insert(products)
      .values({
        shopId,
        title: "Desktop app",
        slug: `l-${uid().slice(0, 8)}`,
        kind: "digital",
        digitalDelivery: "code",
        digitalAccessDetails: "Thanks for buying.",
        licenseEnabled: true,
        licenseActivationLimit: 2,
        priceCents: 9900,
        releaseOnPayment: true,
        isPublished: true,
        inStock: true,
        ...over,
      })
      .returning();
    if (!p) throw new Error("fixture: product was not inserted");
    return p;
  }

  it("mints one key per unit at release and not before", { timeout: 60_000 }, async () => {
    const shop = await makeShop();
    const product = await makeLicensed(shop.id);
    const orderId = await mustPlace(shop.id, product.id, 2);

    expect(await licensesForOrder(orderId)).toHaveLength(0);
    await releaseDownloads(orderId);
    expect(await licensesForOrder(orderId)).toHaveLength(2);

    // And a re-run mints no more — the seller toggling paid twice buys one
    // set of keys, not two.
    await db
      .update(orders)
      .set({ downloadReleasedAt: null })
      .where(eq(orders.id, orderId));
    await releaseDownloads(orderId);
    expect(await licensesForOrder(orderId)).toHaveLength(2);
  });

  it("activates up to the limit and then refuses, to a caller who holds the key", { timeout: 60_000 }, async () => {
    const shop = await makeShop();
    const product = await makeLicensed(shop.id);
    const orderId = await mustPlace(shop.id, product.id);
    await releaseDownloads(orderId);

    const [license] = await licensesForOrder(orderId);
    if (!license) throw new Error("fixture: no licence minted");

    expect(
      (await activateLicense({ key: license.key, instanceIdentifier: "mac-1" })).valid,
    ).toBe(true);
    expect(
      (await activateLicense({ key: license.key, instanceIdentifier: "mac-2" })).valid,
    ).toBe(true);

    const third = await activateLicense({
      key: license.key,
      instanceIdentifier: "mac-3",
    });
    // A reason, because the caller has already proved they hold the key.
    expect(third).toEqual({ valid: false, reason: "activation_limit" });
  });

  it("lets a reinstall come back without eating a second seat", { timeout: 60_000 }, async () => {
    const shop = await makeShop();
    const product = await makeLicensed(shop.id);
    const orderId = await mustPlace(shop.id, product.id);
    await releaseDownloads(orderId);
    const [license] = await licensesForOrder(orderId);
    if (!license) throw new Error("fixture: no licence minted");

    await activateLicense({ key: license.key, instanceIdentifier: "mac-1" });
    await activateLicense({ key: license.key, instanceIdentifier: "mac-1" });

    const check = await validateLicense({ key: license.key });
    expect(check.valid && check.activationsUsed).toBe(1);
  });

  it("frees a seat on deactivate", { timeout: 60_000 }, async () => {
    const shop = await makeShop();
    const product = await makeLicensed(shop.id);
    const orderId = await mustPlace(shop.id, product.id);
    await releaseDownloads(orderId);
    const [license] = await licensesForOrder(orderId);
    if (!license) throw new Error("fixture: no licence minted");

    await activateLicense({ key: license.key, instanceIdentifier: "mac-1" });
    await activateLicense({ key: license.key, instanceIdentifier: "mac-2" });
    expect(
      await deactivateLicense({ key: license.key, instanceIdentifier: "mac-1" }),
    ).toEqual({ deactivated: true });

    const third = await activateLicense({
      key: license.key,
      instanceIdentifier: "mac-3",
    });
    expect(third.valid).toBe(true);
  });

  /*
   * The rule that keeps this endpoint from being a key-existence oracle. An
   * unknown key and a disabled one must be **byte-identical**, because anything
   * that tells them apart tells a caller which keys a seller has issued.
   */
  it("answers an unknown key and a disabled key identically", async () => {
    const shop = await makeShop();
    const product = await makeLicensed(shop.id);
    const orderId = await mustPlace(shop.id, product.id);
    await releaseDownloads(orderId);
    const [license] = await licensesForOrder(orderId);
    if (!license) throw new Error("fixture: no licence minted");

    await db
      .update(licenseKeys)
      .set({ status: "disabled" })
      .where(eq(licenseKeys.id, license.id));

    const disabled = await validateLicense({ key: license.key });
    const unknown = await validateLicense({ key: "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ" });
    expect(JSON.stringify(disabled)).toBe(JSON.stringify(unknown));

    // Activate says the same thing, because an oracle on one endpoint is an
    // oracle.
    const disabledActivate = await activateLicense({
      key: license.key,
      instanceIdentifier: "mac-9",
    });
    const unknownActivate = await activateLicense({
      key: "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ",
      instanceIdentifier: "mac-9",
    });
    expect(JSON.stringify(disabledActivate)).toBe(JSON.stringify(unknownActivate));
  });

  it("stops working when the order is refunded", { timeout: 60_000 }, async () => {
    const shop = await makeShop();
    const product = await makeLicensed(shop.id);
    const orderId = await mustPlace(shop.id, product.id);
    await releaseDownloads(orderId);
    const [license] = await licensesForOrder(orderId);
    if (!license) throw new Error("fixture: no licence minted");

    expect((await validateLicense({ key: license.key })).valid).toBe(true);
    await applyOrderStatus({ shopId: shop.id, orderId, status: "refunded" });
    expect(await validateLicense({ key: license.key })).toEqual({
      valid: false,
      reason: "unknown",
    });

    // The activation history survives, because "activated from this address on
    // this date" is what answers a `product_not_received` dispute months later.
    const [still] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(licenseKeys)
      .where(eq(licenseKeys.orderId, orderId));
    expect(still?.n).toBe(1);
  });
});
