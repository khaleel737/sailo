import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  orders,
  products,
  shops,
  subscriptionSeats,
  subscriptions,
  user,
} from "@sailo/db/schema";
import { membershipAccess } from "@sailo/commerce/memberships";
import {
  applyDueSwitches,
  cancelMembership,
  claimDunningSend,
  clearDunning,
  completeTermIfDone,
  createManualSubscription,
  extendForPaidOrder,
  inviteSeat,
  pauseMembership,
  resumeDuePauses,
  resumeMembership,
  revokeSeat,
  scheduleSwitch,
  seatByPassCode,
  setSeatCount,
} from "@sailo/commerce/memberships/server";

/**
 * Membership depth against a real database — spec 49.
 *
 * WHY EVERY ONE OF THESE IS A SCENARIO AND NOT A UNIT TEST
 *
 * The spec says all seven gaps are money-path changes, and it names why: four
 * defects in the original memberships release were found only by writing
 * scenarios — the partial-index `ON CONFLICT`, the out-of-order
 * `customer.subscription.*`, the sweep cancelling a trialling member, and the
 * missing `createOrderIntent` branch that lint caught and every test missed.
 * Each was a property of a statement or of two functions agreeing at a
 * distance, which is exactly what a mock cannot be wrong about.
 *
 * The arithmetic half lives in `terms.test.ts` and is pure. This is the half
 * that needs rows.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

const DAY = 86_400_000;

async function makeShop() {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `gym-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `gym-${userId.slice(0, 8)}`,
      name: "The Gym",
      currency: "USD",
      isPublished: true,
      plan: "business",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

async function makeMembership(
  shopId: string,
  over: Partial<typeof products.$inferInsert> = {},
) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Monthly membership",
      slug: `m-${uid().slice(0, 8)}`,
      kind: "membership",
      priceCents: 3000,
      billingInterval: "month",
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: membership was not inserted");
  return p;
}

async function makeClient(shopId: string) {
  const [c] = await db
    .insert(clients)
    .values({ shopId, name: "Member", email: `member-${uid().slice(0, 8)}@x.test` })
    .returning();
  if (!c) throw new Error("fixture: client was not inserted");
  return c;
}

/**
 * A manual membership that has already been paid for once.
 *
 * The manual rail rather than the card one, and deliberately: Stripe is the
 * billing source of truth on the card rail, so a scenario there would be
 * asserting a mock of Stripe. Everything under test here — cycle counting,
 * pause, seats, dunning, switching — is Sailo's own arithmetic, and the manual
 * rail is where Sailo owns all of it.
 */
async function startedMembership(
  shopId: string,
  productOver: Partial<typeof products.$inferInsert> = {},
) {
  const product = await makeMembership(shopId, productOver);
  const client = await makeClient(shopId);

  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      productId: product.id,
      clientId: client.id,
      productTitle: product.title,
      productKind: "membership",
      unitPriceCents: product.priceCents,
      subtotalCents: product.priceCents,
      totalCents: product.priceCents,
      currency: "USD",
      customerName: "Member",
      paymentMethod: "bank_transfer",
      paymentStatus: "unpaid",
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");

  const subscription = await createManualSubscription({
    shop: { id: shopId } as never,
    order: {
      id: order.id,
      clientId: client.id,
      productId: product.id,
      paymentMethod: "bank_transfer",
      totalCents: product.priceCents,
      currency: "USD",
    },
    interval: "month",
  });
  if (!subscription) throw new Error("fixture: subscription was not created");

  /*
   * Snapshot the term onto the subscription, as `createOrderIntent` does at
   * signup. Snapshotted rather than joined so a seller shortening the course
   * next year does not shorten one somebody already bought.
   */
  await db
    .update(subscriptions)
    .set({
      termCycles: product.termCycles,
      accessAfterTerm: product.accessAfterTerm,
    })
    .where(eq(subscriptions.id, subscription.id));

  await db
    .update(orders)
    .set({ subscriptionId: subscription.id })
    .where(eq(orders.id, order.id));

  return { product, client, order, subscriptionId: subscription.id };
}

