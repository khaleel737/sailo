import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  eventSessions,
  eventTiers,
  orderItems,
  orders,
  paymentMethods,
  products,
  shops,
  tickets,
  user,
} from "@sailo/db/schema";
import {
  claimEventCapacity,
  eventAccessForOrder,
  eventHasFutureDate,
  generateSessions,
  releaseEventCapacity,
} from "@sailo/commerce/ticketing";
import { createOrderIntent } from "@/lib/actions/orders";
import { previewOrder } from "@/lib/actions/order-preview";
import { GET } from "@/app/download/[token]/calendar/route";
import { restoreStock, retakeStock } from "@sailo/commerce/catalog";

/**
 * Two-level event capacity, against a real database — spec 50.
 *
 * A room of 200 with 30 VIP seats is a product stock of 200 **and** a tier
 * capacity of 30, and both have to hold. The failure this suite exists to stop
 * is thirty-one people arriving with a VIP ticket for thirty seats, which an
 * event seller cannot forgive and which is invisible until the night.
 *
 * **These fail if the guard is removed.** Take the ceiling out of the tier
 * claim's WHERE and the thirty-first VIP buyer succeeds. Claim the product
 * *before* the tier and the ordering test goes red: the wide check reserves a
 * seat the narrow one then refuses, and in the window between them somebody
 * else takes it.
 *
 * The arithmetic is only interesting under contention, which is why every
 * count here is taken with `Promise.all` rather than a loop.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

async function makeShop() {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Promoter",
    email: `promoter-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `venue-${userId.slice(0, 8)}`,
      name: "The Room",
      currency: "USD",
      isPublished: true,
      plan: "business",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

/** An event with a room of `stock` seats. */
async function makeEvent(shopId: string, stock: number | null, over = {}) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Rooftop Show",
      slug: `ev-${uid().slice(0, 8)}`,
      kind: "event",
      priceCents: 2500,
      eventStartsAt: inAWeek(),
      trackInventory: stock !== null,
      stockQuantity: stock,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: event was not inserted");
  return p;
}

