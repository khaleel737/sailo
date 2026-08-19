import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  eventSessions,
  eventTiers,
  products,
  shops,
  user,
} from "@sailo/db/schema";
import {
  claimEventCapacity,
  eventHasFutureDate,
  generateSessions,
  releaseEventCapacity,
} from "@sailo/commerce/ticketing";

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

async function makeTier(productId: string, name: string, capacity: number | null) {
  const [t] = await db
    .insert(eventTiers)
    .values({ productId, name, priceCents: 5000, capacity })
    .returning();
  if (!t) throw new Error("fixture: tier was not inserted");
  return t;
}

async function makeSession(productId: string, capacity: number | null) {
  const [s] = await db
    .insert(eventSessions)
    .values({ productId, startsAt: inAWeek(), capacity })
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
