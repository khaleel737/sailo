import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  broadcastDeliveries,
  broadcasts,
  clients,
  emailSuppressions,
  eventReminders,
  orders,
  paymentMethods,
  products,
  shops,
  user,
} from "@sailo/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { releaseDownloads } from "@/lib/downloads";
import { calendarFor } from "@sailo/commerce/booking/server";
import { forgetExternalBusy } from "@sailo/commerce/booking/server";
import { sendDueEventReminders } from "@/lib/event-reminders";
import { eventAccessForOrder } from "@/lib/event-access";
import { audienceFor, suppress } from "@/lib/broadcasts/audience";
import { queueBroadcast, runBroadcastQueue } from "@/lib/broadcasts/send";
import {
  readUnsubscribeToken,
  unsubscribeToken,
} from "@/lib/broadcasts/unsubscribe";
import { importClients } from "@/lib/import/clients";
import { getShopClients, getShopOrders } from "@/lib/queries";

/**
 * Bookings and audience, against a real database.
 *
 * Everything here is a claim the unit tests cannot make: that a busy calendar
 * actually removes a slot the storefront would have offered, that a reminder
 * sent twice is sent once, that a broadcast killed mid-flight resumes without
 * mailing anybody twice, and that an unsubscribe is honoured by a send already
 * under way. Those are properties of concurrent writes and unique indexes, and
 * a mock cannot have them.
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
      name: "Audience Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      timeZone: "UTC",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  // Bank transfer, not cash on delivery: these events are online, and cash
  // on delivery now needs somewhere to hand the cash over — a video call has
  // no door. Bank transfer settles later just the same, so the "held until the
  // seller confirms payment" behaviour these tests turn on is unchanged.
  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "bank_transfer",
    label: "bank_transfer",
    config: {
      bankName: "Test Bank",
      accountName: "Bookings Ltd",
      accountNumber: "12345678",
    } as never,
    isEnabled: true,
    position: 0,
  });
  return shop;
}

/** Every day nine to five, in the shop's own zone. */
const NINE_TO_FIVE = Array.from({ length: 7 }, () => [
  { from: "09:00", to: "17:00" },
]);

async function makeService(shopId: string) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Consultation",
      slug: `svc-${uid().slice(0, 8)}`,
      kind: "service",
      priceCents: 5000,
      durationMinutes: 60,
      bookingEnabled: true,
      bookingLeadHours: 0,
      isPublished: true,
      inStock: true,
    })
    .returning();
  if (!p) throw new Error("fixture: service was not inserted");
  return p;
}

async function makeEvent(
  shopId: string,
  over: Partial<typeof products.$inferInsert> = {},
) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Live Workshop",
      slug: `ev-${uid().slice(0, 8)}`,
      kind: "event",
      priceCents: 2500,
      eventStartsAt: new Date(Date.now() + 7 * 24 * 3_600_000),
      serviceMode: "online",
      eventJoinUrl: "https://zoom.us/j/secret-room",
      releaseOnPayment: true,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: event was not inserted");
  return p;
}

async function placeOrder(shopId: string, productId: string, quantity = 1) {
  const r = await createOrderIntent({
    shopId,
    items: [{ productId, quantity }],
    paymentMethod: "bank_transfer",
    ...buyer,
  });
  if (!r.ok) throw new Error(`order refused: ${r.error}`);
  return r.orderId;
}

/** A consented, mailable contact. */
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

/** An ICS body with one busy block over a given UTC hour. */
function icsBusyAt(startsAt: Date, hours = 1): string {
  const stamp = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Scenario//EN",
    "BEGIN:VEVENT",
    `UID:${uid()}`,
    `DTSTART:${stamp(startsAt)}`,
    `DTEND:${stamp(new Date(startsAt.getTime() + hours * 3_600_000))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** The host every stubbed calendar in this file lives on. */
const FEED_HOST = "calendar.example.com";
const FEED_URL = `https://${FEED_HOST}/private/basic.ics`;

/**
 * Stands in for the seller's calendar provider — and only for it.
 *
 * Everything else is handed to the real `fetch`, because the database is
 * reached over HTTP here too: `@neondatabase/serverless` speaks Neon's HTTP
 * protocol through the local proxy, so a blanket `vi.stubGlobal("fetch")`
 * does not stub a calendar, it unplugs Postgres.
 */
function stubFeed(body: string | Error) {
  const real = globalThis.fetch;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!url.includes(FEED_HOST)) return real(input, init);

    if (body instanceof Error) throw body;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/calendar" },
    });
  });
}