/** A shop that can actually take an order, on the rail with no gateway. */
async function makeSellingShop() {
  const shop = await makeShop();
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

const buyer = {
  paymentMethod: "cod",
  customerName: "Buyer",
  customerEmail: "buyer@example.com",
  addressLine1: "1 High Street",
  city: "Leeds",
  postalCode: "LS1 1AA",
  country: "UK",
};

async function makeTier(
  productId: string,
  name: string,
  capacity: number | null,
  over: Partial<typeof eventTiers.$inferInsert> = {},
) {
  const [t] = await db
    .insert(eventTiers)
    .values({ productId, name, priceCents: 5000, capacity, ...over })
    .returning();
  if (!t) throw new Error("fixture: tier was not inserted");
  return t;
}

async function makeSession(
  productId: string,
  capacity: number | null,
  over: Partial<typeof eventSessions.$inferInsert> = {},
) {
  const [s] = await db
    .insert(eventSessions)
    .values({ productId, startsAt: inAWeek(), capacity, ...over })
    .returning();
  if (!s) throw new Error("fixture: session was not inserted");
  return s;
}

const stockOf = async (productId: string) =>
  (await db.query.products.findFirst({ where: eq(products.id, productId) }))
    ?.stockQuantity ?? null;
const tierSold = async (id: string) =>
  (await db.query.eventTiers.findFirst({ where: eq(eventTiers.id, id) }))?.sold ?? 0;
const sessionSold = async (id: string) =>
  (await db.query.eventSessions.findFirst({ where: eq(eventSessions.id, id) }))
    ?.sold ?? 0;

beforeAll(async () => {
  assertLocalDatabase();
});

describe("a room of 200 with a 30-seat VIP tier", () => {
  const ROOM = 200;
  const VIP = 30;

  /*
   * The scenario the spec names, word for word: "31 VIP buyers get 30 tickets
   * and the 31st is refused while General still sells".
   */
  it("sells thirty VIP tickets and refuses the thirty-first, while General keeps selling", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, ROOM);
    const vip = await makeTier(event.id, "VIP", VIP);
    // NULL capacity means "share the room", which is what a General tier is.
    const general = await makeTier(event.id, "General", null);

    const results = await Promise.all(
      Array.from({ length: 31 }, () =>
        claimEventCapacity({
          productId: event.id,
          tierId: vip.id,
          sessionId: null,
          quantity: 1,
          trackInventory: true,
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(VIP);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(1);
    // Told which level refused, so the buyer reads "VIP is sold out" rather
    // than "this event is sold out" — a seller loses a sale to the wrong one.
    expect(refused[0]).toEqual({ ok: false, level: "tier" });

    expect(await tierSold(vip.id)).toBe(VIP);
    // The room took thirty of its two hundred, and General is still open.
    expect(await stockOf(event.id)).toBe(ROOM - VIP);

    const stillSelling = await claimEventCapacity({
      productId: event.id,
      tierId: general.id,
      sessionId: null,
      quantity: 1,
      trackInventory: true,
    });
    expect(stillSelling.ok).toBe(true);
  });

  /*
   * The ordering rule, from the other side. The room is the *narrower* number
   * here, so the product check is what refuses — and the tier's counter must
   * come back, or the seller's VIP tier reads as sold out for a seat nobody
   * ever held.
   */
  it("gives the tier's seat back when the room is what runs out", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, 1);
    const vip = await makeTier(event.id, "VIP", 50);

    expect(
      (
        await claimEventCapacity({
          productId: event.id,
          tierId: vip.id,
          sessionId: null,
          quantity: 1,
          trackInventory: true,
        })
      ).ok,
    ).toBe(true);

    const second = await claimEventCapacity({
      productId: event.id,
      tierId: vip.id,
      sessionId: null,
      quantity: 1,
      trackInventory: true,
    });
    expect(second).toEqual({ ok: false, level: "product" });

    // One sold, not two. The compensation ran.
    expect(await tierSold(vip.id)).toBe(1);
    expect(await stockOf(event.id)).toBe(0);
  });

  it("refuses a party larger than the tier has left, rather than seating some of them", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, ROOM);
    const vip = await makeTier(event.id, "VIP", 4);

    expect(
      (
        await claimEventCapacity({
          productId: event.id,
          tierId: vip.id,
          sessionId: null,
          quantity: 3,
          trackInventory: true,
        })
      ).ok,
    ).toBe(true);

    // Two more would be five of four. All or nothing.
    const tooMany = await claimEventCapacity({
      productId: event.id,
      tierId: vip.id,
      sessionId: null,
      quantity: 2,
      trackInventory: true,
    });
    expect(tooMany).toEqual({ ok: false, level: "tier" });
    expect(await tierSold(vip.id)).toBe(3);
  });

  it("puts every level back when a ticket is released", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, ROOM);
    const vip = await makeTier(event.id, "VIP", VIP);

    const claim = {
      productId: event.id,
      tierId: vip.id,
      sessionId: null,
      quantity: 2,
      trackInventory: true,
    };
    await claimEventCapacity(claim);
    expect(await tierSold(vip.id)).toBe(2);

    await releaseEventCapacity(claim);
    expect(await tierSold(vip.id)).toBe(0);
    expect(await stockOf(event.id)).toBe(ROOM);
  });

  it("never lets a counter go below zero, however many times a seat is released", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, ROOM);
    const vip = await makeTier(event.id, "VIP", VIP);
    const claim = {
      productId: event.id,
      tierId: vip.id,
      sessionId: null,
      quantity: 1,
      trackInventory: true,
    };

    await claimEventCapacity(claim);
    await releaseEventCapacity(claim);
    await releaseEventCapacity(claim);

    // `greatest(sold - n, 0)`: a negative counter would read as room that does
    // not exist the next time somebody buys.
    expect(await tierSold(vip.id)).toBe(0);
  });
});

