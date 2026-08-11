import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  broadcastDeliveries,
  broadcasts,
  categories,
  clients,
  coupons,
  emailSuppressions,
  orderItems,
  orders,
  paymentMethods,
  products,
  shops,
  tickets,
  user,
} from "@sailo/db/schema";
import { audienceFor, audienceSize, suppress } from "@/lib/broadcasts/audience";
import { parseSegment, type Segment } from "@/lib/broadcasts/segments";
import { queueBroadcast, runBroadcastQueue } from "@/lib/broadcasts/send";
import { confirmSubscriber, subscribeToken, readSubscribeToken } from "@/lib/broadcasts/subscribe";

/**
 * Segments, scheduling and signups, against a real database.
 *
 * Everything here is a claim a unit test cannot make. `parseSegment` can be
 * checked in isolation; whether "bought this product" actually finds a buyer
 * whose order was written as a header with no lines cannot — that is a fact
 * about a decade of rows in two shapes, and the only honest way to ask it is
 * to write both shapes and run the query.
 *
 * The rules being defended:
 *
 *  - a condition never widens an audience past the legal floor;
 *  - a condition that means "bought X" finds the same buyer whether the order
 *    is a cart or the pre-cart header-only shape;
 *  - a scheduled send fires once, and only for a shop still entitled to send;
 *  - a signup writes nothing until the address is proven, and then writes a
 *    contact exactly once however many times the link is clicked.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

beforeAll(() => {
  assertLocalDatabase();
});

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
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
      name: "Segment Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      timeZone: "UTC",
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

async function makeProduct(
  shopId: string,
  over: Partial<typeof products.$inferInsert> = {},
) {
  const [row] = await db
    .insert(products)
    .values({
      shopId,
      title: "Blue Hoodie",
      slug: `p-${uid().slice(0, 8)}`,
      kind: "physical",
      priceCents: 4_000,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: product was not inserted");
  return row;
}

async function makeContact(
  shopId: string,
  email: string,
  over: Partial<typeof clients.$inferInsert> = {},
) {
  const [row] = await db
    .insert(clients)
    .values({
      shopId,
      name: email.split("@")[0] ?? "Contact",
      email,
      marketingConsentAt: new Date(),
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: client was not inserted");
  return row;
}

/**
 * An order written the way carts write them: a header *and* a line.
 *
 * `withLine: false` writes the pre-cart shape instead — a header carrying the
 * product and no `order_items` row at all. Both exist in production, and a
 * segment that only reads one of them is the header-vs-lines bug.
 */