beforeAll(() => {
  assertLocalDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */

describe("the seller's own calendar blocks Sailo slots", () => {
  /** Tomorrow at 10:00 UTC — inside opening hours, past the notice period. */
  const tomorrowAt = (hour: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };

  const startsOn = (days: { slots: { startsAt: Date }[] }[]) =>
    days.flatMap((d) => d.slots.map((s) => s.startsAt.toISOString()));

  it("removes a slot the seller is already busy in", async () => {
    const busyAt = tomorrowAt(10);
    const shop = await makeShop({
      bookingHours: NINE_TO_FIVE,
      calendarFeedUrl: FEED_URL,
    });
    const service = await makeService(shop.id);
    await forgetExternalBusy(shop.id);

    stubFeed(icsBusyAt(busyAt));
    const withFeed = await calendarFor(shop, service, {
      days: 3,
      now: new Date(),
    });

    expect(startsOn(withFeed)).not.toContain(busyAt.toISOString());
    // And the hour either side is still on sale — the block is a range, not
    // a day.
    expect(startsOn(withFeed)).toContain(tomorrowAt(11).toISOString());
  });

  it("fails open when the calendar cannot be reached", async () => {
    /*
     * The load-bearing one. A Google outage must not empty every seller's
     * calendar at once — that would be a self-inflicted closure with no
     * upside, so an unreachable feed blocks nothing and the shop keeps the
     * availability it had before this feature existed.
     */
    const busyAt = tomorrowAt(10);
    const shop = await makeShop({
      bookingHours: NINE_TO_FIVE,
      calendarFeedUrl: FEED_URL,
    });
    const service = await makeService(shop.id);

    await forgetExternalBusy(shop.id);
    stubFeed(new Error("ECONNREFUSED"));
    const degraded = await calendarFor(shop, service, {
      days: 3,
      now: new Date(),
    });

    expect(startsOn(degraded)).toContain(busyAt.toISOString());
  });

  it("ignores a feed the shop's plan doesn't include", async () => {
    // Downgrading must stop the subtraction, not leave a paid feature running
    // on a free shop because a column still holds a URL.
    const busyAt = tomorrowAt(10);
    const shop = await makeShop({
      plan: "free",
      subscriptionStatus: null,
      bookingHours: NINE_TO_FIVE,
      calendarFeedUrl: FEED_URL,
    });
    const service = await makeService(shop.id);
    await forgetExternalBusy(shop.id);

    stubFeed(icsBusyAt(busyAt));
    const free = await calendarFor(shop, service, { days: 3, now: new Date() });

    expect(startsOn(free)).toContain(busyAt.toISOString());
  });
});

/* -------------------------------------------------------------------------- */

describe("an online event's join link", () => {
  it("is withheld until the order is released, then handed over", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id);
    const orderId = await placeOrder(shop.id, event.id);

    const before = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    if (!before) throw new Error("order vanished");

    const locked = await eventAccessForOrder(before);
    expect(locked).toHaveLength(1);
    expect(locked[0]?.joinUrl).toBeNull();
    expect(locked[0]?.locked).toBe(true);

    await releaseDownloads(orderId);

    const after = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    if (!after) throw new Error("order vanished");
    const open = await eventAccessForOrder(after);
    expect(open[0]?.joinUrl).toBe("https://zoom.us/j/secret-room");
    expect(open[0]?.locked).toBe(false);
  });

  it("is never handed over for an in-person event", async () => {
    // A venue is not joined, and a stale link on a room booking would be a
    // link to somewhere the buyer is not meant to be.
    const shop = await makeShop();
    const event = await makeEvent(shop.id, {
      serviceMode: "in_person",
      serviceLocation: "The Old Hall",
    });
    const orderId = await placeOrder(shop.id, event.id);
    await releaseDownloads(orderId);

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    if (!order) throw new Error("order vanished");
    const access = await eventAccessForOrder(order);
    expect(access[0]?.joinUrl).toBeNull();
    expect(access[0]?.location).toBe("The Old Hall");
  });
});