describe("sessions", () => {
  it("claims the session's seats under pick_one, not the product's", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, 100, { sessionMode: "pick_one" });
    const tuesday = await makeSession(event.id, 8);

    const results = await Promise.all(
      Array.from({ length: 9 }, () =>
        claimEventCapacity({
          productId: event.id,
          tierId: null,
          sessionId: tuesday.id,
          quantity: 1,
          trackInventory: true,
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(8);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, level: "session" });
    expect(await sessionSold(tuesday.id)).toBe(8);
  });

  it("keeps two sessions of one event apart", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, 100, { sessionMode: "pick_one" });
    const tuesday = await makeSession(event.id, 1);
    const thursday = await makeSession(event.id, 1);

    const both = await Promise.all([
      claimEventCapacity({
        productId: event.id,
        tierId: null,
        sessionId: tuesday.id,
        quantity: 1,
        trackInventory: true,
      }),
      claimEventCapacity({
        productId: event.id,
        tierId: null,
        sessionId: thursday.id,
        quantity: 1,
        trackInventory: true,
      }),
    ]);
    expect(both.every((r) => r.ok)).toBe(true);
  });

  it("sells nothing for a session the seller cancelled", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, 100, { sessionMode: "pick_one" });
    const off = await makeSession(event.id, 50);
    await db
      .update(eventSessions)
      .set({ isCancelled: true })
      .where(eq(eventSessions.id, off.id));

    const refused = await claimEventCapacity({
      productId: event.id,
      tierId: null,
      sessionId: off.id,
      quantity: 1,
      trackInventory: true,
    });
    expect(refused).toEqual({ ok: false, level: "session" });
  });

  /*
   * An `all_access` pass admits every session and therefore claims none of
   * them: naming one would take a seat the pass does not occupy, and eight
   * days of a conference would each lose a seat to the same person.
   */
  it("takes the product's stock for an all-access pass and no session's", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, 10, { sessionMode: "all_access" });
    const day = await makeSession(event.id, 1);

    const claim = {
      productId: event.id,
      tierId: null,
      sessionId: day.id,
      quantity: 3,
      trackInventory: true,
      allAccess: true,
    };
    expect((await claimEventCapacity(claim)).ok).toBe(true);

    expect(await sessionSold(day.id)).toBe(0);
    expect(await stockOf(event.id)).toBe(7);
  });

  it("writes eight rows for a weekly class rather than a recurrence rule", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, null, { sessionMode: "pick_one" });
    const first = new Date("2027-04-06T18:00:00Z");

    const written = await generateSessions({
      productId: event.id,
      startsAt: first,
      endsAt: new Date("2027-04-06T19:30:00Z"),
      everyDays: 7,
      count: 8,
      capacity: 12,
    });
    expect(written).toBe(8);

    const rows = await db.query.eventSessions.findMany({
      where: eq(eventSessions.productId, event.id),
    });
    expect(rows).toHaveLength(8);
    // Each keeps the first one's length, so a seller who set 90 minutes gets
    // 90 minutes eight times rather than eight open-ended dates.
    for (const row of rows) {
      expect(row.endsAt).not.toBeNull();
      expect(
        (row.endsAt as Date).getTime() - row.startsAt.getTime(),
      ).toBe(90 * 60_000);
    }
    // And they are editable individually, which is the whole feature: nothing
    // stored says they belong to a series.
    expect(new Set(rows.map((r) => r.startsAt.getTime())).size).toBe(8);
  });
});