async function makeOrder(opts: {
  shopId: string;
  clientId: string;
  productId: string;
  withLine?: boolean;
  over?: Partial<typeof orders.$inferInsert>;
}) {
  const [order] = await db
    .insert(orders)
    .values({
      shopId: opts.shopId,
      clientId: opts.clientId,
      productId: opts.productId,
      productTitle: "Blue Hoodie",
      productKind: "physical",
      unitPriceCents: 4_000,
      subtotalCents: 4_000,
      totalCents: 4_000,
      quantity: 1,
      itemCount: 1,
      status: "completed",
      paymentStatus: "paid",
      paymentMethod: "cod",
      ...opts.over,
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");

  if (opts.withLine !== false) {
    await db.insert(orderItems).values({
      orderId: order.id,
      productId: opts.productId,
      title: "Blue Hoodie",
      kind: "physical",
      unitPriceCents: 4_000,
      quantity: 1,
      subtotalCents: 4_000,
    });
  }
  return order;
}

const segment = (rules: Segment["rules"], match: "all" | "any" = "all"): Segment =>
  parseSegment({ match, rules });

const emails = async (shopId: string, s: Segment) =>
  (await audienceFor(shopId, s)).recipients.map((r) => r.email).toSorted();

/* -------------------------------------------------------------------------- */

describe("a segment never escapes the legal floor", () => {
  it("still excludes anyone who never consented, however wide the rule", async () => {
    const shop = await makeShop();
    const buyer = await makeContact(shop.id, "yes@example.com");
    const silent = await makeContact(shop.id, "no@example.com", {
      marketingConsentAt: null,
    });
    const product = await makeProduct(shop.id);
    await makeOrder({ shopId: shop.id, clientId: buyer.id, productId: product.id });
    await makeOrder({ shopId: shop.id, clientId: silent.id, productId: product.id });

    // Both bought it. Only one may be mailed about it.
    expect(await emails(shop.id, segment([{ type: "product", value: product.id }]))).toEqual([
      "yes@example.com",
    ]);
  });

  it("still excludes a suppressed address a rule would otherwise select", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "gone@example.com", { tags: ["vip"] });
    await makeContact(shop.id, "here@example.com", { tags: ["vip"] });
    await suppress({ shopId: shop.id, email: "gone@example.com", reason: "bounced" });

    expect(await emails(shop.id, segment([{ type: "tag", value: "vip" }]))).toEqual([
      "here@example.com",
    ]);
  });

  it("counts exactly what it would send to", async () => {
    // The number on the compose screen and the rows the send writes come from
    // two different queries; a disagreement between them reads as a bug in
    // the send rather than in the count.
    const shop = await makeShop();
    await makeContact(shop.id, "a@example.com", { tags: ["vip"] });
    await makeContact(shop.id, "b@example.com");

    const s = segment([{ type: "tag", value: "vip" }]);
    expect(await audienceSize(shop.id, s)).toBe(1);
    expect((await audienceFor(shop.id, s)).recipients).toHaveLength(1);
  });
});