describe("event reminders", () => {
  /** An event inside the hour-out window, with its order already paid for. */
  async function readyToRemind(minutesFromNow: number) {
    const shop = await makeShop();
    const event = await makeEvent(shop.id, {
      eventStartsAt: new Date(Date.now() + minutesFromNow * 60_000),
    });
    const orderId = await placeOrder(shop.id, event.id);
    await releaseDownloads(orderId);
    return { shop, event, orderId };
  }

  const remindersFor = (orderId: string) =>
    db.query.eventReminders.findMany({
      where: eq(eventReminders.orderId, orderId),
    });

  it("claims each lead exactly once, however many times the cron runs", async () => {
    const { orderId } = await readyToRemind(30);

    await sendDueEventReminders();
    await sendDueEventReminders();
    await sendDueEventReminders();

    const rows = await remindersFor(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lead).toBe("1h");
  });

  it("does not send both leads at once to a late registrant", async () => {
    // Somebody registering forty minutes before the doors open must get one
    // email, not "tomorrow" and "in an hour" in the same second.
    const { orderId } = await readyToRemind(40);
    await sendDueEventReminders();
    const leads = (await remindersFor(orderId)).map((r) => r.lead);
    expect(leads).toEqual(["1h"]);
  });

  it("does not remind an unpaid registration", async () => {
    /*
     * The money gate, again. Reminding an unpaid registrant an hour before
     * the event would hand the join link to somebody who abandoned checkout.
     */
    const shop = await makeShop();
    const event = await makeEvent(shop.id, {
      eventStartsAt: new Date(Date.now() + 30 * 60_000),
    });
    const orderId = await placeOrder(shop.id, event.id);

    await sendDueEventReminders();
    expect(await remindersFor(orderId)).toHaveLength(0);
  });

  it("does not remind a cancelled order", async () => {
    const { orderId } = await readyToRemind(30);
    await db
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, orderId));

    await sendDueEventReminders();
    expect(await remindersFor(orderId)).toHaveLength(0);
  });

  it("reminds both events in a basket that holds two", async () => {
    /*
     * Bug shape number four, guarded. A `remindedAt` column on the order
     * would stamp once and the second event's registrant would never hear
     * from anybody.
     */
    const shop = await makeShop();
    const soon = await makeEvent(shop.id, {
      eventStartsAt: new Date(Date.now() + 20 * 60_000),
    });
    const alsoSoon = await makeEvent(shop.id, {
      eventStartsAt: new Date(Date.now() + 40 * 60_000),
    });

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [
        { productId: soon.id, quantity: 1 },
        { productId: alsoSoon.id, quantity: 1 },
      ],
      paymentMethod: "bank_transfer",
      ...buyer,
    });
    if (!r.ok) throw new Error(`order refused: ${r.error}`);
    await releaseDownloads(r.orderId);

    await sendDueEventReminders();

    const rows = await remindersFor(r.orderId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((x) => x.productId)).size).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */

describe("who a broadcast may reach", () => {
  it("takes only consented contacts", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "yes@example.com");
    await makeContact(shop.id, "no@example.com", { marketingConsentAt: null });

    const { recipients } = await audienceFor(shop.id);
    expect(recipients.map((r) => r.email)).toEqual(["yes@example.com"]);
  });

  it("excludes anyone suppressed, whatever their consent says", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "gone@example.com");
    await makeContact(shop.id, "here@example.com");
    await suppress({
      shopId: shop.id,
      email: "gone@example.com",
      reason: "bounced",
    });

    const { recipients } = await audienceFor(shop.id);
    expect(recipients.map((r) => r.email)).toEqual(["here@example.com"]);
  });

  it("narrows to a tag", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "vip@example.com", { tags: ["vip"] });
    await makeContact(shop.id, "plain@example.com");

    const { recipients } = await audienceFor(shop.id, { match: "all", rules: [{ type: "tag", value: "vip" }] });
    expect(recipients.map((r) => r.email)).toEqual(["vip@example.com"]);
  });

  it("keeps one shop's suppression out of another's list", async () => {
    // Suppression is a promise one shop made, not a platform-wide block.
    const a = await makeShop();
    const b = await makeShop();
    await makeContact(a.id, "shared@example.com");
    await makeContact(b.id, "shared@example.com");
    await suppress({
      shopId: a.id,
      email: "shared@example.com",
      reason: "unsubscribed",
    });

    expect((await audienceFor(a.id)).recipients).toHaveLength(0);
    expect((await audienceFor(b.id)).recipients).toHaveLength(1);
  });
});