/** The seller saying the money arrived — the only event on this rail. */
async function payFor(orderId: string) {
  await db
    .update(orders)
    .set({ paymentStatus: "paid" })
    .where(eq(orders.id, orderId));
  return extendForPaidOrder(orderId);
}

/** Raises the next period's order, as the renewal cron does. */
async function raiseNextOrder(shopId: string, subscriptionId: string) {
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
  if (!row) throw new Error("fixture: subscription vanished");
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      productId: row.productId,
      clientId: row.clientId,
      subscriptionId,
      productTitle: "Membership",
      productKind: "membership",
      unitPriceCents: row.priceCents,
      subtotalCents: row.priceCents,
      totalCents: row.priceCents,
      currency: row.currency,
      customerName: "Member",
      paymentMethod: "bank_transfer",
      paymentStatus: "unpaid",
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: renewal order was not inserted");
  return order.id;
}

const read = async (id: string) =>
  db.query.subscriptions.findFirst({ where: eq(subscriptions.id, id) });

beforeAll(async () => {
  assertLocalDatabase();
});

describe("counting cycles", () => {
  /*
   * The hazard `renewalOrderedFor` and `membershipPeriodEnd` already exist for,
   * arriving a third time. A seller toggling an order paid → unpaid → paid must
   * buy one cycle, not three — and a counter incremented in its own statement
   * afterwards would fail silently: the member's twelve-week course finishes in
   * week ten and nobody can say why.
   */
  it("buys one cycle however many times the seller re-saves the dropdown", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);

    await payFor(order.id);
    await payFor(order.id);
    await payFor(order.id);

    expect((await read(subscriptionId))?.cyclesPaid).toBe(1);
  });

  it("counts each period's own payment", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);

    const second = await raiseNextOrder(shop.id, subscriptionId);
    await payFor(second);
    expect((await read(subscriptionId))?.cyclesPaid).toBe(2);
  });
});

describe("a fixed term", () => {
  it("stops billing and keeps access when the seller sold it that way", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id, {
      termCycles: 2,
      accessAfterTerm: true,
    });

    await payFor(order.id);
    expect((await read(subscriptionId))?.endedReason).toBeNull();

    const second = await raiseNextOrder(shop.id, subscriptionId);
    await payFor(second);

    const done = await read(subscriptionId);
    expect(done?.cyclesPaid).toBe(2);
    expect(done?.endedReason).toBe("term_complete");
    expect(done?.status).toBe("canceled");
    expect(done?.cancelAtPeriodEnd).toBe(true);

    // The one new branch: the subscription is over and the door is open,
    // because a course sold in two payments is a course they now own.
    expect(membershipAccess(done ?? null, new Date(Date.now() + 400 * DAY)).open).toBe(
      true,
    );
  });

  it("drops access at the end when the seller did not", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id, {
      termCycles: 2,
      accessAfterTerm: false,
    });
    await payFor(order.id);
    await payFor(await raiseNextOrder(shop.id, subscriptionId));

    const done = await read(subscriptionId);
    expect(done?.endedReason).toBe("term_complete");
    expect(membershipAccess(done ?? null, new Date(Date.now() + 400 * DAY)).open).toBe(
      false,
    );
  });

  it("completes a term once, however many times it is asked", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id, {
      /*
       * Two rather than one. `normalizeCycles` refuses a one-cycle term
       * outright — it is a one-off purchase wearing a subscription's clothes —
       * so a fixture asking for one would never be complete and this would
       * fail for the wrong reason.
       */
      termCycles: 2,
    });
    await payFor(order.id);
    // Nudged to the last cycle without a second payment, so this test is about
    // the *claim* rather than about the counting `extendForPaidOrder` already
    // has its own test for.
    await db
      .update(subscriptions)
      .set({ cyclesPaid: 2 })
      .where(eq(subscriptions.id, subscriptionId));

    const first = await completeTermIfDone(subscriptionId);
    const second = await completeTermIfDone(subscriptionId);
    expect(first.completed).toBe(true);
    // Claimed on `ended_reason IS NULL`, so a webhook delivered twice completes
    // a term once and does not re-stamp `canceledAt`.
    expect(second.completed).toBe(false);
  });
});

