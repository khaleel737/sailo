import { assertLocalDatabase } from "./local-only";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  categories,
  coupons,
  disputes,
  invoices,
  shopClosures,
  orderItems,
  orders,
  paymentMethods,
  productImages,
  products,
  session,
  shops,
  user,
} from "@sailo/db/schema";
import { deleteAccountFor, openObligations } from "@/lib/account-deletion";
/*
 * `tombstoneHandle` straight from the package: it is the package's own function, and
 * routing it through this app's wrapper only meant the wrapper had to re-export
 * something no app code used. `deleteAccountFor` still comes from the wrapper, because
 * that is what supplies the farewell email and the cache drop.
 */
import { tombstoneHandle } from "@sailo/account/deletion";
import { createInvoiceForOrder } from "@/lib/invoices";
import { liveShop } from "@/lib/shop-visibility";

/**
 * Account deletion, against a real database.
 *
 * The thing worth proving here is not that rows disappear — that part is a
 * `DELETE` and would work by accident. It is that the *right* rows survive:
 * `invoices.shopId` and `orders.shopId` both cascade from `shops`, so the
 * difference between this design and a one-line `DELETE FROM "user"` is
 * entirely in what is left standing afterwards. A regression there destroys a
 * tax record silently, and no unit test of a return value can see it.
 *
 * Stripe and Vercel Blob are absent by construction: `billingEnabled()` is
 * false with no key, and the shops here own no blob URLs that pass
 * `isStoredFileUrl`. Both paths are exercised as no-ops, which is the same
 * shape a shop on the free plan with no uploads really has.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

beforeAll(() => {
  assertLocalDatabase();
});

/**
 * A shop with the full spread: catalogue, a coupon, a rail, an order, an invoice.
 *
 * `email` is an optional second argument so a test can build two shops under
 * one address — which is the only way to exercise the closure fingerprint,
 * since by the time it is read both owner rows have been tombstoned and there
 * is no address left on either side of the comparison.
 */
