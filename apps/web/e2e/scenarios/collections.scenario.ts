import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  collectionItems,
  collections,
  contentProgress,
  orders,
  productFiles,
  products,
  shops,
  subscriptions,
  user,
  clients,
} from "@sailo/db/schema";

/**
 * Spec 40 — gated content, against a real database.
 *
 * The arithmetic is pinned in `packages/core`. What is here is the half that
 * needs rows, and it is almost entirely about **the access predicate this spec
 * does not write**:
 *
 *   - an unpaid order sees preview items and nothing else;
 *   - a preview never yields a file id, because a preview is public and a
 *     preview that minted a download token would be a paid file given away;
 *   - a cancelled member still reads inside their grace and stops at
 *     `currentPeriodEnd`, decided by `membershipAccess` and by nothing this
 *     feature added;
 *   - a manual-rail `past_due` member does not read, and a card one does — the
 *     one deliberate asymmetry, because nothing is retrying a bank transfer;
 *   - progress writes are idempotent and cannot alter entitlement.
 */

const { readableCollection, recordProgress } = await import("@sailo/commerce/content");
const { membershipAccess } = await import("@sailo/commerce/memberships");

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "coll-";
const NOW = new Date("2026-08-19T12:00:00.000Z");
const ANCHOR = new Date("2026-08-01T00:00:00.000Z");

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
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
      name: "Ada's Studio",
      currency: "USD",
      isPublished: true,
      plan: "business",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

/** A digital product with three files and a three-item collection. */
async function aCourse(shopId: string, over: Partial<typeof collections.$inferInsert> = {}) {
  const [product] = await db
    .insert(products)
    .values({
      shopId,
      title: "Lightroom course",
      slug: `course-${uid().slice(0, 8)}`,
      kind: "digital",
      priceCents: 9900,
      isPublished: true,
    })
    .returning();

  const files = await db
    .insert(productFiles)
    .values([
      { productId: product!.id, name: "lesson-1.zip", url: "https://x.public.blob.vercel-storage.com/1" },
      { productId: product!.id, name: "lesson-2.zip", url: "https://x.public.blob.vercel-storage.com/2" },
    ])
    .returning();

  const [collection] = await db
    .insert(collections)
    .values({ shopId, productId: product!.id, title: "The course", ...over })
    .returning();

  const items = await db
    .insert(collectionItems)
    .values([
      {
        collectionId: collection!.id,
        section: "Week 1",
        title: "Welcome",
        position: 0,
        /*
         * The preview: text only. A preview carrying a file would be a paid
         * file handed to anybody with the link, which is the one mistake in
         * this feature that gives the goods away.
         */
        isPreview: true,
        bodyMd: "Start here.",
      },
      {
        collectionId: collection!.id,
        section: "Week 1",
        title: "Lesson one",
        position: 1,
        fileId: files[0]!.id,
      },
      {
        collectionId: collection!.id,
        section: "Week 2",
        title: "Lesson two",
        position: 2,
        fileId: files[1]!.id,
      },
    ])
    .returning();

  return { product: product!, collection: collection!, items, files };
}

async function anOrder(shopId: string, productId: string, over: Partial<typeof orders.$inferInsert> = {}) {
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      productId,
      productTitle: "Lightroom course",
      productKind: "digital",
      quantity: 1,
      unitPriceCents: 9900,
      subtotalCents: 9900,
      totalCents: 9900,
      currency: "USD",
      customerName: "Ada Lovelace",
      customerEmail: `${PREFIX}buyer-${uid().slice(0, 8)}@example.com`,
      downloadToken: uid().replace(/-/g, ""),
      paymentMethod: "card",
      paymentStatus: "paid",
      status: "confirmed",
      ...over,
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");
  return order;
}

const flat = (data: Awaited<ReturnType<typeof readableCollection>>) =>
  data.sections.flatMap((section) => section.items);

/* ------------------------------------------------------------------------- */