describe("pause", () => {
  it("closes the door, and reopens it with the paid time carried forward", { timeout: 90_000 }, async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id, {
      pauseMaxDays: 30,
    });
    await payFor(order.id);

    const before = await read(subscriptionId);
    const endBefore = before?.currentPeriodEnd?.getTime() ?? 0;
    expect(membershipAccess(before ?? null).open).toBe(true);

    /*
     * Both instants pinned, because `pausedDays` rounds *up* — a part-day is
     * not free — so a fixture that let a few hundred milliseconds elapse
     * between the freeze and the resume would charge eight days for seven and
     * look like a bug in the arithmetic rather than in the test.
     */
    const pausedAt = new Date();
    const resumedAt = new Date(pausedAt.getTime() + 7 * DAY);

    const paused = await pauseMembership({
      shopId: shop.id,
      subscriptionId,
      days: 7,
      now: pausedAt,
    });
    expect(paused.ok).toBe(true);

    const frozen = await read(subscriptionId);
    expect(frozen?.status).toBe("paused");
    // Closed through the status alone — no second predicate learned about it.
    expect(membershipAccess(frozen ?? null).open).toBe(false);

    // Back a week later, to the millisecond.
    expect(
      await resumeMembership({ shopId: shop.id, subscriptionId, now: resumedAt }),
    ).toBe(true);

    const back = await read(subscriptionId);
    expect(back?.status).toBe("active");
    expect(back?.pausedAt).toBeNull();
    expect(back?.pauseDaysUsed).toBe(7);
    // The period moved by the days they were away, so a member with eleven
    // days left has eleven days left.
    expect(back?.currentPeriodEnd?.getTime()).toBe(endBefore + 7 * DAY);
    expect(membershipAccess(back ?? null).open).toBe(true);
  });

  it("refuses to freeze a membership whose seller does not offer it", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);

    const refused = await pauseMembership({ shopId: shop.id, subscriptionId, days: 7 });
    expect(refused).toEqual({
      ok: false,
      verdict: { allowed: false, reason: "not_offered" },
    });
  });

  it("freezes once when two tabs ask at the same moment", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id, {
      pauseMaxDays: 30,
    });
    await payFor(order.id);

    const both = await Promise.all([
      pauseMembership({ shopId: shop.id, subscriptionId, days: 7 }),
      pauseMembership({ shopId: shop.id, subscriptionId, days: 7 }),
    ]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
  });

  it("comes back on its own when the freeze runs out", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id, {
      pauseMaxDays: 30,
    });
    await payFor(order.id);
    await pauseMembership({ shopId: shop.id, subscriptionId, days: 1 });

    // A member who froze for a month must not need the seller to remember —
    // and has no account to log in to and ask.
    await resumeDuePauses(new Date(Date.now() + 2 * DAY));
    expect((await read(subscriptionId))?.status).toBe("active");
  });
});

