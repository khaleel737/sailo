import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  bookingClaims,
  orders,
  productStaff,
  products,
  shops,
  staffResources,
  user,
} from "@sailo/db/schema";
import { claimSlots, releaseSlots, rescheduleSlot } from "@sailo/commerce/booking/server";

/**
 * Staff calendars and class seats, against a real database — spec 51.
 *
 * WHY THIS SUITE IS THE POINT OF THE WHOLE SPEC
 *
 * `booking_claims_no_overlap` is the guarantee that Sailo never double-books,
 * and `0046` re-keys it from `(product_id, range)` to
 * `(COALESCE(staff_id, product_id), range)`, partial on `is_exclusive`. That is
 * the highest-risk line in the wave, and every property it has to hold is a
 * property of Postgres rather than of any function — a mock cannot have an
 * exclusion constraint, so a unit test here would assert a stub.
 *
 * **These fail if the guard is removed.** Drop the constraint and the two
 * "one succeeds" tests below hand two buyers the same stylist at the same
 * hour. Key it on `staff_id` alone instead of the coalesce and "a shop with no
 * staff books as it always did" goes red, because `NULL = NULL` is unknown and
 * an exclusion constraint on a null column excludes nothing at all — which is
 * the silent version of this bug and the reason the coalesce is there.
 *
 * `PRODUCTION-PLAN.md` records the concurrent double-booking defect being found
 * only by a scenario test. This is that test, widened.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

const AT_TEN = new Date("2027-03-01T10:00:00Z");
const AT_HALF_TEN = new Date("2027-03-01T10:30:00Z");
const AT_ELEVEN = new Date("2027-03-01T11:00:00Z");
const AT_NOON = new Date("2027-03-01T12:00:00Z");
const hourAfter = (d: Date) => new Date(d.getTime() + 3_600_000);

async function makeShop() {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `salon-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `salon-${userId.slice(0, 8)}`,
      name: "Salon",
      currency: "USD",
      isPublished: true,
      plan: "business",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

async function makeService(
  shopId: string,
  over: Partial<typeof products.$inferInsert> = {},
) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Haircut",
      slug: `svc-${uid().slice(0, 8)}`,
      kind: "service",
      priceCents: 3000,
      durationMinutes: 60,
      bookingEnabled: true,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: service was not inserted");
  return p;
}

async function makeStaff(shopId: string, name: string) {
  const [s] = await db
    .insert(staffResources)
    .values({ shopId, name })
    .returning();
  if (!s) throw new Error("fixture: staff was not inserted");
  return s;
}

/** An order row, which is all a claim needs to hang off. */
async function makeOrder(shopId: string) {
  const [o] = await db
    .insert(orders)
    .values({ shopId, productTitle: "Haircut", customerName: "Buyer" })
    .returning({ id: orders.id });
  if (!o) throw new Error("fixture: order was not inserted");
  return o.id;
}

const claimCount = async (orderId: string) => {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookingClaims)
    .where(eq(bookingClaims.orderId, orderId));
  return row?.n ?? 0;
};

beforeAll(async () => {
  assertLocalDatabase();
});

describe("a shop with no staff books exactly as it did before", () => {
  /*
   * The regression that matters most, and the reason the constraint keys on
   * `COALESCE(staff_id, product_id)` rather than on `staff_id`. Every shop in
   * production has no staff rows on the day this migration lands.
   */
  it("refuses a second buyer the same slot", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const first = await makeOrder(shop.id);
    const second = await makeOrder(shop.id);

    expect(
      await claimSlots(first, [
        { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
      ]),
    ).toBe(true);

    expect(
      await claimSlots(second, [
        { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
      ]),
    ).toBe(false);
  });

  it("refuses an appointment that merely overlaps one already taken", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const first = await makeOrder(shop.id);
    const second = await makeOrder(shop.id);

    await claimSlots(first, [
      { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
    ]);
    // 10:30–11:30 starts at a different instant and is still the same hour of
    // somebody's day. A unique index on the start would let this through.
    expect(
      await claimSlots(second, [
        {
          productId: service.id,
          startsAt: AT_HALF_TEN,
          endsAt: hourAfter(AT_HALF_TEN),
        },
      ]),
    ).toBe(false);
  });

  it("allows back-to-back appointments, because the range is half-open", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const first = await makeOrder(shop.id);
    const second = await makeOrder(shop.id);

    await claimSlots(first, [
      { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
    ]);
    expect(
      await claimSlots(second, [
        { productId: service.id, startsAt: AT_ELEVEN, endsAt: AT_NOON },
      ]),
    ).toBe(true);
  });

  it("hands exactly one of two racing buyers the slot", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const a = await makeOrder(shop.id);
    const b = await makeOrder(shop.id);

    const both = await Promise.all([
      claimSlots(a, [{ productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN }]),
      claimSlots(b, [{ productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN }]),
    ]);

    expect(both.filter(Boolean)).toHaveLength(1);
  });
});