describe("when an event has run out of dates", () => {
  it("says so for a session product whose last date has passed", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, 100, { sessionMode: "pick_one" });
    await db.insert(eventSessions).values({
      productId: event.id,
      startsAt: new Date("2020-01-01T10:00:00Z"),
    });

    expect(await eventHasFutureDate(event)).toBe(false);

    await db.insert(eventSessions).values({
      productId: event.id,
      startsAt: inAWeek(),
    });
    expect(await eventHasFutureDate(event)).toBe(true);
  });

  it("falls back to eventStartsAt for an event with no sessions", async () => {
    const shop = await makeShop();
    const future = await makeEvent(shop.id, 100);
    expect(await eventHasFutureDate(future)).toBe(true);

    const past = await makeEvent(shop.id, 100, {
      eventStartsAt: new Date("2020-01-01T10:00:00Z"),
    });
    expect(await eventHasFutureDate(past)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*  The checkout, which is where the money is                                  */
/* -------------------------------------------------------------------------- */

/**
 * The half of spec 50 that was missing, exercised through the real order path.
 *
 * Everything above this line proves `claimEventCapacity` is correct. None of it
 * proved anything about the product, because until now nothing called it: a
 * seller could type "VIP, £50, 30 seats", a buyer would be charged the
 * product's £25, no seat would be taken against the band, and every test in
 * this file would still have been green. That is the shape of defect these
 * suites exist to catch, and it is why these go through `createOrderIntent`
 * rather than through the claim.
 *
 * **`Promise.all`, not a loop.** The arithmetic is only interesting under
 * contention: a read-then-write claim passes any sequential test ever written
 * and oversells the moment two people press the button in the same second.
 *
 * The tests that place a crowd of orders get their own ceiling rather than the
 * file's 30 seconds. Thirty-one concurrent `createOrderIntent` calls are around
 * nine hundred round trips through the local Neon proxy, and the point of these
 * is what the counters read at the end — a timeout here says the container is
 * slow, which is not a fact about the claim and must not read as one.
 */
const CROWD_TIMEOUT = 180_000;

describe("buying a ticket in a band", () => {
  it("charges the band's price and not the product's", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100);
    const vip = await makeTier(event.id, "VIP", 30, { priceCents: 5000 });

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: event.id, quantity: 2, tierId: vip.id }],
      ...buyer,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    // £50 twice, not the £25 on the product row. This is the revenue bug.
    expect(placed.totals.subtotalCents).toBe(10_000);

    const [item] = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, placed.orderId),
    });
    expect(item?.unitPriceCents).toBe(5000);
    // The columns that have existed since the wave landed and were never
    // written. `restoreStock` reads them to know which band to credit.
    expect(item?.tierId).toBe(vip.id);
    expect(item?.variantLabel).toBe("VIP");

    // Both levels moved, and only by what was bought.
    expect(await tierSold(vip.id)).toBe(2);
    expect(await stockOf(event.id)).toBe(98);
  });

  /*
   * The spec's own scenario, at the checkout rather than at the claim: "31 VIP
   * buyers get 30 tickets and the 31st is refused while General still sells".
   *
   * The refusal is asserted **by name**. A buyer told "this event is sold out"
   * leaves; a buyer told "VIP is sold out" buys a General ticket, and the room
   * still has a hundred and seventy seats in it. The two sentences are worth a
   * sale each, and nothing but this checks which one a losing buyer receives.
   */
  it("sells exactly the band's seats to a crowd of buyers and names what ran out", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 200);
    const vip = await makeTier(event.id, "VIP", 30);
    const general = await makeTier(event.id, "General", null, {
      priceCents: 2000,
    });

    const results = await Promise.all(
      Array.from({ length: 31 }, () =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: event.id, quantity: 1, tierId: vip.id }],
          ...buyer,
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(30);

    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toEqual({ ok: false, error: "VIP is sold out." });

    expect(await tierSold(vip.id)).toBe(30);
    // Thirty of two hundred: the room is still open and General is still on.
    expect(await stockOf(event.id)).toBe(170);

    const stillSelling = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: event.id, quantity: 1, tierId: general.id }],
      ...buyer,
    });
    expect(stillSelling.ok).toBe(true);

    // Thirty-one admissions exist, and every one of them prints its band —
    // which `door-list.ts` has been selecting distinct over and finding empty.
    const minted = await db.query.tickets.findMany({
      where: eq(tickets.productId, event.id),
    });
    expect(minted).toHaveLength(31);
    expect(minted.filter((t) => t.tier === "VIP")).toHaveLength(30);
    expect(minted.filter((t) => t.tier === "General")).toHaveLength(1);
    expect(minted.every((t) => t.tierId !== null)).toBe(true);
  }, CROWD_TIMEOUT);

  /*
   * The other side of the same race: the room runs out before the band does.
   * The tier's counter has to come back, or the seller's VIP band reads as
   * having sold seats nobody ever held.
   */
  it("hands the band's seat back when it is the room that runs out", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 3);
    const vip = await makeTier(event.id, "VIP", 50);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: event.id, quantity: 1, tierId: vip.id }],
          ...buyer,
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(3);
    // The wide level refused, so the buyer is told about the event and not
    // about a band that has forty-seven seats left in it.
    for (const refusal of results.filter((r) => !r.ok)) {
      expect(refusal).toEqual({ ok: false, error: "Rooftop Show just sold out." });
    }

    // Three sold, not five. The compensation ran on the real path.
    expect(await tierSold(vip.id)).toBe(3);
    expect(await stockOf(event.id)).toBe(0);
  }, CROWD_TIMEOUT);

  it("keeps two bands of one event apart under contention", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100);
    const vip = await makeTier(event.id, "VIP", 2);
    const early = await makeTier(event.id, "Early bird", 2, { priceCents: 1500 });

    const results = await Promise.all([
      ...Array.from({ length: 3 }, () =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: event.id, quantity: 1, tierId: vip.id }],
          ...buyer,
        }),
      ),
      ...Array.from({ length: 3 }, () =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: event.id, quantity: 1, tierId: early.id }],
          ...buyer,
        }),
      ),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(await tierSold(vip.id)).toBe(2);
    expect(await tierSold(early.id)).toBe(2);
    expect(await stockOf(event.id)).toBe(96);

    const refusals = results.map((r) => (r.ok ? null : r.error));
    expect(refusals).toContain("VIP is sold out.");
    expect(refusals).toContain("Early bird is sold out.");
  }, CROWD_TIMEOUT);

  /*
   * The basket's half of `lineKey`, from the server's side.
   *
   * Two bands of one event are two lines, and the drawer pairs each stored
   * line to a priced one by product, variant, band and date. Before the last
   * two were in that key both lines had equal identities: `find` returned the
   * first for both, so the buyer read one price twice against an order that
   * charged two.
   */
  it("prices two bands of one event as two lines the drawer can tell apart", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100);
    const vip = await makeTier(event.id, "VIP", 30, { priceCents: 5000 });
    const general = await makeTier(event.id, "General", null, { priceCents: 2000 });

    const preview = await previewOrder({
      shopId: shop.id,
      items: [
        { productId: event.id, quantity: 1, tierId: vip.id },
        { productId: event.id, quantity: 1, tierId: general.id },
      ],
    });
    if ("error" in preview) throw new Error(preview.error);

    expect(preview.lines).toHaveLength(2);
    expect(preview.lines.map((l) => l.unitPriceCents)).toEqual([5000, 2000]);
    expect(preview.lines.map((l) => l.tierId)).toEqual([vip.id, general.id]);
    // And the label the drawer prints, which is the band on a product that has
    // no variant to name.
    expect(preview.lines.map((l) => l.label)).toEqual(["VIP", "General"]);
    expect(preview.totals.subtotalCents).toBe(7000);
  });

  it("refuses a band that is not this event's rather than pricing from the product", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100);
    await makeTier(event.id, "VIP", 30);
    const elsewhere = await makeEvent(shop.id, 100);
    const theirs = await makeTier(elsewhere.id, "Their VIP", 30);

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: event.id, quantity: 1, tierId: theirs.id }],
      ...buyer,
    });
    expect(placed).toEqual({
      ok: false,
      error: "Choose a ticket type for Rooftop Show.",
    });
    // And nothing was taken from either event on the way to saying so.
    expect(await stockOf(event.id)).toBe(100);
    expect(await tierSold(theirs.id)).toBe(0);
  });

  it("refuses an event with bands when the basket names none", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100);
    await makeTier(event.id, "VIP", 30);

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: event.id, quantity: 1 }],
      ...buyer,
    });
    expect(placed.ok).toBe(false);
    // Not sold at the product's own price, which is the whole defect.
    expect(await stockOf(event.id)).toBe(100);
  });

  /*
   * A hidden band is unlisted, not unsellable. "Reachable by direct link only"
   * means the link is the credential, and refusing it here would make the link
   * go nowhere — which is a comp list a seller cannot use.
   */
  it("still sells a hidden band to somebody holding its link", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100);
    const press = await makeTier(event.id, "Press", 5, {
      priceCents: 0,
      isHidden: true,
    });

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: event.id, quantity: 1, tierId: press.id }],
      ...buyer,
    });
    expect(placed.ok).toBe(true);
    expect(await tierSold(press.id)).toBe(1);
  });
});