describe("what they bought", () => {
  it("finds a buyer whose order has lines and one whose order has only a header", async () => {
    /*
     * The header-vs-lines shape. Orders written before carts existed carry
     * the product on the header and have no `order_items` row, and those are
     * a shop's oldest customers — the ones a restock announcement most wants
     * to reach.
     */
    const shop = await makeShop();
    const modern = await makeContact(shop.id, "modern@example.com");
    const ancient = await makeContact(shop.id, "ancient@example.com");
    const other = await makeContact(shop.id, "other@example.com");
    const hoodie = await makeProduct(shop.id);
    const mug = await makeProduct(shop.id, { title: "Mug" });

    await makeOrder({ shopId: shop.id, clientId: modern.id, productId: hoodie.id });
    await makeOrder({
      shopId: shop.id,
      clientId: ancient.id,
      productId: hoodie.id,
      withLine: false,
    });
    await makeOrder({ shopId: shop.id, clientId: other.id, productId: mug.id });

    expect(await emails(shop.id, segment([{ type: "product", value: hoodie.id }]))).toEqual([
      "ancient@example.com",
      "modern@example.com",
    ]);
  });

  it("does not count a cancelled order as a purchase", async () => {
    const shop = await makeShop();
    const buyer = await makeContact(shop.id, "cancelled@example.com");
    const product = await makeProduct(shop.id);
    await makeOrder({
      shopId: shop.id,
      clientId: buyer.id,
      productId: product.id,
      over: { status: "cancelled" },
    });

    expect(await emails(shop.id, segment([{ type: "product", value: product.id }]))).toEqual([]);
    // And they read as somebody who has never ordered, which is what the
    // "never bought anything" campaign is for.
    expect(await emails(shop.id, segment([{ type: "neverOrdered" }]))).toEqual([
      "cancelled@example.com",
    ]);
  });

  it("reaches everyone who bought from a category, through the product", async () => {
    const shop = await makeShop();
    const [category] = await db
      .insert(categories)
      .values({ shopId: shop.id, name: "Knitwear", slug: `k-${uid().slice(0, 8)}` })
      .returning();
    if (!category) throw new Error("fixture: category was not inserted");

    const inside = await makeProduct(shop.id, { categoryId: category.id });
    const outside = await makeProduct(shop.id, { title: "Mug" });
    const a = await makeContact(shop.id, "knit@example.com");
    const b = await makeContact(shop.id, "mug@example.com");
    await makeOrder({ shopId: shop.id, clientId: a.id, productId: inside.id });
    await makeOrder({ shopId: shop.id, clientId: b.id, productId: outside.id });

    expect(await emails(shop.id, segment([{ type: "category", value: category.id }]))).toEqual([
      "knit@example.com",
    ]);
  });

  it("selects by what kind of thing was sold, from the snapshot", async () => {
    const shop = await makeShop();
    const download = await makeProduct(shop.id, { kind: "digital", title: "Preset pack" });
    const buyer = await makeContact(shop.id, "digital@example.com");
    await makeContact(shop.id, "nobody@example.com");
    await makeOrder({
      shopId: shop.id,
      clientId: buyer.id,
      productId: download.id,
      over: { productKind: "digital" },
    });

    expect(await emails(shop.id, segment([{ type: "kind", value: "digital" }]))).toEqual([
      "digital@example.com",
    ]);
  });

  it("finds who redeemed a code", async () => {
    const shop = await makeShop();
    const [coupon] = await db
      .insert(coupons)
      .values({ shopId: shop.id, code: `SPRING${uid().slice(0, 4)}`, discountValue: 1_000 })
      .returning();
    if (!coupon) throw new Error("fixture: coupon was not inserted");

    const used = await makeContact(shop.id, "used@example.com");
    const notUsed = await makeContact(shop.id, "full-price@example.com");
    const product = await makeProduct(shop.id);
    await makeOrder({
      shopId: shop.id,
      clientId: used.id,
      productId: product.id,
      over: { couponId: coupon.id, couponCode: coupon.code },
    });
    await makeOrder({ shopId: shop.id, clientId: notUsed.id, productId: product.id });

    expect(await emails(shop.id, segment([{ type: "coupon", value: coupon.id }]))).toEqual([
      "used@example.com",
    ]);
  });

  it("finds who actually turned up, not merely who bought a ticket", async () => {
    const shop = await makeShop();
    const event = await makeProduct(shop.id, { kind: "event", title: "Launch night" });
    const attended = await makeContact(shop.id, "came@example.com");
    const noShow = await makeContact(shop.id, "missed@example.com");

    const cameOrder = await makeOrder({
      shopId: shop.id,
      clientId: attended.id,
      productId: event.id,
    });
    const missedOrder = await makeOrder({
      shopId: shop.id,
      clientId: noShow.id,
      productId: event.id,
    });

    await db.insert(tickets).values([
      {
        shopId: shop.id,
        orderId: cameOrder.id,
        productId: event.id,
        code: `T${uid().slice(0, 10)}`,
        status: "used",
      },
      {
        shopId: shop.id,
        orderId: missedOrder.id,
        productId: event.id,
        code: `T${uid().slice(0, 10)}`,
        status: "valid",
      },
    ]);

    expect(await emails(shop.id, segment([{ type: "attended", value: event.id }]))).toEqual([
      "came@example.com",
    ]);
  });
});