describe("seats", () => {
  it("gives each employee their own pass, and reads the payer's access", { timeout: 90_000 }, async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);
    await setSeatCount({ shopId: shop.id, subscriptionId, seats: 3 });

    const ana = await inviteSeat({
      shopId: shop.id,
      subscriptionId,
      email: "ana@corp.test",
      name: "Ana",
    });
    const bo = await inviteSeat({
      shopId: shop.id,
      subscriptionId,
      email: "bo@corp.test",
    });
    expect(ana.ok && bo.ok).toBe(true);
    if (!ana.ok || !bo.ok) throw new Error("fixture: seats were not created");

    // A shared code for eight employees is one code at the door.
    expect(ana.seat.passCode).not.toBe(bo.seat.passCode);

    const found = await seatByPassCode(ana.seat.passCode ?? "");
    expect(found?.access.open).toBe(true);

    // And the payer's cancellation stops all of them, with nothing here that
    // knows how to do that: the seat reads the parent.
    await cancelMembership({ shopId: shop.id, subscriptionId, immediate: true });
    const after = await seatByPassCode(ana.seat.passCode ?? "");
    expect(after?.access.open).toBe(false);
  });

  it("refuses a ninth seat on a subscription of eight", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);
    await setSeatCount({ shopId: shop.id, subscriptionId, seats: 2 });

    expect(
      (await inviteSeat({ shopId: shop.id, subscriptionId, email: "a@corp.test" })).ok,
    ).toBe(true);
    expect(
      (await inviteSeat({ shopId: shop.id, subscriptionId, email: "b@corp.test" })).ok,
    ).toBe(true);

    const third = await inviteSeat({
      shopId: shop.id,
      subscriptionId,
      email: "c@corp.test",
    });
    expect(third.ok).toBe(false);
  });

  it("frees a seat for reassignment when one is revoked", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);
    await setSeatCount({ shopId: shop.id, subscriptionId, seats: 1 });

    const first = await inviteSeat({
      shopId: shop.id,
      subscriptionId,
      email: "leaver@corp.test",
    });
    if (!first.ok) throw new Error("fixture: seat was not created");

    expect(
      (await inviteSeat({ shopId: shop.id, subscriptionId, email: "new@corp.test" })).ok,
    ).toBe(false);

    await revokeSeat({ shopId: shop.id, subscriptionId, seatId: first.seat.id });
    expect(
      (await inviteSeat({ shopId: shop.id, subscriptionId, email: "new@corp.test" })).ok,
    ).toBe(true);
  });

  /*
   * Refused with the number rather than silently truncated — rule 8.
   * Truncating would pick which employee loses their access, at random, on the
   * seller's behalf, and the first anybody would know is somebody turned away.
   */
  it("refuses to cut the seat count below what people have accepted", { timeout: 90_000 }, async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);
    await setSeatCount({ shopId: shop.id, subscriptionId, seats: 3 });
    for (const email of ["a@corp.test", "b@corp.test", "c@corp.test"]) {
      await inviteSeat({ shopId: shop.id, subscriptionId, email });
    }

    expect(await setSeatCount({ shopId: shop.id, subscriptionId, seats: 1 })).toEqual({
      allowed: false,
      reason: "below_accepted",
      accepted: 3,
    });
    expect((await read(subscriptionId))?.seats).toBe(3);
  });

  it("re-inviting somebody updates their seat rather than taking a second", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);
    await setSeatCount({ shopId: shop.id, subscriptionId, seats: 1 });

    await inviteSeat({ shopId: shop.id, subscriptionId, email: "Ana@Corp.test" });
    // Folded to lowercase by the writer, so the unique index actually bites on
    // a second spelling of the same address.
    const again = await inviteSeat({
      shopId: shop.id,
      subscriptionId,
      email: "ana@corp.test",
      name: "Ana",
    });
    expect(again.ok).toBe(true);

    const rows = await db.query.subscriptionSeats.findMany({
      where: eq(subscriptionSeats.subscriptionId, subscriptionId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Ana");
  });
});

describe("dunning", () => {
  it("sends once per failure and never twice for one event", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);

    const first = await claimDunningSend({ subscriptionId });
    expect(first).toEqual({ send: true, attempt: 1, final: false });

    // The same failure delivered again — Stripe delivers at least once and out
    // of order, and a member who gets four identical emails rings their bank.
    expect(await claimDunningSend({ subscriptionId })).toEqual({
      send: false,
      reason: "too_soon",
    });
  });

  it("stops after three, rather than chasing somebody for ever", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);

    const day = (n: number) => new Date(Date.now() + n * DAY);
    expect((await claimDunningSend({ subscriptionId, now: day(0) })).send).toBe(true);
    expect((await claimDunningSend({ subscriptionId, now: day(3) })).send).toBe(true);
    const third = await claimDunningSend({ subscriptionId, now: day(6) });
    expect(third).toEqual({ send: true, attempt: 3, final: true });

    expect(await claimDunningSend({ subscriptionId, now: day(9) })).toEqual({
      send: false,
      reason: "exhausted",
    });
  });

  /*
   * Without the reset, a member whose card failed twice in March and recovered
   * has one attempt left for ever: the next genuine failure, in November, sends
   * one email and gives up on somebody who would have fixed their card.
   */
  it("starts over once the money arrives", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);

    await claimDunningSend({ subscriptionId });
    await clearDunning(subscriptionId);
    expect((await read(subscriptionId))?.dunningAttempts).toBe(0);

    expect(await claimDunningSend({ subscriptionId })).toMatchObject({
      send: true,
      attempt: 1,
    });
  });

  it("is cleared by a paid renewal, not only by a hand call", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);
    await claimDunningSend({ subscriptionId });

    await payFor(await raiseNextOrder(shop.id, subscriptionId));
    expect((await read(subscriptionId))?.dunningAttempts).toBe(0);
  });
});