describe("buying a date", () => {
  it("claims the date's seats under pick_one and writes which one", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100, { sessionMode: "pick_one" });
    const tuesday = await makeSession(event.id, 4);
    const thursday = await makeSession(event.id, 4);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: event.id, quantity: 1, sessionId: tuesday.id }],
          ...buyer,
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(4);
    for (const refusal of results.filter((r) => !r.ok)) {
      expect(refusal).toEqual({
        ok: false,
        error: "That date for Rooftop Show is sold out.",
      });
    }

    expect(await sessionSold(tuesday.id)).toBe(4);
    // Thursday is untouched, which is the whole reason dates have their own
    // counter rather than sharing the room's.
    expect(await sessionSold(thursday.id)).toBe(0);
    expect(await stockOf(event.id)).toBe(96);

    const placed = results.find((r) => r.ok);
    if (!placed?.ok) throw new Error("expected at least one order");
    const [item] = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, placed.orderId),
    });
    expect(item?.sessionId).toBe(tuesday.id);
  }, CROWD_TIMEOUT);

  it("refuses a pick_one event whose basket names no date", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100, { sessionMode: "pick_one" });
    await makeSession(event.id, 4);

    expect(
      await createOrderIntent({
        shopId: shop.id,
        items: [{ productId: event.id, quantity: 1 }],
        ...buyer,
      }),
    ).toEqual({ ok: false, error: "Choose a date for Rooftop Show." });
  });

  /*
   * `eventSalesOpen` reads `products.eventStartsAt`, which on a multi-session
   * event describes the first date and nothing else. Without the session
   * exemption in `createOrderIntent`, a weekly class whose first Tuesday has
   * passed refuses every ticket for every remaining week — the whole feature
   * broken by a column that predates it.
   */
  it("keeps selling later dates after the first one has been and gone", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100, {
      sessionMode: "pick_one",
      eventStartsAt: new Date("2020-01-01T10:00:00Z"),
    });
    const later = await makeSession(event.id, 10);

    expect(
      (
        await createOrderIntent({
          shopId: shop.id,
          items: [{ productId: event.id, quantity: 1, sessionId: later.id }],
          ...buyer,
        })
      ).ok,
    ).toBe(true);
  });

  /*
   * The date the buyer is *told* about, which until now was the first date of
   * the series whatever they picked. Somebody who bought the fourth Tuesday
   * would have turned up three weeks early to a locked door — not a display
   * bug anybody reports.
   */
  it("tells the buyer the date they bought, not the first one in the series", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100, {
      sessionMode: "pick_one",
      eventStartsAt: inAWeek(),
      serviceMode: "in_person",
      serviceLocation: "The usual room",
    });
    await makeSession(event.id, 10);
    const fourth = await makeSession(event.id, 10, {
      startsAt: new Date(Date.now() + 28 * 24 * 3600 * 1000),
      location: "The big room",
    });

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: event.id, quantity: 1, sessionId: fourth.id }],
      ...buyer,
    });
    if (!placed.ok) throw new Error(placed.error);

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, placed.orderId),
    });
    if (!order) throw new Error("order vanished");

    const access = await eventAccessForOrder(order);
    expect(access).toHaveLength(1);
    expect(access[0]?.startsAt?.getTime()).toBe(fourth.startsAt.getTime());
    // And the date's own room, when it has one.
    expect(access[0]?.location).toBe("The big room");
  });

  /*
   * The calendar file, served — spec 50.
   *
   * `ics.ts` shipped with the wave and had no callers at all: a stable UID, a
   * SEQUENCE, a VTIMEZONE, and nothing anywhere produced a file. This exercises
   * the route the delivery page links, through a real order.
   */
  it("hands a buyer a calendar entry for the date they bought", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100, {
      sessionMode: "pick_one",
      serviceMode: "in_person",
      serviceLocation: "The usual room",
    });
    await makeSession(event.id, 10);
    const second = await makeSession(event.id, 10, {
      startsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      location: "The big room",
    });

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: event.id, quantity: 1, sessionId: second.id }],
      ...buyer,
    });
    if (!placed.ok) throw new Error(placed.error);

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, placed.orderId),
    });
    if (!order?.downloadToken) throw new Error("no delivery token");

    const response = await GET(
      new Request(
        `http://localhost/download/${order.downloadToken}/calendar` +
          `?product=${event.id}&session=${second.id}`,
      ),
      { params: Promise.resolve({ token: order.downloadToken }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");

    const body = await response.text();
    // RFC 5545 wants CRLF, and several clients enforce it by refusing the file.
    expect(body).toContain("\r\n");
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");
    expect(body).toContain("SUMMARY:Rooftop Show");
    // The date they bought, not the first of the series — and its own room.
    expect(body).toContain(
      `DTSTART:${second.startsAt.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    );
    expect(body).toContain("LOCATION:The big room");

    /*
     * Unfolded before the UID is read, which is how an `.ics` is *meant* to be
     * parsed and is not a convenience here.
     *
     * `UID:<order>-<session>@sailo.store` is 89 octets and the spec's limit is
     * 75, so `buildIcs` folds it across two lines with a leading space — and a
     * naive `toContain` on the whole id fails against a file that is perfectly
     * correct. Asserting on the folded form instead would pin the wrap column,
     * so the next id one character longer would break the test rather than the
     * code.
     */
    const unfolded = body.replace(/\r\n /g, "");
    /*
     * Stable per (order, date). A resend has to update the entry the attendee
     * already holds rather than adding a second one to their diary, and every
     * calendar client keys on this.
     */
    expect(unfolded).toContain(`UID:${placed.orderId}-${second.id}@sailo.store`);
  });

  it("refuses a calendar entry for an order that is not this token's", async () => {
    const shop = await makeSellingShop();
    const mine = await makeEvent(shop.id, 100);
    const theirs = await makeEvent(shop.id, 100);

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: mine.id, quantity: 1 }],
      ...buyer,
    });
    if (!placed.ok) throw new Error(placed.error);
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, placed.orderId),
    });
    if (!order?.downloadToken) throw new Error("no delivery token");

    // A product this order never bought is not this order's to put in a diary.
    const response = await GET(
      new Request(
        `http://localhost/download/${order.downloadToken}/calendar?product=${theirs.id}`,
      ),
      { params: Promise.resolve({ token: order.downloadToken }) },
    );
    expect(response.status).toBe(404);

    // And a token nobody issued gets nothing at all.
    const forged = await GET(
      new Request("http://localhost/download/not-a-token/calendar"),
      { params: Promise.resolve({ token: "not-a-token" }) },
    );
    expect(forged.status).toBe(404);
  });

  it("takes the room and no date's seats for an all-access pass", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 10, { sessionMode: "all_access" });
    const day = await makeSession(event.id, 1);

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: event.id, quantity: 3, sessionId: day.id }],
      ...buyer,
    });
    expect(placed.ok).toBe(true);

    // Naming a day on a pass would take a seat the pass does not occupy, and
    // eight days of a conference would each lose a seat to the same person.
    expect(await sessionSold(day.id)).toBe(0);
    expect(await stockOf(event.id)).toBe(7);
  });
});