describe("what an unpaid order can reach", () => {
  it("sees the preview and nothing else", async () => {
    const shop = await sellerShop();
    const { product, collection } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, {
      paymentStatus: "unpaid",
      downloadReleasedAt: null,
    });

    const data = await readableCollection({
      collection,
      order,
      /* The gate's own answer, handed in — never recomputed here. */
      accessOpen: false,
      anchor: null,
      now: NOW,
    });

    const items = flat(data);
    expect(items.filter((item) => item.available).map((item) => item.title)).toEqual([
      "Welcome",
    ]);

    /*
     * And the locked items are still *listed*, with their titles. Hiding them
     * would mean a lapsed member cannot see what they have lost and a seller
     * cannot show what a course contains. What is withheld is the file id.
     */
    expect(items).toHaveLength(3);
    expect(items.filter((item) => !item.available).every((item) => item.fileId === null)).toBe(true);
  });

  it("never gives a preview a file to fetch", async () => {
    /*
     * A preview is public by construction. This asserts the *result*, not the
     * validator: even if a row somehow carried both, the read gives out no file
     * id for an item whose only claim is being a preview.
     */
    const shop = await sellerShop();
    const { product, collection } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: null });

    const data = await readableCollection({
      collection,
      order,
      accessOpen: false,
      anchor: null,
      now: NOW,
    });

    const preview = flat(data).find((item) => item.isPreview);
    expect(preview?.available).toBe(true);
    expect(preview?.fileId).toBeNull();
    expect(preview?.bodyMd).toBe("Start here.");
  });

  it("opens everything for a paid order", async () => {
    const shop = await sellerShop();
    const { product, collection } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: ANCHOR });

    const data = await readableCollection({
      collection,
      order,
      accessOpen: true,
      anchor: ANCHOR,
      now: NOW,
    });

    const items = flat(data);
    expect(items.every((item) => item.available)).toBe(true);
    expect(items.filter((item) => item.fileId !== null)).toHaveLength(2);
    expect(items.find((item) => item.title === "Lesson one")?.fileName).toBe("lesson-1.zip");
  });

  it("groups by section in the seller's own order", async () => {
    const shop = await sellerShop();
    const { product, collection } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: ANCHOR });

    const data = await readableCollection({
      collection,
      order,
      accessOpen: true,
      anchor: ANCHOR,
      now: NOW,
    });

    expect(data.sections.map((section) => section.section)).toEqual(["Week 1", "Week 2"]);
  });
});

/* ------------------------------------------------------------------------- */

describe("drip", () => {
  it("hides a future item and shows it after the interval", async () => {
    const shop = await sellerShop();
    const { product, collection } = await aCourse(shop.id, {
      dripMode: "interval",
      dripIntervalDays: 7,
    });
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: ANCHOR });

    const dayThree = await readableCollection({
      collection,
      order,
      accessOpen: true,
      anchor: ANCHOR,
      now: new Date("2026-08-04T00:00:00.000Z"),
    });
    const locked = flat(dayThree).filter((item) => !item.available);
    expect(locked).toHaveLength(2);
    expect(locked[0]?.unlocksInDays).toBe(4);
    // And the file is withheld, not merely greyed out.
    expect(locked.every((item) => item.fileId === null)).toBe(true);

    const dayEight = await readableCollection({
      collection,
      order,
      accessOpen: true,
      anchor: ANCHOR,
      now: new Date("2026-08-09T00:00:00.000Z"),
    });
    expect(flat(dayEight).every((item) => item.available)).toBe(true);
  });

  it("counts a percentage over what is reachable, so the bar never goes backwards", async () => {
    /*
     * Items that have not dripped are out of the denominator. Including them
     * would start a buyer at 33% on day one and drop them to 20% on day eight
     * for doing nothing wrong.
     */
    const shop = await sellerShop();
    const { product, collection, items } = await aCourse(shop.id, {
      dripMode: "interval",
      dripIntervalDays: 7,
    });
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: ANCHOR });

    await recordProgress({ orderId: order.id, itemId: items[0]!.id, completed: true });

    const dayThree = await readableCollection({
      collection,
      order,
      accessOpen: true,
      anchor: ANCHOR,
      now: new Date("2026-08-04T00:00:00.000Z"),
    });
    // One reachable item, and it is finished.
    expect(dayThree.progress).toMatchObject({ total: 1, completed: 1, percent: 100 });
  });
});

/* ------------------------------------------------------------------------- */