describe("what they have done", () => {
  it("finds the lapsed without sweeping up everyone who never bought", async () => {
    /*
     * The half of this rule that is easy to forget: "no order in 90 days" is
     * true of every person who has never bought anything, which is most of a
     * healthy list. A win-back email to them is a win-back email to strangers.
     */
    const shop = await makeShop();
    const product = await makeProduct(shop.id);

    const lapsed = await makeContact(shop.id, "lapsed@example.com");
    const recent = await makeContact(shop.id, "recent@example.com");
    await makeContact(shop.id, "never@example.com");

    const old = new Date(Date.now() - 200 * 86_400_000);
    await makeOrder({
      shopId: shop.id,
      clientId: lapsed.id,
      productId: product.id,
      over: { createdAt: old },
    });
    await makeOrder({ shopId: shop.id, clientId: recent.id, productId: product.id });

    expect(await emails(shop.id, segment([{ type: "lapsed", n: 90 }]))).toEqual([
      "lapsed@example.com",
    ]);
  });

  it("adds up spend net of refunds", async () => {
    const shop = await makeShop();
    const product = await makeProduct(shop.id);
    const big = await makeContact(shop.id, "big@example.com");
    const refunded = await makeContact(shop.id, "refunded@example.com");

    await makeOrder({
      shopId: shop.id,
      clientId: big.id,
      productId: product.id,
      over: { totalCents: 12_000 },
    });
    // Spent twelve thousand and got it all back: they have spent nothing, and
    // a VIP discount aimed at the best customers must not reach them.
    await makeOrder({
      shopId: shop.id,
      clientId: refunded.id,
      productId: product.id,
      over: { totalCents: 12_000, refundedCents: 12_000 },
    });

    expect(await emails(shop.id, segment([{ type: "minSpend", n: 10_000 }]))).toEqual([
      "big@example.com",
    ]);
  });

  it("finds an order that was started and never paid for", async () => {
    const shop = await makeShop();
    const product = await makeProduct(shop.id);
    const abandoned = await makeContact(shop.id, "abandoned@example.com");
    const paid = await makeContact(shop.id, "paid@example.com");

    await makeOrder({
      shopId: shop.id,
      clientId: abandoned.id,
      productId: product.id,
      over: { status: "new", paymentStatus: "unpaid" },
    });
    await makeOrder({ shopId: shop.id, clientId: paid.id, productId: product.id });

    expect(await emails(shop.id, segment([{ type: "abandoned", n: 7 }]))).toEqual([
      "abandoned@example.com",
    ]);
  });

  it("intersects under `all` and unions under `any`", async () => {
    const shop = await makeShop();
    const product = await makeProduct(shop.id);
    const both = await makeContact(shop.id, "both@example.com", { tags: ["vip"] });
    await makeContact(shop.id, "tagged@example.com", { tags: ["vip"] });
    const bought = await makeContact(shop.id, "bought@example.com");

    await makeOrder({ shopId: shop.id, clientId: both.id, productId: product.id });
    await makeOrder({ shopId: shop.id, clientId: bought.id, productId: product.id });

    const rules = [
      { type: "tag", value: "vip" },
      { type: "ordered" },
    ];
    expect(await emails(shop.id, segment(rules, "all"))).toEqual(["both@example.com"]);
    expect(await emails(shop.id, segment(rules, "any"))).toEqual([
      "both@example.com",
      "bought@example.com",
      "tagged@example.com",
    ]);
  });

  it("reads a pre-segment broadcast's tag as the audience it went to", async () => {
    // The compatibility promise: rows written before this feature existed
    // still describe the audience they were actually sent to.
    const shop = await makeShop();
    await makeContact(shop.id, "vip@example.com", { tags: ["vip"] });
    await makeContact(shop.id, "plain@example.com");

    const [row] = await db
      .insert(broadcasts)
      .values({
        shopId: shop.id,
        subject: "Old news",
        bodyMarkdown: "Hello",
        audienceTag: "vip",
      })
      .returning();
    if (!row) throw new Error("fixture: broadcast was not inserted");

    const parsed = parseSegment(row.audienceFilter, row.audienceTag);
    expect(await emails(shop.id, parsed)).toEqual(["vip@example.com"]);
  });
});