describe("giving a ticket back", () => {
  it("returns the seat to the band it came from when the order is cancelled", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100);
    const vip = await makeTier(event.id, "VIP", 30);

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: event.id, quantity: 2, tierId: vip.id }],
      ...buyer,
    });
    if (!placed.ok) throw new Error(placed.error);
    expect(await tierSold(vip.id)).toBe(2);

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, placed.orderId),
    });
    if (!order) throw new Error("order vanished");

    expect(await restoreStock(order)).toBe(true);
    // Both levels, or the band is sold out for ever while the room says there
    // is a seat — and nothing anywhere reports which of the two is lying.
    expect(await tierSold(vip.id)).toBe(0);
    expect(await stockOf(event.id)).toBe(100);

    // Claimed once: a seller clicking twice, or a webhook racing the sweep,
    // must not credit the band a second time.
    expect(await restoreStock(order)).toBe(false);
    expect(await tierSold(vip.id)).toBe(0);
  });

  it("takes the seat off again when the seller un-cancels", async () => {
    const shop = await makeSellingShop();
    const event = await makeEvent(shop.id, 100, { sessionMode: "pick_one" });
    const tuesday = await makeSession(event.id, 10);
    const vip = await makeTier(event.id, "VIP", 30);

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [
        { productId: event.id, quantity: 1, tierId: vip.id, sessionId: tuesday.id },
      ],
      ...buyer,
    });
    if (!placed.ok) throw new Error(placed.error);

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, placed.orderId),
    });
    if (!order) throw new Error("order vanished");

    await restoreStock(order);
    expect(await tierSold(vip.id)).toBe(0);
    expect(await sessionSold(tuesday.id)).toBe(0);

    const reinstated = await db.query.orders.findFirst({
      where: eq(orders.id, placed.orderId),
    });
    if (!reinstated) throw new Error("order vanished");
    expect(await retakeStock(reinstated)).toBe(true);

    expect(await tierSold(vip.id)).toBe(1);
    expect(await sessionSold(tuesday.id)).toBe(1);
    expect(await stockOf(event.id)).toBe(99);
  });
});
