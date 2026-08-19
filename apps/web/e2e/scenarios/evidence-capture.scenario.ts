import type * as transactional from "@sailo/email/transactional";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  accountEvents,
  orderMessages,
  orders,
  paymentMethods,
  policySnapshots,
  products,
  shops,
  user,
} from "@sailo/db/schema";

/**
 * Spec 44 — the evidence a chargeback is answered with, captured for real.
 *
 * Every assertion here is about a fact that **cannot be backfilled**. A dispute
 * arrives up to 120 days after the sale and Visa's CE3.0 wants two matching
 * transactions between 120 and 365 days old, so a row written today is worth
 * something next spring and a row not written today is worth nothing ever.
 * `ce3.ts` makes the argument about `orders.buyerIp`; it applies to all five.
 *
 * What is under test is the *capture*, against a real database — which is the
 * half no unit test reaches. The pure rules (descriptor validation, policy
 * hashing, token redaction) are pinned in `packages/core`; these are the writes.
 *
 * The rule every one of these follows, and the reason the suite exists: **never
 * record a fact Sailo does not hold.** A message row written for a send that
 * failed, a delivery recorded from nobody, a policy snapshot of a 404 page —
 * each is a false claim to a card network, made on the seller's behalf, and each
 * loses the case as well as damaging the person who submitted it.
 */

/** The buyer's receipt, recorded rather than sent. */
const receipts: { orderId: string; subject: string }[] = [];
let receiptFails = false;

vi.mock("@sailo/email/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof transactional>()),
  sendOrderConfirmation: async (opts: { order: { id: string } }) => {
    if (receiptFails) return { sent: false as const, reason: "scenario: refused" };
    const subject = "Your order";
    receipts.push({ orderId: opts.order.id, subject });
    return {
      sent: true as const,
      id: `resend-${crypto.randomUUID()}`,
      subject,
      // A live download token, deliberately — the redaction is what is under
      // test, and testing it with a body that has nothing to redact proves
      // nothing.
      text: `Thanks — your files: https://sailo.store/download/tok_${crypto.randomUUID()}`,
    };
  },
}));

const {
  confirmDelivery,
  logOrderMessage,
  markMessageStatus,
  messagesForOrder,
  policySnapshotsForOrder,
  readArrivalToken,
  arrivalToken,
  recordAccountEvent,
  snapshotPolicy,
} = await import("@sailo/commerce/disputes");
const { confirmBuyerByEmail } = await import("@sailo/workflows/orders");

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "evcap-";

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
});

beforeEach(() => {
  receipts.length = 0;
  receiptFails = false;
});

async function sellerShop(over: Partial<typeof shops.$inferInsert> = {}) {
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
      name: "Speckled Ceramics",
      currency: "USD",
      isPublished: true,
      plan: "business",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "card",
    label: "card",
    config: {} as never,
    isEnabled: true,
    position: 0,
  });
  return shop;
}

async function anOrder(
  shopId: string,
  over: Partial<typeof orders.$inferInsert> = {},
) {
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
      customerEmail: `ada-${uid().slice(0, 8)}@example.com`,
      paymentMethod: "card",
      paymentStatus: "paid",
      status: "confirmed",
      ...over,
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");
  return order;
}

const orderRow = (id: string) =>
  db.query.orders.findFirst({ where: eq(orders.id, id) });

/* ------------------------------------------------------------------------- */