describe("a membership's collection", () => {
  async function member(shopId: string, over: Partial<typeof subscriptions.$inferInsert>) {
    const [client] = await db
      .insert(clients)
      .values({ shopId, name: "Ada", email: `${PREFIX}m-${uid().slice(0, 8)}@example.com` })
      .returning();

    const [subscription] = await db
      .insert(subscriptions)
      .values({
        shopId,
        clientId: client!.id,
        status: "active",
        billingMode: "stripe",
        startedAt: ANCHOR,
        ...over,
      })
      .returning();
    return subscription!;
  }

  it("still reads inside the grace after cancelling, and stops at the period end", async () => {
    /*
     * `membershipAccess` holds this line and nothing here shortens it: somebody
     * who paid for August keeps August even if they cancel on the 2nd. The
     * collection asks the same function the download gate asks.
     */
    const shop = await sellerShop();
    const { product, collection } = await aCourse(shop.id);
    /*
     * `active` with `cancelAtPeriodEnd`, not `canceled`. That is what
     * "cancelled" means in this product: Sailo cancels through Stripe's own
     * billing portal, which sets `cancel_at_period_end` and leaves the status
     * active until the period actually ends — so the member keeps the month
     * they paid for. `status: "canceled"` is the state *after* that, and using
     * it here would have tested the wrong half of the rule.
     */
    const subscription = await member(shop.id, {
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date("2026-08-31T00:00:00.000Z"),
      productId: product.id,
    });
    const order = await anOrder(shop.id, product.id, {
      subscriptionId: subscription.id,
      productKind: "membership",
      downloadReleasedAt: ANCHOR,
    });

    const inGrace = membershipAccess(subscription, NOW);
    expect(inGrace.open).toBe(true);
    // And they are told it is running out, which is what `endingSoon` is for.
    expect(inGrace.endingSoon).toBe(true);

    const reading = await readableCollection({
      collection,
      order,
      accessOpen: inGrace.open,
      anchor: subscription.startedAt,
      now: NOW,
    });
    expect(flat(reading).every((item) => item.available)).toBe(true);

    /*
     * And the moment the paid period ends, the door closes — decided by
     * `currentPeriodEnd` rather than by anything this feature added.
     */
    const after = membershipAccess(subscription, new Date("2026-09-01T00:00:00.000Z"));
    expect(after.open).toBe(false);

    const locked = await readableCollection({
      collection,
      order,
      accessOpen: after.open,
      anchor: subscription.startedAt,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    // Preview only, and no file ids anywhere.
    expect(flat(locked).filter((item) => item.available).map((item) => item.title)).toEqual([
      "Welcome",
    ]);
    expect(flat(locked).every((item) => item.fileId === null)).toBe(true);
  });

  it("keeps a past_due card member reading, and gives a manual one no grace past their period", async () => {
    /*
     * The one deliberate asymmetry, and it is worth being exact about *where*
     * it lives, because a first draft of this test asserted it in the wrong
     * place and passed for the wrong reason.
     *
     * `membershipAccess` does **not** branch on `billingMode` — `past_due` is
     * simply in `OPEN_STATUSES`. The asymmetry is realised through
     * `currentPeriodEnd`, and that is the whole of it:
     *
     *   a **card** member goes `past_due` *inside* the period Stripe is still
     *   retrying for, so they keep reading — nobody should be locked out over
     *   their bank's fraud check;
     *
     *   a **manual** member's period end never advances until the seller marks
     *   the renewal paid, so by the time they are past due they are past their
     *   period, and there is no extra grace constant to extend it. The module
     *   says so in as many words: *"nothing is trying on a bank transfer … the
     *   correct amount of extra grace is none."*
     *
     * So both are asserted against the mechanism that actually decides them.
     */
    const shop = await sellerShop();

    const card = await member(shop.id, {
      status: "past_due",
      billingMode: "stripe",
      // Stripe is retrying, inside a period that has not run out.
      currentPeriodEnd: new Date("2026-08-31T00:00:00.000Z"),
    });
    expect(membershipAccess(card, NOW).open).toBe(true);

    const manual = await member(shop.id, {
      status: "past_due",
      billingMode: "manual",
      // The renewal was raised, never paid, and the paid period has ended.
      currentPeriodEnd: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(membershipAccess(manual, NOW).open).toBe(false);

    /*
     * And the collection follows, because it asks the same function. A lapsed
     * manual member sees the preview and no file ids.
     */
    const { product, collection } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, {
      subscriptionId: manual.id,
      productKind: "membership",
      downloadReleasedAt: ANCHOR,
    });

    const data = await readableCollection({
      collection,
      order,
      accessOpen: membershipAccess(manual, NOW).open,
      anchor: manual.startedAt,
      now: NOW,
    });
    expect(flat(data).filter((entry) => entry.available).map((entry) => entry.title)).toEqual([
      "Welcome",
    ]);
    expect(flat(data).every((entry) => entry.fileId === null)).toBe(true);
  });

  it("drips from the day the member joined, not from a renewal order", async () => {
    const shop = await sellerShop();
    const { product, collection } = await aCourse(shop.id, {
      dripMode: "interval",
      dripIntervalDays: 7,
    });
    const subscription = await member(shop.id, {
      status: "active",
      startedAt: new Date("2026-06-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      productId: product.id,
    });
    /*
     * A renewal order raised last week. Anchoring on it would restart the whole
     * course every month for a member who has been reading it since June.
     */
    const renewal = await anOrder(shop.id, product.id, {
      subscriptionId: subscription.id,
      productKind: "membership",
      downloadReleasedAt: new Date("2026-08-12T00:00:00.000Z"),
    });

    const data = await readableCollection({
      collection,
      order: renewal,
      accessOpen: true,
      anchor: subscription.startedAt,
      now: NOW,
    });
    expect(flat(data).every((item) => item.available)).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */

describe("progress", () => {
  it("is idempotent and keeps the first completion date", async () => {
    const shop = await sellerShop();
    const { product, items } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: ANCHOR });

    await recordProgress({
      orderId: order.id,
      itemId: items[1]!.id,
      completed: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    await recordProgress({
      orderId: order.id,
      itemId: items[1]!.id,
      completed: true,
      now: new Date("2026-08-15T00:00:00.000Z"),
    });

    const rows = await db
      .select()
      .from(contentProgress)
      .where(eq(contentProgress.orderId, order.id));

    expect(rows).toHaveLength(1);
    // The *first* completion is the fact. A second tap must not move the date.
    expect(rows[0]?.completedAt?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    // But the visit did happen, and that is what `lastSeenAt` is for.
    expect(rows[0]?.lastSeenAt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("can be undone", async () => {
    const shop = await sellerShop();
    const { product, items } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: ANCHOR });

    await recordProgress({ orderId: order.id, itemId: items[1]!.id, completed: true });
    await recordProgress({ orderId: order.id, itemId: items[1]!.id, completed: false });

    const [row] = await db
      .select()
      .from(contentProgress)
      .where(
        and(
          eq(contentProgress.orderId, order.id),
          eq(contentProgress.itemId, items[1]!.id),
        ),
      );
    expect(row?.completedAt).toBeNull();
  });

  it("cannot alter entitlement", async () => {
    /*
     * The property, asserted against the rows rather than by reading the code:
     * marking every lesson done changes nothing about the order, its release
     * timestamp or its download allowance.
     */
    const shop = await sellerShop();
    const { product, items } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, {
      downloadReleasedAt: null,
      downloadLimit: 3,
      downloadCount: 0,
    });

    for (const item of items) {
      await recordProgress({ orderId: order.id, itemId: item.id, completed: true });
    }

    const after = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    expect(after?.downloadReleasedAt).toBeNull();
    expect(after?.downloadCount).toBe(0);
    expect(after?.downloadLimit).toBe(3);
    expect(after?.paymentStatus).toBe("paid");
  });

  it("burns an allowance per file fetched, never per page view", async () => {
    /*
     * A lesson list makes `downloadLimit` visible in a new way: a buyer
     * clicking through twelve lessons must not spend twelve allowances for
     * *reading* them. The claim lives in the streaming route and nowhere else —
     * `/api/download/[token]/[fileId]` increments `downloadCount` in the same
     * statement that checks it — so rendering the list, however many times,
     * touches nothing.
     *
     * Asserted against the row rather than by reading the code, because the way
     * this regresses is somebody adding a "mark seen" write to the page load.
     */
    const shop = await sellerShop();
    const { product, collection } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, {
      downloadReleasedAt: ANCHOR,
      downloadLimit: 3,
      downloadCount: 0,
    });

    for (let view = 0; view < 12; view += 1) {
      await readableCollection({
        collection,
        order,
        accessOpen: true,
        anchor: ANCHOR,
        now: NOW,
      });
    }

    const after = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    expect(after?.downloadCount).toBe(0);
  });

  it("refuses an item that does not exist", async () => {
    const shop = await sellerShop();
    const { product } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: ANCHOR });

    const result = await recordProgress({
      orderId: order.id,
      itemId: uid(),
      completed: true,
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("names the next unfinished item in the seller's order", async () => {
    const shop = await sellerShop();
    const { product, collection, items } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: ANCHOR });

    await recordProgress({ orderId: order.id, itemId: items[0]!.id, completed: true });

    const data = await readableCollection({
      collection,
      order,
      accessOpen: true,
      anchor: ANCHOR,
      now: NOW,
    });
    expect(data.continueItemId).toBe(items[1]!.id);
    expect(data.progress).toMatchObject({ total: 3, completed: 1, percent: 33 });
  });
});

/* ------------------------------------------------------------------------- */

describe("deleting a file", () => {
  it("shortens the collection rather than breaking it", async () => {
    const shop = await sellerShop();
    const { product, collection, files } = await aCourse(shop.id);
    const order = await anOrder(shop.id, product.id, { downloadReleasedAt: ANCHOR });

    await db.delete(productFiles).where(eq(productFiles.id, files[0]!.id));

    const data = await readableCollection({
      collection,
      order,
      accessOpen: true,
      anchor: ANCHOR,
      now: NOW,
    });

    // The item cascaded away with its file; the rest still reads.
    expect(flat(data)).toHaveLength(2);
    expect(flat(data).map((item) => item.title)).toEqual(["Welcome", "Lesson two"]);
  });
});