describe("queueing a segmented broadcast", () => {
  it("writes one delivery per matching contact and none for the rest", async () => {
    const shop = await makeShop();
    const product = await makeProduct(shop.id);
    const buyer = await makeContact(shop.id, "buyer@example.com");
    await makeContact(shop.id, "browser@example.com");
    await makeOrder({ shopId: shop.id, clientId: buyer.id, productId: product.id });

    const [row] = await db
      .insert(broadcasts)
      .values({
        shopId: shop.id,
        subject: "Back in stock",
        bodyMarkdown: "It's back, {{first_name}}.",
        audienceFilter: { match: "all", rules: [{ type: "product", value: product.id }] },
      })
      .returning();
    if (!row) throw new Error("fixture: broadcast was not inserted");

    const result = await queueBroadcast({ shop, broadcastId: row.id });
    expect(result).toMatchObject({ ok: true, queued: 1 });

    const written = await db.query.broadcastDeliveries.findMany({
      where: eq(broadcastDeliveries.broadcastId, row.id),
    });
    expect(written.map((d) => d.email)).toEqual(["buyer@example.com"]);
  });

  it("asks the question again at queue time, not when the draft was saved", async () => {
    /*
     * The whole reason an audience is stored as a question. A draft written
     * on Tuesday and sent on Friday must include Wednesday's new subscriber.
     */
    const shop = await makeShop();
    const [row] = await db
      .insert(broadcasts)
      .values({
        shopId: shop.id,
        subject: "Weekly",
        bodyMarkdown: "Hello",
        audienceFilter: { match: "all", rules: [] },
      })
      .returning();
    if (!row) throw new Error("fixture: broadcast was not inserted");

    await makeContact(shop.id, "joined-after-the-draft@example.com");

    const result = await queueBroadcast({ shop, broadcastId: row.id });
    expect(result).toMatchObject({ ok: true, queued: 1 });
  });
});

describe("a scheduled send", () => {
  async function scheduled(shopId: string, scheduledAt: Date) {
    const [row] = await db
      .insert(broadcasts)
      .values({
        shopId,
        subject: "Friday drop",
        bodyMarkdown: "Hello",
        status: "scheduled",
        scheduledAt,
      })
      .returning();
    if (!row) throw new Error("fixture: broadcast was not inserted");
    return row;
  }

  const reread = async (id: string) =>
    db.query.broadcasts.findFirst({ where: eq(broadcasts.id, id) });

  it("does not go out before its time", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "a@example.com");
    const row = await scheduled(shop.id, new Date(Date.now() + 3_600_000));

    await runBroadcastQueue();

    expect((await reread(row.id))?.status).toBe("scheduled");
    expect(
      await db.query.broadcastDeliveries.findMany({
        where: eq(broadcastDeliveries.broadcastId, row.id),
      }),
    ).toHaveLength(0);
  });

  it("becomes a queue once due, exactly once", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "a@example.com");
    const row = await scheduled(shop.id, new Date(Date.now() - 60_000));

    await runBroadcastQueue();
    const first = await db.query.broadcastDeliveries.findMany({
      where: eq(broadcastDeliveries.broadcastId, row.id),
    });
    expect(first).toHaveLength(1);
    expect((await reread(row.id))?.status).not.toBe("scheduled");

    // A second tick must not re-queue what the first one already claimed.
    await runBroadcastQueue();
    expect(
      await db.query.broadcastDeliveries.findMany({
        where: eq(broadcastDeliveries.broadcastId, row.id),
      }),
    ).toHaveLength(1);
  });

  it("unschedules rather than sends when the shop is no longer on a plan that may", async () => {
    /*
     * A seller who scheduled six weeks of campaigns and then downgraded has
     * not bought the right to keep sending them. The words stay theirs — it
     * goes back to a draft, not to the bin.
     */
    const shop = await makeShop({ plan: "free", subscriptionStatus: null });
    await makeContact(shop.id, "a@example.com");
    const row = await scheduled(shop.id, new Date(Date.now() - 60_000));

    await runBroadcastQueue();

    const after = await reread(row.id);
    expect(after?.status).toBe("draft");
    expect(after?.scheduledAt).toBeNull();
    expect(
      await db.query.broadcastDeliveries.findMany({
        where: eq(broadcastDeliveries.broadcastId, row.id),
      }),
    ).toHaveLength(0);
  });
});