describe("sending a broadcast", () => {
  async function draft(shopId: string, audienceTag: string | null = null) {
    const [row] = await db
      .insert(broadcasts)
      .values({
        shopId,
        subject: "New drop",
        bodyMarkdown: "Hello **there**.",
        audienceTag,
      })
      .returning();
    if (!row) throw new Error("fixture: broadcast was not inserted");
    return row;
  }

  const deliveries = (broadcastId: string) =>
    db.query.broadcastDeliveries.findMany({
      where: eq(broadcastDeliveries.broadcastId, broadcastId),
    });

  it("queues one row per consented contact and no more", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "a@example.com");
    await makeContact(shop.id, "b@example.com");
    await makeContact(shop.id, "c@example.com", { marketingConsentAt: null });

    const b = await draft(shop.id);
    const result = await queueBroadcast({ shop, broadcastId: b.id });

    expect(result).toMatchObject({ ok: true, queued: 2 });
    expect((await deliveries(b.id)).map((d) => d.email).toSorted()).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("refuses a second press rather than queueing twice", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "a@example.com");
    const b = await draft(shop.id);

    const first = await queueBroadcast({ shop, broadcastId: b.id });
    const second = await queueBroadcast({ shop, broadcastId: b.id });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(await deliveries(b.id)).toHaveLength(1);
  });

  it("resumes a half-sent broadcast without mailing anybody twice", async () => {
    /*
     * The crash case, simulated where it actually bites: a tick claims some
     * rows and dies. Those rows stay claimed — we do not know whether Resend
     * accepted them — and the next tick must pick up the *rest*, not start
     * the list again.
     */
    const shop = await makeShop();
    for (let i = 0; i < 5; i += 1) {
      await makeContact(shop.id, `r${i}@example.com`);
    }
    const b = await draft(shop.id);
    await queueBroadcast({ shop, broadcastId: b.id });

    // Two rows claimed by a tick that never came back.
    const all = await deliveries(b.id);
    const stranded = all.slice(0, 2);
    for (const row of stranded) {
      await db
        .update(broadcastDeliveries)
        .set({ status: "sending" })
        .where(eq(broadcastDeliveries.id, row.id));
    }

    await runBroadcastQueue();

    const after = await deliveries(b.id);
    // The stranded pair is untouched, and every other row was handled once.
    expect(
      after.filter((d) => stranded.some((s) => s.id === d.id)).map((d) => d.status),
    ).toEqual(["sending", "sending"]);
    expect(after.filter((d) => d.status === "queued")).toHaveLength(0);
    // Attempts never exceed one: nothing was claimed a second time.
    expect(after.every((d) => d.attempts <= 1)).toBe(true);
  });

  it("honours an unsubscribe that arrives mid-send", async () => {
    /*
     * A broadcast to a large list takes several ticks, and somebody who
     * unsubscribes from the first batch must not be in the fourth. This is
     * the moment a working unsubscribe stops being a link and becomes a
     * promise.
     */
    const shop = await makeShop();
    await makeContact(shop.id, "stays@example.com");
    await makeContact(shop.id, "leaves@example.com");

    const b = await draft(shop.id);
    await queueBroadcast({ shop, broadcastId: b.id });

    await suppress({
      shopId: shop.id,
      email: "leaves@example.com",
      reason: "unsubscribed",
    });
    await runBroadcastQueue();

    const rows = await deliveries(b.id);
    const left = rows.find((r) => r.email === "leaves@example.com");
    expect(left?.status).toBe("suppressed");
    expect(left?.sentAt).toBeNull();
  });

  it("closes a broadcast with nobody to send to instead of leaving it stuck", async () => {
    const shop = await makeShop();
    const b = await draft(shop.id);

    const result = await queueBroadcast({ shop, broadcastId: b.id });
    expect(result).toMatchObject({ ok: true, queued: 0 });

    const after = await db.query.broadcasts.findFirst({
      where: eq(broadcasts.id, b.id),
    });
    expect(after?.status).toBe("sent");
  });

  it("refuses to send at all on a plan without broadcasts", async () => {
    const shop = await makeShop({ plan: "free", subscriptionStatus: null });
    await makeContact(shop.id, "a@example.com");
    const b = await draft(shop.id);
    await queueBroadcast({ shop, broadcastId: b.id });

    await runBroadcastQueue();

    // Held, not sent: the rows stay queued and the quota says why.
    const rows = await deliveries(b.id);
    expect(rows.every((r) => r.status === "queued")).toBe(true);
  });
});