async function fullShop(
  over: Partial<typeof orders.$inferInsert> = {},
  emailOverride?: string,
) {
  const userId = uid();
  const email = emailOverride ?? `delete-${userId.slice(0, 8)}@example.com`;

  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `shop-${userId.slice(0, 8)}`,
      name: "Test Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      avatarUrl: "https://example.com/avatar.png",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  const [category] = await db
    .insert(categories)
    .values({ shopId: shop.id, name: "Mugs", slug: "mugs" })
    .returning();

  const [product] = await db
    .insert(products)
    .values({
      shopId: shop.id,
      categoryId: category?.id ?? null,
      title: "Speckled mug",
      slug: `mug-${userId.slice(0, 8)}`,
      priceCents: 2500,
      kind: "physical",
      isPublished: true,
    })
    .returning();
  if (!product) throw new Error("fixture: product was not inserted");

  await db.insert(productImages).values({
    productId: product.id,
    url: "https://example.com/mug.jpg",
    position: 0,
  });

  await db.insert(coupons).values({
    shopId: shop.id,
    code: `SAVE-${userId.slice(0, 6)}`,
    discountType: "percent",
    // Basis points: 1000 = 10%.
    discountValue: 1000,
  });

  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "bank_transfer",
    isEnabled: true,
    config: { bankName: "Test Bank", accountNumber: "12345678" },
  });

  const orderId = uid();
  await db.insert(orders).values({
    id: orderId,
    shopId: shop.id,
    productId: product.id,
    productTitle: product.title,
    productKind: "physical",
    unitPriceCents: 2500,
    quantity: 1,
    currency: "USD",
    subtotalCents: 2500,
    totalCents: 2500,
    customerName: "Buyer",
    customerEmail: "buyer@example.com",
    paymentMethod: "bank_transfer",
    paymentStatus: "paid",
    status: "completed",
    shippedAt: new Date(),
    ...over,
  });

  await db.insert(orderItems).values({
    orderId,
    productId: product.id,
    title: product.title,
    kind: "physical",
    unitPriceCents: 2500,
    quantity: 1,
    subtotalCents: 2500,
    position: 0,
  });

  const invoice = await createInvoiceForOrder(shop.id, orderId);

  // A signed-in device, so revocation has something to revoke.
  await db.insert(session).values({
    id: uid(),
    userId,
    token: `tok-${uid()}`,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { userId, email, shop, product, orderId, invoice };
}

describe("what deletion refuses", () => {
  it("refuses while a paid physical order has not shipped", async () => {
    const { userId, shop } = await fullShop({
      status: "confirmed",
      paymentStatus: "paid",
      shippedAt: null,
    });

    const obligations = await openObligations(shop.id);
    expect(obligations.blocked).toBe(true);

    const result = await deleteAccountFor(userId);
    expect(result).toMatchObject({ ok: false, reason: "obligations" });

    // And nothing was touched on the way to refusing.
    const after = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(after?.deletedAt).toBeNull();
    expect(after?.handle).toBe(shop.handle);
  });

  it("refuses while a paid booking is still in the future", async () => {
    const { userId, shop } = await fullShop({
      status: "confirmed",
      paymentStatus: "paid",
      productKind: "service",
      shippedAt: null,
      scheduledFor: new Date(Date.now() + 7 * 86_400_000),
    });

    expect((await openObligations(shop.id)).blocked).toBe(true);
    expect(await deleteAccountFor(userId)).toMatchObject({ reason: "obligations" });
  });

  it("allows deletion once the obligation is settled", async () => {
    // An unpaid order is not an obligation — nobody is owed anything.
    const { userId, shop } = await fullShop({
      status: "new",
      paymentStatus: "unpaid",
      shippedAt: null,
    });

    expect((await openObligations(shop.id)).blocked).toBe(false);
    expect(await deleteAccountFor(userId)).toEqual({ ok: true });
  });
});

describe("what deletion keeps", () => {
  it("leaves the invoice, its number and its order intact", async () => {
    const { userId, shop, orderId, invoice } = await fullShop();
    expect(invoice).not.toBeNull();

    expect(await deleteAccountFor(userId)).toEqual({ ok: true });

    /*
     * The whole reason the `shops` row survives. Both of these cascade from
     * it, and a tax authority expects the per-shop sequence unbroken.
     */
    const keptInvoice = await db.query.invoices.findFirst({
      where: eq(invoices.orderId, orderId),
    });
    expect(keptInvoice?.number).toBe(invoice?.number);
    expect(keptInvoice?.token).toBe(invoice?.token);

    const keptOrder = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    expect(keptOrder).toBeTruthy();
    expect(keptOrder?.totalCents).toBe(2500);

    // The invoice counter stays where it was, so a later read of the sequence
    // cannot renumber anything.
    const keptShop = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(keptShop?.invoiceNextNumber).toBe(2);
  });

  it("keeps the buyer's own details on the order", async () => {
    // Buyers did not ask to be deleted, and the order is their receipt too.
    const { userId, orderId } = await fullShop();
    await deleteAccountFor(userId);

    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(order?.customerName).toBe("Buyer");
    expect(order?.customerEmail).toBe("buyer@example.com");
    // And the snapshot of what they bought, which outlives the product row.
    expect(order?.productTitle).toBe("Speckled mug");
  });
});

describe("what deletion destroys", () => {
  it("removes the catalogue, the coupons and the seller's bank details", async () => {
    const { userId, shop, product } = await fullShop();
    await deleteAccountFor(userId);

    expect(
      await db.query.products.findFirst({ where: eq(products.id, product.id) }),
    ).toBeUndefined();
    // Images cascade from the product rather than being deleted by name.
    expect(
      await db.query.productImages.findFirst({
        where: eq(productImages.productId, product.id),
      }),
    ).toBeUndefined();
    expect(
      await db.query.categories.findFirst({ where: eq(categories.shopId, shop.id) }),
    ).toBeUndefined();
    expect(
      await db.query.coupons.findFirst({ where: eq(coupons.shopId, shop.id) }),
    ).toBeUndefined();
    expect(
      await db.query.paymentMethods.findFirst({
        where: eq(paymentMethods.shopId, shop.id),
      }),
    ).toBeUndefined();
  });

  it("signs out every device", async () => {
    const { userId } = await fullShop();
    await deleteAccountFor(userId);

    const live = await db.query.session.findFirst({
      where: eq(session.userId, userId),
    });
    expect(live).toBeUndefined();
  });

  it("tombstones the seller so the address can no longer be reached", async () => {
    const { userId, email } = await fullShop();
    await deleteAccountFor(userId);

    const owner = await db.query.user.findFirst({ where: eq(user.id, userId) });
    expect(owner?.email).not.toBe(email);
    expect(owner?.email).toMatch(/@sailo\.invalid$/);
    expect(owner?.emailVerified).toBe(false);
  });
});

/**
 * The closure record — what a deleted shop leaves behind.
 *
 * This is the half of deletion that has no other test possible. Everything the
 * record names is read out of rows the next four steps destroy, so the only way
 * to prove it is written *first* is to delete a shop and then read the record
 * back and find things on it that no longer exist anywhere else.
 *
 * The gap it closes: take deposits for a fortnight, never ship, delete the
 * account. Before this, the surviving orders no longer said who ran the shop or
 * what it claimed to sell, and the honest answer to "what happened here" was
 * that we erased it ourselves, on request, at the moment it became interesting.
 */
describe("the closure record", () => {
  it("keeps what the shop was, after the shop has stopped being it", async () => {
    const { userId, shop } = await fullShop();
    await deleteAccountFor(userId);

    const closure = await db.query.shopClosures.findFirst({
      where: eq(shopClosures.shopId, shop.id),
    });

    expect(closure).toBeTruthy();
    // The handle, which is the string every support email in the world still
    // quotes long after it has been released back to the pool.
    expect(closure?.handle).toBe(shop.handle);
    expect(closure?.closedBy).toBe("seller");
    expect(closure?.currency).toBe("USD");

    /*
     * The catalogue. `products` is hard-deleted by `hardDeleteShopContent`, so
     * this is the only place on the platform that still knows what this shop
     * said it sold — which is the half of the record that reads as evidence
     * rather than as accounting.
     */
    expect(closure?.catalogue).toEqual([
      { title: "Speckled mug", kind: "physical", priceCents: 2500 },
    ]);

    // And the shop it points at really is gone as a shop.
    const tombstone = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(tombstone?.name).toBe("Deleted shop");
    expect(tombstone?.deletedAt).not.toBeNull();
  });

  it("erases the name of a seller who left cleanly, and keeps the digest", async () => {
    /*
     * The retention split, and the direction that matters most: an ordinary
     * departure is a real deletion. The shape of the business is kept because
     * none of it is personal data about the seller; the name and address are
     * not, because there is no legitimate interest in a dispute that does not
     * exist.
     */
    const { userId, shop } = await fullShop();
    await deleteAccountFor(userId);

    const closure = await db.query.shopClosures.findFirst({
      where: eq(shopClosures.shopId, shop.id),
    });

    expect(closure?.identityRetained).toBe("none");
    expect(closure?.ownerEmail).toBeNull();
    expect(closure?.ownerName).toBeNull();
    expect(closure?.shopName).toBeNull();

    // Kept, always, and never readable. This is what recognises them signing
    // up again without storing anything that can be mailed, sold or exported.
    expect(closure?.ownerEmailHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the identity when the shop was suspended", async () => {
    const { userId, shop } = await fullShop();
    await db
      .update(shops)
      .set({ suspendedAt: new Date(), suspendedReason: "counterfeit goods" })
      .where(eq(shops.id, shop.id));

    await deleteAccountFor(userId);

    const closure = await db.query.shopClosures.findFirst({
      where: eq(shopClosures.shopId, shop.id),
    });

    expect(closure?.identityRetained).toBe("suspicion");
    expect(closure?.ownerEmail).toContain("@example.com");
    expect(closure?.shopName).toBe("Test Shop");
    // The reason we suspended them, which is the sentence somebody reading
    // this in a year needs more than any of the numbers.
    expect(closure?.suspendedReason).toBe("counterfeit goods");
  });

  it("recognises the same owner across two closed shops", async () => {
    /*
     * The whole point of a keyed digest rather than a stored address. Both
     * shops have had their owner rows tombstoned by the time this reads them,
     * so there is no email left on either side of this comparison — and the
     * two still match.
     */
    const email = `serial-${uid().slice(0, 8)}@example.com`;

    const first = await fullShop({}, email);
    await deleteAccountFor(first.userId);
    const second = await fullShop({}, email);
    await deleteAccountFor(second.userId);

    const rows = await db
      .select({ shopId: shopClosures.shopId, hash: shopClosures.ownerEmailHash })
      .from(shopClosures)
      .where(
        inArray(shopClosures.shopId, [first.shop.id, second.shop.id]),
      );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.hash).toBe(rows[1]?.hash);
    expect(rows[0]?.hash).toBeTruthy();
  });

  it("does not thin the record when a deletion is retried", async () => {
    /*
     * A crash halfway leaves a shop already emptied, and a naive upsert would
     * then overwrite a complete record with what the second pass could still
     * see — which is nothing. `recordClosure` takes the greater of each count
     * for exactly this, and it is the failure mode that would be invisible
     * without a test: the record would exist, and it would be empty.
     */
    const { userId, shop } = await fullShop();
    await deleteAccountFor(userId);

    const before = await db.query.shopClosures.findFirst({
      where: eq(shopClosures.shopId, shop.id),
    });

    await deleteAccountFor(userId);

    const after = await db.query.shopClosures.findFirst({
      where: eq(shopClosures.shopId, shop.id),
    });

    expect(after?.orderCount).toBe(before?.orderCount);
    expect(after?.productCount).toBe(before?.productCount);
    expect(after?.catalogue).toEqual(before?.catalogue);
    expect(after?.ownerEmailHash).toBe(before?.ownerEmailHash);
  });

  it("writes exactly one record per shop, however many times it runs", async () => {
    const { userId, shop } = await fullShop();
    await deleteAccountFor(userId);
    await deleteAccountFor(userId);

    const rows = await db
      .select({ id: shopClosures.id })
      .from(shopClosures)
      .where(eq(shopClosures.shopId, shop.id));

    expect(rows).toHaveLength(1);
  });
});

describe("the tombstone is invisible and the handle is free", () => {
  it("releases the handle for someone else to register", async () => {
    const { userId, shop } = await fullShop();
    const oldHandle = shop.handle;

    await deleteAccountFor(userId);

    const renamed = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(renamed?.handle).toBe(tombstoneHandle(shop.id));
    expect(renamed?.isPublished).toBe(false);
    expect(renamed?.deletedAt).toBeInstanceOf(Date);

    // Nothing holds the old handle any more, so it can be claimed again.
    const stillTaken = await db.query.shops.findFirst({
      where: eq(shops.handle, oldHandle),
    });
    expect(stillTaken).toBeUndefined();
  });

  it("never comes back from a public query", async () => {
    const { userId, shop } = await fullShop();
    await deleteAccountFor(userId);

    /*
     * `liveShop` is the predicate every public path now shares. Before
     * `deletedAt` existed the tombstone would have passed a published check
     * and a suspension check both — it is neither published nor suspended.
     */
    const visible = await db.query.shops.findFirst({
      where: liveShop(eq(shops.id, shop.id)),
    });
    expect(visible).toBeUndefined();

    // Even if something re-published the row by accident, the predicate holds.
    await db.update(shops).set({ isPublished: true }).where(eq(shops.id, shop.id));
    expect(
      await db.query.shops.findFirst({ where: liveShop(eq(shops.id, shop.id)) }),
    ).toBeUndefined();
  });
});

describe("a retry after a crash finishes rather than corrupts", () => {
  it("is idempotent", async () => {
    const { userId, shop, orderId, invoice } = await fullShop();

    expect(await deleteAccountFor(userId)).toEqual({ ok: true });
    // Whatever failed mid-way, running it again must complete cleanly.
    expect(await deleteAccountFor(userId)).toEqual({ ok: true });

    const after = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(after?.handle).toBe(tombstoneHandle(shop.id));
    // The second run must not re-stamp the tombstone with a later time.
    expect(after?.deletedAt).toBeInstanceOf(Date);

    // And the ledger is still there after two passes.
    const keptInvoice = await db.query.invoices.findFirst({
      where: eq(invoices.orderId, orderId),
    });
    expect(keptInvoice?.number).toBe(invoice?.number);

    const lines = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    expect(lines[0]?.count).toBe(1);
  });

  it("does not re-tombstone an already-deleted shop's timestamp", async () => {
    const { userId, shop } = await fullShop();
    await deleteAccountFor(userId);

    const first = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    await deleteAccountFor(userId);
    const second = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });

    expect(second?.deletedAt?.getTime()).toBe(first?.deletedAt?.getTime());
  });
});