describe("joining the list", () => {
  const SECRET = "scenario-secret-for-subscribe-tokens";

  function claimFor(shopId: string, email: string, name: string | null = null) {
    process.env.BETTER_AUTH_SECRET = SECRET;
    const token = subscribeToken({ shopId, email, name });
    const claim = readSubscribeToken(token ?? "");
    if (!claim) throw new Error("fixture: token did not round-trip");
    return claim;
  }

  it("creates a consented contact only when the link is clicked", async () => {
    const shop = await makeShop();
    const claim = claimFor(shop.id, "new@example.com", "Nadia");

    // Nothing exists until then: a public form that wrote a row per submission
    // is a public form that fills a seller's list with typos and bots.
    expect(
      await db.query.clients.findFirst({
        where: and(eq(clients.shopId, shop.id), eq(clients.email, "new@example.com")),
      }),
    ).toBeUndefined();

    expect(await confirmSubscriber(claim)).toBe("subscribed");

    const row = await db.query.clients.findFirst({
      where: and(eq(clients.shopId, shop.id), eq(clients.email, "new@example.com")),
    });
    expect(row?.source).toBe("subscribe");
    expect(row?.name).toBe("Nadia");
    expect(row?.marketingConsentAt).not.toBeNull();

    // And they are immediately mailable, which is the whole point.
    expect(await emails(shop.id, segment([]))).toEqual(["new@example.com"]);
  });

  it("is idempotent — the link gets clicked twice, by a person and by a scanner", async () => {
    const shop = await makeShop();
    const claim = claimFor(shop.id, "twice@example.com");

    expect(await confirmSubscriber(claim)).toBe("subscribed");
    expect(await confirmSubscriber(claim)).toBe("subscribed");

    const rows = await db.query.clients.findMany({
      where: and(eq(clients.shopId, shop.id), eq(clients.email, "twice@example.com")),
    });
    expect(rows).toHaveLength(1);
  });

  it("matches an existing contact on the folded address rather than duplicating them", async () => {
    const shop = await makeShop();
    // Written by a checkout that kept the casing the buyer typed.
    const existing = await makeContact(shop.id, "Ada@Example.com", {
      marketingConsentAt: null,
      name: "Ada Lovelace",
    });

    expect(await confirmSubscriber(claimFor(shop.id, "ada@example.com", "Ada"))).toBe(
      "subscribed",
    );

    const rows = await db.query.clients.findMany({ where: eq(clients.shopId, shop.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(existing.id);
    expect(rows[0]?.marketingConsentAt).not.toBeNull();
    // A name they already had is not overwritten by one typed into a form.
    expect(rows[0]?.name).toBe("Ada Lovelace");
  });

  it("lets somebody who unsubscribed come back, and clears the suppression", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "returning@example.com");
    await suppress({
      shopId: shop.id,
      email: "returning@example.com",
      reason: "unsubscribed",
    });
    expect(await emails(shop.id, segment([]))).toEqual([]);

    expect(await confirmSubscriber(claimFor(shop.id, "returning@example.com"))).toBe(
      "subscribed",
    );

    expect(
      await db.query.emailSuppressions.findFirst({
        where: and(
          eq(emailSuppressions.shopId, shop.id),
          eq(emailSuppressions.email, "returning@example.com"),
        ),
      }),
    ).toBeUndefined();
    expect(await emails(shop.id, segment([]))).toEqual(["returning@example.com"]);
  });

  it("refuses to resurrect an address that bounced or complained", async () => {
    /*
     * A click cannot overturn either of these. A complaint is somebody
     * pressing "report spam" — not ours to undo on the sender's behalf — and
     * a bounce is an address that does not work.
     */
    for (const reason of ["bounced", "complained"] as const) {
      const shop = await makeShop();
      await suppress({ shopId: shop.id, email: "blocked@example.com", reason });

      expect(await confirmSubscriber(claimFor(shop.id, "blocked@example.com"))).toBe("refused");
      expect(await emails(shop.id, segment([]))).toEqual([]);
    }
  });
});