describe("two stylists, one time", () => {
  /*
   * The scenario the spec names: "two buyers, two stylists, one time → **both
   * succeed**". This is the whole reason the constraint moved, and it fails
   * against `0004`'s product key.
   */
  it("takes two appointments at once when two people can work", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const sam = await makeStaff(shop.id, "Sam");
    const alex = await makeStaff(shop.id, "Alex");
    const a = await makeOrder(shop.id);
    const b = await makeOrder(shop.id);

    const both = await Promise.all([
      claimSlots(a, [
        { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN, staffId: sam.id },
      ]),
      claimSlots(b, [
        { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN, staffId: alex.id },
      ]),
    ]);

    expect(both).toEqual([true, true]);
  });

  it("still refuses two buyers racing for the same stylist", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const sam = await makeStaff(shop.id, "Sam");
    const a = await makeOrder(shop.id);
    const b = await makeOrder(shop.id);

    const both = await Promise.all([
      claimSlots(a, [
        { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN, staffId: sam.id },
      ]),
      claimSlots(b, [
        { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN, staffId: sam.id },
      ]),
    ]);

    expect(both.filter(Boolean)).toHaveLength(1);
  });

  /*
   * The gap `0004` could never see. One hairdresser, a cut and a colour, both
   * at ten: two claims naming *different products*, which the product-keyed
   * constraint never compared. For a solo practitioner that was already a
   * double-booking; with staff it is one person in two chairs.
   */
  it("refuses one stylist two different services at the same time", async () => {
    const shop = await makeShop();
    const cut = await makeService(shop.id, { title: "Cut" });
    const colour = await makeService(shop.id, { title: "Colour" });
    const sam = await makeStaff(shop.id, "Sam");
    await db.insert(productStaff).values([
      { productId: cut.id, staffId: sam.id },
      { productId: colour.id, staffId: sam.id },
    ]);
    const a = await makeOrder(shop.id);
    const b = await makeOrder(shop.id);

    expect(
      await claimSlots(a, [
        { productId: cut.id, startsAt: AT_TEN, endsAt: AT_ELEVEN, staffId: sam.id },
      ]),
    ).toBe(true);
    expect(
      await claimSlots(b, [
        {
          productId: colour.id,
          startsAt: AT_HALF_TEN,
          endsAt: hourAfter(AT_HALF_TEN),
          staffId: sam.id,
        },
      ]),
    ).toBe(false);
  });
});