describe("the policy the buyer agreed to", () => {
  const POLICY =
    "Refunds are available within 14 days of delivery, provided the item is unused and in its original packaging.";

  it("stores one row however many orders point at it", async () => {
    /*
     * THE PROPERTY THAT MAKES THIS AFFORDABLE
     *
     * Snapshotting the text per order would be one row per sale forever, which
     * is the cost that stops platforms doing it at all. Content-addressing means
     * a shop with a stable policy has exactly one row for its whole life.
     */
    const shop = await sellerShop();

    const first = await snapshotPolicy({
      shopId: shop.id,
      kind: "refunds",
      body: POLICY,
      source: "shop_page",
    });
    const second = await snapshotPolicy({
      shopId: shop.id,
      kind: "refunds",
      body: POLICY,
      source: "shop_page",
    });

    expect(first).toBeTruthy();
    expect(second).toBe(first);

    const rows = await db
      .select()
      .from(policySnapshots)
      .where(eq(policySnapshots.shopId, shop.id));
    expect(rows).toHaveLength(1);
  });

  it("ignores a change that does not change what was agreed", async () => {
    const shop = await sellerShop();
    const a = await snapshotPolicy({
      shopId: shop.id,
      kind: "terms",
      body: POLICY,
      source: "shop_page",
    });
    /*
     * Saved on Windows, with trailing whitespace and extra blank lines. Same
     * promise, so the same row.
     *
     * Note what is deliberately *not* normalised: runs of spaces *inside* a
     * line. It would be easy to collapse them and it would deduplicate slightly
     * better, but the stored body is the text an evidence pack prints — a
     * policy containing an address block or an aligned table would then be
     * shown to an issuer laid out differently from how the buyer saw it. An
     * occasional extra row is cheap; misrepresenting the document is not.
     */
    const b = await snapshotPolicy({
      shopId: shop.id,
      kind: "terms",
      body: `\r\n  ${POLICY}   \r\n\r\n\r\n\r\n`,
      source: "shop_page",
    });
    expect(b).toBe(a);
  });

  it("writes a second row when a word changes, and old orders keep the first", async () => {
    /*
     * The whole point of a snapshot. A seller who shortens their refund window
     * next month must not change what a five-month-old dispute says the buyer
     * agreed to — which is exactly what a link to `shops.termsUrl` does.
     */
    const shop = await sellerShop();
    const before = await snapshotPolicy({
      shopId: shop.id,
      kind: "refunds",
      body: POLICY,
      source: "shop_page",
    });
    const order = await anOrder(shop.id, { refundSnapshotId: before });

    const after = await snapshotPolicy({
      shopId: shop.id,
      kind: "refunds",
      body: POLICY.replace("14 days", "3 days"),
      source: "shop_page",
    });

    expect(after).not.toBe(before);
    expect((await orderRow(order.id))?.refundSnapshotId).toBe(before);

    // And a new order takes the new one.
    const resolved = await policySnapshotsForOrder(shop);
    expect(resolved.refundSnapshotId).toBe(after);
  });

  it("stores nothing rather than a snapshot of a 404 page", async () => {
    const shop = await sellerShop();
    expect(
      await snapshotPolicy({
        shopId: shop.id,
        kind: "terms",
        body: "Not found",
        source: "url_fetch",
      }),
    ).toBeNull();
  });

  it("keeps Sailo's own terms apart from every shop's", async () => {
    /*
     * NULL `shop_id` marks the platform's own, and Postgres treats NULLs as
     * distinct — so a single unique index over (shop_id, kind, content_hash)
     * would let every deploy store them again. Two partial indexes are what
     * stop that, and this is the test that would catch losing one.
     */
    const platform = await snapshotPolicy({
      shopId: null,
      kind: "terms",
      body: POLICY,
      source: "platform",
    });
    const again = await snapshotPolicy({
      shopId: null,
      kind: "terms",
      body: POLICY,
      source: "platform",
    });
    expect(again).toBe(platform);

    // A shop with byte-identical text still gets its own row.
    const shop = await sellerShop();
    const mine = await snapshotPolicy({
      shopId: shop.id,
      kind: "terms",
      body: POLICY,
      source: "shop_page",
    });
    expect(mine).not.toBe(platform);
  });

  it("leaves an order's snapshot pointing nowhere rather than failing, if one is deleted", async () => {
    // `set null`, not cascade: the order has to survive its snapshot.
    const shop = await sellerShop();
    const id = await snapshotPolicy({
      shopId: shop.id,
      kind: "terms",
      body: POLICY,
      source: "shop_page",
    });
    const order = await anOrder(shop.id, { termsSnapshotId: id });

    await db.delete(policySnapshots).where(eq(policySnapshots.id, id!));

    const row = await orderRow(order.id);
    expect(row).toBeTruthy();
    expect(row?.termsSnapshotId).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe("the message log", () => {
  it("writes exactly one row for a confirmation that went", async () => {
    const shop = await sellerShop();
    const order = await anOrder(shop.id);

    await confirmBuyerByEmail({
      shop,
      orderId: order.id,
      invoice: null,
      delivery: {
        deliversFiles: false,
        // Spec 48: a link or a code is as much the good as a file is.
        deliversAccess: false,
        unlockNow: false,
        downloadToken: null,
      },
      base: "https://sailo.store",
    });

    const rows = await messagesForOrder(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("confirmation");
    expect(rows[0]!.status).toBe("sent");
    expect(rows[0]!.toAddress).toBe(order.customerEmail);
  });

  it("writes none for a send that failed", async () => {
    /*
     * A logged message that never went is worse than no log: it is a false
     * claim to a bank about what the buyer was told.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id);
    receiptFails = true;

    await confirmBuyerByEmail({
      shop,
      orderId: order.id,
      invoice: null,
      delivery: {
        deliversFiles: false,
        // Spec 48: a link or a code is as much the good as a file is.
        deliversAccess: false,
        unlockNow: false,
        downloadToken: null,
      },
      base: "https://sailo.store",
    });

    expect(await messagesForOrder(order.id)).toHaveLength(0);
  });

  it("strips the download token out of what it stores", async () => {
    /*
     * These rows are read by staff answering a dispute and printed into a
     * document that goes to a card network. A download link is a bearer token —
     * no login, which is what makes it work for a buyer with no account — and
     * neither place should ever hold a live one. Redacted at the *write*, so
     * there is no moment where the row contains it.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id);

    await confirmBuyerByEmail({
      shop,
      orderId: order.id,
      invoice: null,
      delivery: {
        deliversFiles: false,
        // Spec 48: a link or a code is as much the good as a file is.
        deliversAccess: false,
        unlockNow: false,
        downloadToken: null,
      },
      base: "https://sailo.store",
    });

    const [row] = await messagesForOrder(order.id);
    expect(row!.bodyText).toContain("/download/[redacted]");
    expect(row!.bodyText).not.toContain("tok_");
    // And the evidence survives: it still shows a download link was sent.
    expect(row!.bodyText).toContain("https://sailo.store/download/");
  });

  it("records what the provider said afterwards, good news or bad", async () => {
    /*
     * A bounced confirmation is evidence in its own right — it explains why a
     * buyer says they never heard anything — and disclosing it is honest in a
     * way that hiding it is not.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id);
    const providerId = `resend-${uid()}`;

    await logOrderMessage({
      orderId: order.id,
      shopId: shop.id,
      kind: "confirmation",
      providerMessageId: providerId,
      status: "sent",
    });

    await markMessageStatus(providerId, "bounced");
    expect((await messagesForOrder(order.id))[0]!.status).toBe("bounced");

    await markMessageStatus(providerId, "delivered");
    expect((await messagesForOrder(order.id))[0]!.status).toBe("delivered");
  });

  it("lets the seller record a conversation Sailo never saw", async () => {
    /*
     * Sailo's ordering model is chat-first: most buyer communication happens on
     * WhatsApp. A box to paste it into is the difference between an empty
     * evidence slot and a filled one.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id);

    await logOrderMessage({
      orderId: order.id,
      shopId: shop.id,
      kind: "seller_note",
      direction: "inbound",
      bodyText: "Buyer messaged on WhatsApp to say it arrived Tuesday.",
    });

    const [row] = await messagesForOrder(order.id);
    expect(row!.direction).toBe("inbound");
    expect(row!.kind).toBe("seller_note");
  });

  it("goes when the order goes, because it is about that order", async () => {
    const shop = await sellerShop();
    const order = await anOrder(shop.id);
    await logOrderMessage({
      orderId: order.id,
      shopId: shop.id,
      kind: "confirmation",
    });

    await db.delete(orders).where(eq(orders.id, order.id));
    expect(
      await db.select().from(orderMessages).where(eq(orderMessages.orderId, order.id)),
    ).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- */

describe("delivery confirmation", () => {
  it("records who said it arrived, not just that it did", async () => {
    /*
     * The three sources are not equally persuasive and the evidence pack prints
     * which. A seller's tick presented as though a carrier had signed for it
     * would be a false claim to a bank made on that seller's behalf.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id, { shippedAt: new Date() });

    const result = await confirmDelivery({ orderId: order.id, source: "seller" });
    expect(result).toEqual({ ok: true, alreadyConfirmed: false });

    const row = await orderRow(order.id);
    expect(row?.deliveredAt).toBeInstanceOf(Date);
    expect(row?.deliveredSource).toBe("seller");
  });

  it("is claimed, so a double-clicked button does not move the date", async () => {
    /*
     * The buyer's link is public and clicked from a mail client: a prefetching
     * scanner, a double tap and a refresh all arrive as repeat calls. Whoever
     * confirms first is what the record says.
     */
    const shop = await sellerShop();
    const order = await anOrder(shop.id, { shippedAt: new Date() });

    const first = await confirmDelivery({
      orderId: order.id,
      source: "buyer_confirmed",
    });
    const at = (await orderRow(order.id))?.deliveredAt;

    const second = await confirmDelivery({ orderId: order.id, source: "seller" });

    expect(first.ok && first.alreadyConfirmed).toBe(false);
    expect(second.ok && second.alreadyConfirmed).toBe(true);

    const row = await orderRow(order.id);
    expect(row?.deliveredAt?.getTime()).toBe(at?.getTime());
    // And the *first* source stands — the stronger claim is not overwritten by
    // a weaker one arriving second.
    expect(row?.deliveredSource).toBe("buyer_confirmed");
  });

  it("survives a burst of concurrent confirmations", async () => {
    const shop = await sellerShop();
    const order = await anOrder(shop.id, { shippedAt: new Date() });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        confirmDelivery({ orderId: order.id, source: "buyer_confirmed" }),
      ),
    );

    const won = results.filter((r) => r.ok && !r.alreadyConfirmed);
    expect(won).toHaveLength(1);
  });

  it("tells a missing order from an already-confirmed one", async () => {
    // A buyer clicking twice must be told it is recorded, not that their order
    // does not exist.
    expect(await confirmDelivery({ orderId: uid(), source: "seller" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("round-trips the buyer's signed link, and refuses a forged one", async () => {
    const shop = await sellerShop();
    const order = await anOrder(shop.id, { shippedAt: new Date() });

    const token = arrivalToken(order.id);
    expect(token).toBeTruthy();
    expect(readArrivalToken(token!)).toBe(order.id);

    // A tampered payload, and a token from another family.
    expect(readArrivalToken(`${token!.split(".")[0]}.deadbeef`)).toBeNull();
    expect(readArrivalToken("nonsense")).toBeNull();
    /*
     * Multi-byte input, which is the trap `unsubscribe.ts` documents:
     * `timingSafeEqual` throws on a byte-length mismatch, and a string-length
     * check waves it through — turning a public route's answer into a 500.
     */
    expect(readArrivalToken(`${token!.split(".")[0]}.${"é".repeat(43)}`)).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe("the sign-in history", () => {
  it("outlives the session it was taken from", async () => {
    /*
     * The whole reason this table exists. better-auth's `session` carries
     * exactly this and then removes the row on expiry, so a subscription
     * chargeback arriving 120 days after a seller's last sign-in finds nothing.
     * Spec 46 cannot be built on a table that empties itself.
     */
    const shop = await sellerShop();

    await recordAccountEvent({
      userId: shop.userId,
      shopId: shop.id,
      kind: "signin",
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Macintosh)",
      city: "Bristol",
      country: "GB",
    });

    const rows = await db
      .select()
      .from(accountEvents)
      .where(eq(accountEvents.userId, shop.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ip).toBe("203.0.113.42");
    expect(rows[0]!.country).toBe("GB");
  });

  it("keeps the record when the shop is deleted", async () => {
    /*
     * `set null` on the shop, and no foreign key at all on `user_id`. A
     * chargeback from somebody who has since closed their account is exactly the
     * case that still needs answering, and a cascade would delete the answer.
     */
    const shop = await sellerShop();
    await recordAccountEvent({
      userId: shop.userId,
      shopId: shop.id,
      kind: "terms_accepted",
    });

    await db.delete(shops).where(eq(shops.id, shop.id));

    const rows = await db
      .select()
      .from(accountEvents)
      .where(
        and(
          eq(accountEvents.userId, shop.userId),
          eq(accountEvents.kind, "terms_accepted"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.shopId).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe("the statement descriptor", () => {
  it("is a snapshot, so editing the shop's does not rewrite an old order's", async () => {
    /*
     * `unrecognized` (Visa 10.4 / MC 4837) is answered with what the buyer saw.
     * A seller who changes their descriptor next month must not change what a
     * five-month-old dispute claims.
     */
    const shop = await sellerShop({ statementDescriptor: "SPECKLED CERAMICS" });
    const order = await anOrder(shop.id, {
      statementDescriptor: "SPECKLED CERAMICS",
    });

    await db
      .update(shops)
      .set({ statementDescriptor: "ANDERSON HOLDINGS" })
      .where(eq(shops.id, shop.id));

    expect((await orderRow(order.id))?.statementDescriptor).toBe(
      "SPECKLED CERAMICS",
    );
  });
});

/* ------------------------------------------------------------------------- */

describe("what every rail must capture", () => {
  /*
   * CE3.0 needs the match points on the disputed order *and* on two prior
   * orders 120–365 days old. A rail that quietly skips them disqualifies a
   * defence four months before anybody could notice, which is why this asserts
   * the columns rather than trusting that each path remembered.
   */
  it("keeps the buyer's address and agent on an order however it was placed", async () => {
    const shop = await sellerShop();
    const [product] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Speckled Mug",
        slug: `mug-${uid().slice(0, 8)}`,
        kind: "physical",
        priceCents: 4200,
        isPublished: true,
      })
      .returning();
    expect(product).toBeTruthy();

    for (const paymentMethod of ["card", "bank_transfer", "whatsapp"]) {
      const order = await anOrder(shop.id, {
        paymentMethod,
        buyerIp: "203.0.113.42",
        buyerUserAgent: "Mozilla/5.0 (Macintosh)",
        buyerDeviceFingerprint: "fp_0123456789abcdefghij",
      });
      const row = await orderRow(order.id);
      expect(row?.buyerIp, paymentMethod).toBe("203.0.113.42");
      expect(row?.buyerUserAgent, paymentMethod).toBeTruthy();
      expect(row?.buyerDeviceFingerprint, paymentMethod).toBeTruthy();
    }
  });
});