describe("openObligations counts only what is really owed", () => {
  it("ignores shipped, completed, cancelled and refunded orders", async () => {
    const { shop } = await fullShop();
    // The fixture's order is paid, completed and shipped.
    expect(await openObligations(shop.id)).toEqual({
      blocked: false,
      count: 0,
      openDisputes: 0,
      payoutsHeld: false,
    });

    await db
      .update(orders)
      .set({ status: "cancelled", shippedAt: null })
      .where(and(eq(orders.shopId, shop.id)));
    expect((await openObligations(shop.id)).blocked).toBe(false);
  });

  /*
   * The hole the order test above cannot see.
   *
   * Both its branches are about *delivery* — an unshipped physical order, or a
   * booking still in the future — so a seller of digital downloads passes it
   * trivially: the file is delivered at checkout, the order goes straight to
   * `completed`, and until this existed the account could be deleted with forty
   * chargebacks live against it. Deleting mid-dispute does not make the dispute
   * go away; it erases the order, the product and the download log needed to
   * answer it, and an unanswered dispute is lost by default at Sailo's expense.
   */
  it("refuses while a card network still has a live case", async () => {
    const { shop } = await fullShop();
    expect((await openObligations(shop.id)).blocked).toBe(false);

    await db.insert(disputes).values({
      scope: "connected",
      shopId: shop.id,
      stripeDisputeId: `dp_test_${shop.id.slice(0, 8)}`,
      status: "needs_response",
      reason: "fraudulent",
      amountCents: 4_500,
      currency: "usd",
      stripeCreatedAt: new Date(),
    });

    const obligations = await openObligations(shop.id);
    expect(obligations.blocked).toBe(true);
    expect(obligations.openDisputes).toBe(1);
    // Reported separately, because the two are answered by different actions:
    // an undelivered order is shipped or refunded, a dispute is waited out.
    expect(obligations.count).toBe(0);
  });

  it("stops refusing once the bank has decided", async () => {
    // A resolved dispute is not an obligation — there is nothing left to answer
    // and nothing left to keep the seller in the account for.
    const { shop } = await fullShop();
    await db.insert(disputes).values({
      scope: "connected",
      shopId: shop.id,
      stripeDisputeId: `dp_done_${shop.id.slice(0, 8)}`,
      status: "lost",
      reason: "fraudulent",
      amountCents: 4_500,
      currency: "usd",
      stripeCreatedAt: new Date(),
    });

    expect((await openObligations(shop.id)).blocked).toBe(false);
  });

  it("refuses while payouts are held", async () => {
    /*
     * Somebody, or the dispute ladder, deliberately stopped money leaving this
     * account. Deletion disconnects the Stripe account the hold is set on,
     * which is exactly the thing the hold exists to prevent happening quietly.
     */
    const { shop } = await fullShop();
    await db
      .update(shops)
      .set({ payoutsPausedAt: new Date(), payoutsPausedReason: "chargeback_rate" })
      .where(eq(shops.id, shop.id));

    const obligations = await openObligations(shop.id);
    expect(obligations.blocked).toBe(true);
    expect(obligations.payoutsHeld).toBe(true);
  });
});
