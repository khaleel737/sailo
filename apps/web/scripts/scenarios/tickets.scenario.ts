import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  orders,
  paymentMethods,
  productFiles,
  products,
  shops,
  tickets,
  user,
} from "@sailo/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { releaseDownloads } from "@/lib/downloads";
import {
  checkInTicketById,
  checkInTicketForShop,
  issueTickets,
  reinstateTicketsForOrder,
  undoCheckIn,
  voidTicketsForOrder,
} from "@/lib/tickets";
import { importTickets } from "@/lib/import/tickets";
import { eventDoorList, eventDoorStats } from "@/lib/queries/tickets";

/**
 * Event tickets, end to end: minted with the order, gated by the release
 * timestamp, admitted exactly once — including the two-phones race the
 * check-in screen exists to survive.
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

const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);
const lastWeek = () => new Date(Date.now() - 7 * 24 * 3600 * 1000);

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
      name: "Ticket Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
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

async function makeEvent(
  shopId: string,
  over: Partial<typeof products.$inferInsert> = {},
) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Rooftop Show",
      slug: `ev-${uid().slice(0, 8)}`,
      kind: "event",
      priceCents: 2500,
      eventStartsAt: inAWeek(),
      releaseOnPayment: true,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: event was not inserted");
  return p;
}

const orderRow = (id: string) =>
  db.query.orders.findFirst({ where: eq(orders.id, id) });
const ticketRows = (orderId: string) =>
  db.query.tickets.findMany({ where: eq(tickets.orderId, orderId) });

async function placedOrder(shopId: string, productId: string, quantity = 1) {
  const r = await createOrderIntent({
    shopId,
    items: [{ productId, quantity }],
    paymentMethod: "cod",
    ...buyer,
  });
  if (!r.ok) throw new Error(`order refused: ${r.error}`);
  return r.orderId;
}

beforeAll(async () => {
  assertLocalDatabase();
});

describe("tickets are minted with the order", () => {
  it("fans quantity out to one row per admission, held until payment", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const orderId = await placedOrder(shop.id, ev.id, 3);

    const rows = await ticketRows(orderId);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((t) => t.code)).size).toBe(3);
    expect(rows.every((t) => t.status === "valid")).toBe(true);

    const order = await orderRow(orderId);
    expect(order?.downloadToken).toBeTruthy();
    expect(order?.downloadReleasedAt).toBeNull();
  });

  it("unlocks a free event immediately", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, { priceCents: 0 });
    const orderId = await placedOrder(shop.id, ev.id);
    expect((await orderRow(orderId))?.downloadReleasedAt).not.toBeNull();
  });

  it("unlocks immediately when the seller doesn't hold tickets for payment", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, { releaseOnPayment: false });
    const orderId = await placedOrder(shop.id, ev.id);
    expect((await orderRow(orderId))?.downloadReleasedAt).not.toBeNull();
  });

  it("mints no tickets for other kinds", async () => {
    const shop = await makeShop();
    const [p] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Mug",
        slug: `p-${uid().slice(0, 8)}`,
        kind: "physical",
        priceCents: 1200,
        isPublished: true,
        inStock: true,
      })
      .returning();
    if (!p) throw new Error("fixture: product was not inserted");
    const orderId = await placedOrder(shop.id, p.id, 2);
    expect(await ticketRows(orderId)).toHaveLength(0);
    expect((await orderRow(orderId))?.downloadToken).toBeNull();
  });

  it("shares one token across a mixed basket, and one hold holds it all", async () => {
    const shop = await makeShop();
    // The event would unlock now; the digital line is held until payment.
    const ev = await makeEvent(shop.id, { releaseOnPayment: false });
    const [dig] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Poster PDF",
        slug: `d-${uid().slice(0, 8)}`,
        kind: "digital",
        priceCents: 500,
        releaseOnPayment: true,
        isPublished: true,
        inStock: true,
      })
      .returning();
    if (!dig) throw new Error("fixture: digital product was not inserted");
    await db.insert(productFiles).values({
      productId: dig.id,
      name: "poster.pdf",
      url: "https://store1.public.blob.vercel-storage.com/poster.pdf",
      sizeBytes: 2048,
      contentType: "application/pdf",
      position: 0,
    });

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [
        { productId: ev.id, quantity: 1 },
        { productId: dig.id, quantity: 1 },
      ],
      paymentMethod: "cod",
      ...buyer,
    });
    if (!r.ok) throw new Error(r.error);

    const order = await orderRow(r.orderId);
    expect(order?.downloadToken).toBeTruthy();
    expect(order?.downloadReleasedAt).toBeNull();
    expect(await ticketRows(r.orderId)).toHaveLength(1);
  });
});

describe("sales close when the doors open", () => {
  it("refuses a ticket for an event that has started", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, { eventStartsAt: lastWeek() });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: ev.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("closed");
  });

  it("capacity is stock: the room cannot oversell", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, {
      trackInventory: true,
      stockQuantity: 2,
    });

    // Asking for three of the last two clamps to two — the same rule the
    // storefront picker shows a buyer — and mints exactly two admissions.
    const clamped = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: ev.id, quantity: 3 }],
      paymentMethod: "cod",
      ...buyer,
    });
    if (!clamped.ok) throw new Error(clamped.error);
    expect(await ticketRows(clamped.orderId)).toHaveLength(2);

    // The room is now full; the next buyer is refused outright.
    const refused = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: ev.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(refused.ok).toBe(false);
  });

  it("the last seat, contested concurrently, admits exactly one", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, {
      trackInventory: true,
      stockQuantity: 1,
    });
    const results = await Promise.all([
      createOrderIntent({
        shopId: shop.id,
        items: [{ productId: ev.id, quantity: 1 }],
        paymentMethod: "cod",
        ...buyer,
      }),
      createOrderIntent({
        shopId: shop.id,
        items: [{ productId: ev.id, quantity: 1 }],
        paymentMethod: "cod",
        ...buyer,
      }),
    ]);
    const admittedOrders = results.filter((r) => r.ok);
    const sold = (
      await Promise.all(
        admittedOrders.map((r) => (r.ok ? ticketRows(r.orderId) : [])),
      )
    ).flat();
    expect(sold).toHaveLength(1);
  });
});

describe("the door", () => {
  async function releasedTicket() {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const orderId = await placedOrder(shop.id, ev.id);
    await releaseDownloads(orderId);
    const [ticket] = await ticketRows(orderId);
    if (!ticket) throw new Error("fixture: no ticket");
    return { shop, ticket };
  }

  it("refuses an unpaid ticket, admits it after release, once", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const orderId = await placedOrder(shop.id, ev.id);
    const [ticket] = await ticketRows(orderId);
    if (!ticket) throw new Error("fixture: no ticket was minted");

    expect(
      (await checkInTicketForShop(shop.id, ticket.code)).status,
    ).toBe("not_released");

    await releaseDownloads(orderId);

    const first = await checkInTicketForShop(shop.id, ticket.code);
    expect(first.status).toBe("checked_in");

    const second = await checkInTicketForShop(shop.id, ticket.code);
    expect(second.status).toBe("already_used");
    if (second.status === "already_used") {
      expect(second.usedAt).not.toBeNull();
    }
  });

  it("two phones, one ticket: exactly one admits", async () => {
    const { shop, ticket } = await releasedTicket();
    const results = await Promise.all([
      checkInTicketForShop(shop.id, ticket.code),
      checkInTicketForShop(shop.id, ticket.code),
    ]);
    const admitted = results.filter((r) => r.status === "checked_in");
    expect(admitted).toHaveLength(1);
  });

  it("reads a code however the door typed it", async () => {
    const { shop, ticket } = await releasedTicket();
    const mangled = ticket.code
      .toLowerCase()
      .replace("-", " ")
      .replace(/0/g, "o")
      .replace(/1/g, "l");
    const r = await checkInTicketForShop(shop.id, mangled);
    expect(r.status).toBe("checked_in");
  });

  it("another shop's door does not admit this shop's ticket", async () => {
    const { ticket } = await releasedTicket();
    const stranger = await makeShop();
    const r = await checkInTicketForShop(stranger.id, ticket.code);
    expect(r.status).toBe("not_found");
    // And the failed attempt spent nothing: the ticket still admits at home.
    expect(
      (await db.query.tickets.findFirst({ where: eq(tickets.id, ticket.id) }))
        ?.status,
    ).toBe("valid");
  });

  it("gibberish is not a ticket", async () => {
    const shop = await makeShop();
    expect((await checkInTicketForShop(shop.id, "NOPE!")).status).toBe(
      "not_found",
    );
    expect((await checkInTicketForShop(shop.id, "")).status).toBe("not_found");
  });
});

/**
 * Everything the door gained when it stopped being one text box: a scope, an
 * undo, admissions nobody bought, and the rule that a refunded ticket stops
 * opening a door.
 */