describe("unsubscribing", () => {
  it("round-trips a token and refuses a tampered one", async () => {
    const shop = await makeShop();
    const token = unsubscribeToken({
      shopId: shop.id,
      email: "reader@example.com",
    });
    if (!token) throw new Error("no signing secret in this environment");

    expect(readUnsubscribeToken(token)).toEqual({
      shopId: shop.id,
      email: "reader@example.com",
    });

    // One character of the payload, changed. The signature no longer holds.
    const [payload, sig] = token.split(".");
    const forged = `${payload?.slice(0, -1)}X.${sig}`;
    expect(readUnsubscribeToken(forged)).toBeNull();
  });

  it("suppresses idempotently, so a second click is not an error", async () => {
    const shop = await makeShop();
    await suppress({
      shopId: shop.id,
      email: "twice@example.com",
      reason: "unsubscribed",
    });
    await suppress({
      shopId: shop.id,
      email: "twice@example.com",
      reason: "unsubscribed",
    });

    const rows = await db.query.emailSuppressions.findMany({
      where: and(
        eq(emailSuppressions.shopId, shop.id),
        eq(emailSuppressions.email, "twice@example.com"),
      ),
    });
    expect(rows).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("contacts and tags", () => {
  it("imports without granting consent, however the file is labelled", async () => {
    /*
     * The one rule the import screen promises. A CSV column claiming consent
     * is a seller asserting it on somebody else's behalf, and Sailo is the
     * party doing the sending.
     */
    const shop = await makeShop();
    const csv = [
      "Email,Name,Tags,Marketing Consent At",
      "imported@example.com,Ada,VIP;wholesale,2020-01-01T00:00:00Z",
      "notanemail,Bad Row,,",
      "imported@example.com,Duplicate,,",
    ].join("\n");

    const report = await importClients({ shopId: shop.id, csv, dryRun: false });

    expect(report.created).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.errors).toHaveLength(2);

    const row = await db.query.clients.findFirst({
      where: and(
        eq(clients.shopId, shop.id),
        eq(clients.email, "imported@example.com"),
      ),
    });
    expect(row?.marketingConsentAt).toBeNull();
    expect(row?.source).toBe("import");
    // Folded on the way in, so `VIP` and `vip` are one audience.
    expect(row?.tags).toEqual(["vip", "wholesale"]);

    // And therefore unreachable by a broadcast.
    const { recipients } = await audienceFor(shop.id);
    expect(recipients).toHaveLength(0);
  });

  it("filters the clients list by tag in the query, not after the ceiling", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "vip@example.com", { tags: ["vip"] });
    await makeContact(shop.id, "other@example.com", { tags: ["lapsed"] });

    const tagged = await getShopClients(shop.id, 1_000, "vip");
    expect(tagged.map((c) => c.email)).toEqual(["vip@example.com"]);
  });
});

describe("the orders list filters", () => {
  it("narrows by status server-side", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id);
    const keep = await placeOrder(shop.id, event.id);
    const cancel = await placeOrder(shop.id, event.id);
    await db
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, cancel));

    const rows = await getShopOrders(shop.id, 100, { status: "new" });
    expect(rows.map((o) => o.id)).toEqual([keep]);
  });

  it("matches a coupon code case-insensitively against the snapshot", async () => {
    const shop = await makeShop();
    const event = await makeEvent(shop.id);
    const withCode = await placeOrder(shop.id, event.id);
    await placeOrder(shop.id, event.id);
    await db
      .update(orders)
      .set({ couponCode: "SUMMER20" })
      .where(eq(orders.id, withCode));

    const rows = await getShopOrders(shop.id, 100, { couponCode: "summer20" });
    expect(rows.map((o) => o.id)).toEqual([withCode]);
  });
});