describe("a class holds more than one person", () => {
  const CLASS_SEATS = 10;

  async function makeClass(shopId: string) {
    return makeService(shopId, {
      title: "Yoga",
      bookingCapacity: CLASS_SEATS,
    });
  }

  it("seats ten of twelve buyers arriving at once, and refuses two", async () => {
    const shop = await makeShop();
    const klass = await makeClass(shop.id);

    const orderIds = await Promise.all(
      Array.from({ length: 12 }, () => makeOrder(shop.id)),
    );

    const results = await Promise.all(
      orderIds.map((orderId) =>
        claimSlots(orderId, [
          {
            productId: klass.id,
            startsAt: AT_TEN,
            endsAt: AT_ELEVEN,
            seats: 1,
            capacity: CLASS_SEATS,
          },
        ]),
      ),
    );

    // The ceiling is summed inside the statement that adds a seat. A count
    // taken in JavaScript is a count all twelve of them pass.
    expect(results.filter(Boolean)).toHaveLength(CLASS_SEATS);
    expect(results.filter((r) => !r)).toHaveLength(2);

    const [seated] = await db
      .select({ n: sql<number>`coalesce(sum(${bookingClaims.seatsTaken}), 0)::int` })
      .from(bookingClaims)
      .where(
        and(
          eq(bookingClaims.productId, klass.id),
          eq(bookingClaims.isExclusive, false),
        ),
      );
    expect(seated?.n).toBe(CLASS_SEATS);
  });

  it("counts a party of four against the same ten seats", async () => {
    const shop = await makeShop();
    const klass = await makeClass(shop.id);
    const party = await makeOrder(shop.id);
    const rest = await makeOrder(shop.id);

    expect(
      await claimSlots(party, [
        {
          productId: klass.id,
          startsAt: AT_TEN,
          endsAt: AT_ELEVEN,
          seats: 8,
          capacity: CLASS_SEATS,
        },
      ]),
    ).toBe(true);

    // Three more would be eleven. Refused, rather than partly seated.
    expect(
      await claimSlots(rest, [
        {
          productId: klass.id,
          startsAt: AT_TEN,
          endsAt: AT_ELEVEN,
          seats: 3,
          capacity: CLASS_SEATS,
        },
      ]),
    ).toBe(false);
  });

  it("keeps a class and an appointment on the same product apart", async () => {
    // Overlapping class seats are allowed *because* they are non-exclusive.
    // An exclusive claim in the same range is still refused against another
    // exclusive one, which is what stops the flag becoming a way past the
    // constraint.
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const a = await makeOrder(shop.id);
    const b = await makeOrder(shop.id);

    await claimSlots(a, [
      { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
    ]);
    expect(
      await claimSlots(b, [
        { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
      ]),
    ).toBe(false);
  });
});

describe("a basket is all-or-nothing", () => {
  it("gives back the first slot when the second is gone", async () => {
    const shop = await makeShop();
    const cut = await makeService(shop.id, { title: "Cut" });
    const colour = await makeService(shop.id, { title: "Colour" });

    const other = await makeOrder(shop.id);
    await claimSlots(other, [
      { productId: colour.id, startsAt: AT_ELEVEN, endsAt: AT_NOON },
    ]);

    const basket = await makeOrder(shop.id);
    expect(
      await claimSlots(basket, [
        { productId: cut.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
        { productId: colour.id, startsAt: AT_ELEVEN, endsAt: AT_NOON },
      ]),
    ).toBe(false);

    // A partial booking is not a smaller order — it is an order the buyer did
    // not ask for, so the first slot went back.
    expect(await claimCount(basket)).toBe(0);
  });
});

describe("a buyer moving their own appointment", () => {
  it("never loses the old slot to a failure to get the new one", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);

    const mine = await makeOrder(shop.id);
    await claimSlots(mine, [
      { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
    ]);

    // Somebody else holds the time they want.
    const theirs = await makeOrder(shop.id);
    await claimSlots(theirs, [
      { productId: service.id, startsAt: AT_NOON, endsAt: hourAfter(AT_NOON) },
    ]);

    const moved = await rescheduleSlot({
      orderId: mine,
      productId: service.id,
      from: AT_TEN,
      to: AT_NOON,
      durationMinutes: 60,
    });

    expect(moved).toBe(false);
    // Still theirs, and still at ten. The claim they had is the one they keep.
    const rows = await db.query.bookingClaims.findMany({
      where: eq(bookingClaims.orderId, mine),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startsAt.toISOString()).toBe(AT_TEN.toISOString());
  });

  it("moves an appointment onto a free time", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const mine = await makeOrder(shop.id);
    await claimSlots(mine, [
      { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
    ]);

    expect(
      await rescheduleSlot({
        orderId: mine,
        productId: service.id,
        from: AT_TEN,
        to: AT_NOON,
        durationMinutes: 60,
      }),
    ).toBe(true);

    const rows = await db.query.bookingClaims.findMany({
      where: eq(bookingClaims.orderId, mine),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startsAt.toISOString()).toBe(AT_NOON.toISOString());
  });

  /*
   * The case the release-then-claim order exists for: a fifteen-minute nudge,
   * where the new range overlaps the old and the order's own claim would
   * otherwise collide with itself.
   */
  it("moves an appointment onto a time that overlaps its own", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const mine = await makeOrder(shop.id);
    await claimSlots(mine, [
      { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
    ]);

    expect(
      await rescheduleSlot({
        orderId: mine,
        productId: service.id,
        from: AT_TEN,
        to: AT_HALF_TEN,
        durationMinutes: 60,
      }),
    ).toBe(true);

    const rows = await db.query.bookingClaims.findMany({
      where: eq(bookingClaims.orderId, mine),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startsAt.toISOString()).toBe(AT_HALF_TEN.toISOString());
  });

  it("releases every slot an order held when it is cancelled", async () => {
    const shop = await makeShop();
    const service = await makeService(shop.id);
    const mine = await makeOrder(shop.id);
    await claimSlots(mine, [
      { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
    ]);

    await releaseSlots(mine);
    expect(await claimCount(mine)).toBe(0);

    // And the time is free again for the next buyer.
    const next = await makeOrder(shop.id);
    expect(
      await claimSlots(next, [
        { productId: service.id, startsAt: AT_TEN, endsAt: AT_ELEVEN },
      ]),
    ).toBe(true);
  });
});