describe("working a door at scale", () => {
  async function releasedTicketFor(shopId: string, productId: string) {
    const orderId = await placedOrder(shopId, productId);
    await releaseDownloads(orderId);
    const [ticket] = await ticketRows(orderId);
    if (!ticket) throw new Error("fixture: no ticket");
    return { orderId, ticket };
  }

  it("a door scoped to one event names the other event rather than denying it", async () => {
    /*
     * A shop running two rooms on one night. Answering "not found" for the
     * wrong room is the worst possible reading: the volunteer sends away a
     * guest who is standing outside the right building with a valid ticket.
     */
    const shop = await makeShop();
    const tonight = await makeEvent(shop.id, { title: "Rooftop Show" });
    const other = await makeEvent(shop.id, { title: "Basement Set" });
    const { ticket } = await releasedTicketFor(shop.id, other.id);

    const scoped = await checkInTicketForShop(shop.id, ticket.code, {
      productId: tonight.id,
    });
    expect(scoped.status).toBe("wrong_event");
    if (scoped.status === "wrong_event") {
      expect(scoped.productTitle).toBe("Basement Set");
    }

    // And it was not spent by the refusal — it still admits at its own door.
    const right = await checkInTicketForShop(shop.id, ticket.code, {
      productId: other.id,
    });
    expect(right.status).toBe("checked_in");
  });

  it("records who admitted them", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const { ticket } = await releasedTicketFor(shop.id, ev.id);

    const r = await checkInTicketForShop(shop.id, ticket.code, {
      productId: ev.id,
      by: "Front gate — Ana",
    });
    expect(r.status).toBe("checked_in");
    if (r.status === "checked_in") expect(r.checkedInBy).toBe("Front gate — Ana");
  });

  it("undo puts a mis-scanned ticket back, and it admits again", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const { ticket } = await releasedTicketFor(shop.id, ev.id);

    await checkInTicketForShop(shop.id, ticket.code);
    expect(await undoCheckIn(shop.id, ticket.id)).toBe(true);

    const row = await db.query.tickets.findFirst({
      where: eq(tickets.id, ticket.id),
    });
    expect(row?.status).toBe("valid");
    expect(row?.usedAt).toBeNull();
    expect(row?.checkedInBy).toBeNull();

    expect((await checkInTicketForShop(shop.id, ticket.code)).status).toBe(
      "checked_in",
    );
    // Undoing a ticket nobody has used is not an error, it is a no-op.
    expect(await undoCheckIn(shop.id, ticket.id)).toBe(true);
    expect(await undoCheckIn(shop.id, ticket.id)).toBe(false);
  });

  it("a refunded order stops admitting people", async () => {
    /*
     * The bug this closes: money went back and the code kept working, so a
     * buyer could refund on the afternoon of the show and walk in that
     * evening. `voidTicketsForOrder` is what the refund and cancel paths call.
     */
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const { orderId, ticket } = await releasedTicketFor(shop.id, ev.id);

    expect(await voidTicketsForOrder(orderId)).toBe(1);
    expect((await checkInTicketForShop(shop.id, ticket.code)).status).toBe(
      "revoked",
    );

    // Un-cancelling gives it back, and it admits again.
    expect(await reinstateTicketsForOrder(orderId)).toBe(1);
    expect((await checkInTicketForShop(shop.id, ticket.code)).status).toBe(
      "checked_in",
    );
  });

  it("never rewrites the attendance record of an event that happened", async () => {
    // Voiding must not touch a ticket somebody already walked in on.
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const { orderId, ticket } = await releasedTicketFor(shop.id, ev.id);

    await checkInTicketForShop(shop.id, ticket.code);
    expect(await voidTicketsForOrder(orderId)).toBe(0);
    expect(
      (await db.query.tickets.findFirst({ where: eq(tickets.id, ticket.id) }))
        ?.status,
    ).toBe("used");
  });

  it("a comp has no order and admits on the seller's authority alone", async () => {
    /*
     * `order_id` is nullable since 0014 and EXISTS over a null is false, so
     * without the explicit `isNull` branch every comp would be refused at the
     * door for not being paid for — with no order to point the seller at.
     */
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);

    const [comp] = await issueTickets(shop.id, [
      {
        productId: ev.id,
        attendeeName: "Ada Okonkwo",
        attendeeEmail: "ada@example.com",
        source: "import",
      },
    ]);
    if (!comp) throw new Error("fixture: no comp was issued");
    expect(comp.orderId).toBeNull();

    const r = await checkInTicketForShop(shop.id, comp.code, {
      productId: ev.id,
    });
    expect(r.status).toBe("checked_in");
    if (r.status === "checked_in") expect(r.attendee).toBe("Ada Okonkwo");
  });

  it("re-running a guest list adds only what is new", async () => {
    /*
     * The normal way a seller uses this is to add twenty names to the
     * spreadsheet and upload the whole file again. Without the dedupe the
     * first forty guests get a second ticket each and the door list doubles.
     */
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, { title: "Rooftop Show" });
    const csv = [
      "Attendee Name,Attendee Email,Quantity",
      "Ada Okonkwo,ada@example.com,1",
      "Bo Lindqvist,bo@example.com,2",
    ].join("\n");

    const first = await importTickets({
      shopId: shop.id,
      csv,
      dryRun: false,
      defaultProductId: ev.id,
    });
    expect(first.created).toBe(3);

    const again = await importTickets({
      shopId: shop.id,
      csv,
      dryRun: false,
      defaultProductId: ev.id,
    });
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(2);

    // Bumping somebody from two to three writes exactly one more.
    const bumped = await importTickets({
      shopId: shop.id,
      csv: csv.replace("bo@example.com,2", "bo@example.com,3"),
      dryRun: false,
      defaultProductId: ev.id,
    });
    expect(bumped.updated).toBe(1);

    const stats = await eventDoorStats(shop.id, ev.id);
    expect(stats.issued).toBe(4);
    expect(stats.comped).toBe(4);
    expect(stats.checkedIn).toBe(0);
  });

  it("a dry run writes nothing", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const report = await importTickets({
      shopId: shop.id,
      csv: "Attendee Name\nAda Okonkwo",
      dryRun: true,
      defaultProductId: ev.id,
    });
    expect(report.created).toBe(1);
    expect((await eventDoorStats(shop.id, ev.id)).issued).toBe(0);
  });

  it("resolves the event by name when one file covers several", async () => {
    const shop = await makeShop();
    const rooftop = await makeEvent(shop.id, { title: "Rooftop Show" });
    const basement = await makeEvent(shop.id, { title: "Basement Set" });

    await importTickets({
      shopId: shop.id,
      csv: [
        "Event,Attendee Name",
        "Rooftop Show,Ada Okonkwo",
        "Basement Set,Bo Lindqvist",
        "Nowhere At All,Cy Mbeki",
      ].join("\n"),
      dryRun: false,
    });

    expect((await eventDoorStats(shop.id, rooftop.id)).issued).toBe(1);
    expect((await eventDoorStats(shop.id, basement.id)).issued).toBe(1);
  });

  it("finds a guest by the name on the list, not just by their code", async () => {
    // The dead-phone case, which is the entire reason the list exists.
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    await importTickets({
      shopId: shop.id,
      csv: "Attendee Name,Attendee Email\nAda Okonkwo,ada@example.com",
      dryRun: false,
      defaultProductId: ev.id,
    });

    const byName = await eventDoorList(shop.id, ev.id, { search: "okonkwo" });
    expect(byName.rows).toHaveLength(1);
    const found = byName.rows[0];
    if (!found) throw new Error("no row");
    expect(found.name).toBe("Ada Okonkwo");

    const byEmail = await eventDoorList(shop.id, ev.id, { search: "ada@" });
    expect(byEmail.rows).toHaveLength(1);

    // Admitting from the list goes through the same claim a scan does.
    expect(
      (await checkInTicketById(shop.id, found.id, { productId: ev.id })).status,
    ).toBe("checked_in");
    expect(
      (await checkInTicketById(shop.id, found.id, { productId: ev.id })).status,
    ).toBe("already_used");

    const stillOut = await eventDoorList(shop.id, ev.id, { status: "out" });
    expect(stillOut.rows).toHaveLength(0);
  });

  it("counts the room without mixing two audiences together", async () => {
    const shop = await makeShop();
    const rooftop = await makeEvent(shop.id, {
      trackInventory: true,
      stockQuantity: 10,
    });
    const basement = await makeEvent(shop.id);

    const { ticket } = await releasedTicketFor(shop.id, rooftop.id);
    await placedOrder(shop.id, basement.id, 2);
    await checkInTicketForShop(shop.id, ticket.code, { productId: rooftop.id });

    const stats = await eventDoorStats(shop.id, rooftop.id);
    expect(stats.issued).toBe(1);
    expect(stats.checkedIn).toBe(1);
    expect(stats.remaining).toBe(0);
    // Nine seats still for sale plus the one in hand.
    expect(stats.capacity).toBe(10);

    // An event that doesn't track inventory has no capacity to report, and
    // showing "0 of 0" for an uncapped door would read as sold out.
    expect((await eventDoorStats(shop.id, basement.id)).capacity).toBeNull();
  });
});