describe("switching", () => {
  it("takes effect at the period end and not before", { timeout: 90_000 }, async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);
    const yearly = await makeMembership(shop.id, {
      title: "Yearly",
      priceCents: 30000,
      billingInterval: "year",
    });

    expect(
      await scheduleSwitch({
        shopId: shop.id,
        subscriptionId,
        toProductId: yearly.id,
      }),
    ).toBe(true);

    // Nothing has moved yet: the member is still on the plan they paid for.
    const pending = await read(subscriptionId);
    expect(pending?.productId).not.toBe(yearly.id);
    expect(pending?.pendingProductId).toBe(yearly.id);

    // Nothing due yet either — the sweep leaves it alone until the period ends.
    await applyDueSwitches(new Date());
    expect((await read(subscriptionId))?.productId).not.toBe(yearly.id);

    await applyDueSwitches(new Date(Date.now() + 60 * DAY));
    const switched = await read(subscriptionId);
    expect(switched?.productId).toBe(yearly.id);
    expect(switched?.priceCents).toBe(30000);
    expect(switched?.interval).toBe("year");
    expect(switched?.pendingProductId).toBeNull();
  });

  it("refuses a switch to another shop's membership", { timeout: 90_000 }, async () => {
    const shop = await makeShop();
    const other = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);
    const theirs = await makeMembership(other.id, { title: "Not yours" });

    expect(
      await scheduleSwitch({
        shopId: shop.id,
        subscriptionId,
        toProductId: theirs.id,
      }),
    ).toBe(false);
  });
});

describe("cancelling", () => {
  it("ends access at once and records the refund decision", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);

    const result = await cancelMembership({
      shopId: shop.id,
      subscriptionId,
      immediate: true,
      refunded: false,
    });
    expect(result.ok).toBe(true);

    const row = await read(subscriptionId);
    // A member who loses access mid-month with no refund and no record is a
    // chargeback with our own panel as the evidence against us.
    expect(row?.endedReason).toBe("canceled");
    expect(membershipAccess(row ?? null).open).toBe(false);
  });

  it("records a refunded cancellation differently", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id);
    await payFor(order.id);

    await cancelMembership({
      shopId: shop.id,
      subscriptionId,
      immediate: true,
      refunded: true,
    });
    expect((await read(subscriptionId))?.endedReason).toBe("canceled_refunded");
  });

  it("refuses a member's own cancellation inside a minimum term", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id, {
      minimumTermCycles: 6,
    });
    await payFor(order.id);

    const refused = await cancelMembership({
      shopId: shop.id,
      subscriptionId,
      immediate: false,
    });
    expect(refused.ok).toBe(false);
    expect(refused.verdict).toMatchObject({ reason: "minimum_term", cyclesLeft: 5 });
    // And the membership is untouched — no half-cancelled row.
    expect((await read(subscriptionId))?.cancelAtPeriodEnd).toBe(false);
  });

  it("lets the seller end it immediately anyway, because the term protects them", async () => {
    const shop = await makeShop();
    const { order, subscriptionId } = await startedMembership(shop.id, {
      minimumTermCycles: 6,
    });
    await payFor(order.id);

    const done = await cancelMembership({
      shopId: shop.id,
      subscriptionId,
      immediate: true,
    });
    expect(done.ok).toBe(true);
  });
});
