import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  orderItems,
  orders,
  shipmentItems,
  shipments,
  type Order,
  type Shipment,
} from "@sailo/db/schema";
import { needsDelivery } from "@sailo/core/variants";

/**
 * A three-item order going out in two boxes — spec 51.
 *
 * `orders.trackingCarrier` / `trackingNumber` / `shippedAt` are on the order
 * *header*, so an order shipping in parts could record one tracking number and
 * the buyer chasing the second parcel was told about the first. That is the
 * header-versus-lines shape this repo names as recurring, and this is the fifth
 * place it has turned up.
 *
 * THE HEADER COLUMNS STAY, POPULATED FROM THE FIRST SHIPMENT
 *
 * The decision spec 51 asks to be written down, taken this way rather than by
 * migrating every reader in one pass. They are read by the buyer's tracking
 * email, the CSV export, the API and webhook resource shapes, the HQ order
 * panel, the evidence pack and a dozen tests; a half-migration is precisely the
 * defect the spec warns about, and a full one is a change to six surfaces to
 * serve a feature that can be correct without it. So: one denormalised copy,
 * written once from the first shipment, never rewritten. Anything that wants
 * the whole picture reads `shipments`.
 *
 * NO NEW ORDER STATUS
 *
 * `shipped` when the first box goes, `completed` when every line is covered.
 * Spec 44 declined to add `delivered` for the same reason, and the header of
 * `ORDER_STATUSES` records what happened the last time a copy of that enum
 * drifted across three surfaces.
 */

/* -------------------------------------------------------------------------- */
/*  Coverage                                                                   */
/* -------------------------------------------------------------------------- */

/** One order line, and how much of it has already left. */
export type LineCoverage = {
  orderItemId: string;
  title: string;
  variantLabel: string | null;
  kind: string;
  ordered: number;
  shipped: number;
  /** What may still go in a box. Never negative. */
  remaining: number;
};

/**
 * How much of each line has shipped.
 *
 * Only the lines that *travel*. A basket holding a mug and a PDF is fully
 * shipped when the mug is: waiting for a download to be put in a box would
 * leave the order permanently short of `completed`, and the seller with a list
 * that never empties. `needsDelivery` is the same predicate the checkout uses
 * to decide whether to charge postage at all, so the two cannot disagree about
 * what travels.
 */
export function coverageOf(
  lines: readonly {
    id: string;
    title: string;
    variantLabel: string | null;
    kind: string;
    quantity: number;
  }[],
  shipped: ReadonlyMap<string, number>,
): LineCoverage[] {
  return lines
    .filter((line) => needsDelivery(line.kind))
    .map((line) => {
      const out = shipped.get(line.id) ?? 0;
      return {
        orderItemId: line.id,
        title: line.title,
        variantLabel: line.variantLabel,
        kind: line.kind,
        ordered: line.quantity,
        shipped: out,
        remaining: Math.max(0, line.quantity - out),
      };
    });
}

/**
 * Whether everything that travels has left.
 *
 * **False for an order with nothing to ship**, which is not the same as "fully
 * shipped" and must not be: a download-only order is `completed` by being paid
 * for, not by a fulfilment step it never had. Answering true here would let a
 * shipment write `completed` onto an order that had no boxes in it.
 */
export function fullyShipped(coverage: readonly LineCoverage[]): boolean {
  return coverage.length > 0 && coverage.every((line) => line.remaining === 0);
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                    */
/* -------------------------------------------------------------------------- */

export type OrderShipments = {
  shipments: (Shipment & { items: { orderItemId: string; quantity: number }[] })[];
  coverage: LineCoverage[];
  complete: boolean;
};

export async function shipmentsForOrder(orderId: string): Promise<OrderShipments> {
  const db = getDb();

  const [rows, lines] = await Promise.all([
    db.query.shipments.findMany({
      where: eq(shipments.orderId, orderId),
      orderBy: [asc(shipments.shippedAt)],
    }),
    db.query.orderItems.findMany({
      where: eq(orderItems.orderId, orderId),
      orderBy: [asc(orderItems.position)],
      columns: {
        id: true,
        title: true,
        variantLabel: true,
        kind: true,
        quantity: true,
      },
    }),
  ]);

  const contents = rows.length
    ? await db.query.shipmentItems.findMany({
        where: inArray(
          shipmentItems.shipmentId,
          rows.map((r) => r.id),
        ),
      })
    : [];

  const byShipment = new Map<string, { orderItemId: string; quantity: number }[]>();
  const shippedPerLine = new Map<string, number>();
  for (const item of contents) {
    const list = byShipment.get(item.shipmentId) ?? [];
    list.push({ orderItemId: item.orderItemId, quantity: item.quantity });
    byShipment.set(item.shipmentId, list);
    shippedPerLine.set(
      item.orderItemId,
      (shippedPerLine.get(item.orderItemId) ?? 0) + item.quantity,
    );
  }

  const coverage = coverageOf(lines, shippedPerLine);

  return {
    shipments: rows.map((row) => ({ ...row, items: byShipment.get(row.id) ?? [] })),
    coverage,
    complete: fullyShipped(coverage),
  };
}

/* -------------------------------------------------------------------------- */
/*  Writing                                                                    */
/* -------------------------------------------------------------------------- */

export type RecordShipmentResult =
  | { ok: true; shipment: Shipment; complete: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "nothing_to_ship" }
  | { ok: false; reason: "bad_tracking_url" }
  /** More of a line than the order holds, across every shipment it has. */
  | { ok: false; reason: "over_shipped"; title: string; remaining: number };

/**
 * Records one box.
 *
 * WHY THE CEILING IS RE-READ INSIDE THIS FUNCTION AND NOT TRUSTED FROM THE FORM
 *
 * The seller's screen shows what is left per line and pre-fills it, and that
 * screen is a snapshot: two tabs open on one order, or a double-submitted form,
 * would each pass a quantity that was correct when it was rendered. Coverage
 * decides whether an order is `completed`, so an over-ship marks a half-shipped
 * order finished — and the buyer stops being chased for a parcel that never
 * went. The check reads the shipments as they stand now, and the composite
 * primary key on `shipment_items` is the second lock underneath it: one line
 * cannot appear twice in one shipment, so the same submission twice adds
 * nothing rather than shipping the same three mugs again.
 *
 * `db.batch` for the header and its items, which on this driver is a single
 * non-interactive transaction — the same reason `createOrderIntent` mints its
 * own order id. A shipment row with no items would read as an empty box and
 * count towards nothing, which is worse than no row at all.
 */
export async function recordShipment(input: {
  shopId: string;
  orderId: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  /** Accepted with or without a scheme; parsed here, refused if unusable. */
  trackingUrl?: string | null;
  note?: string | null;
  /** What went in the box: order line id → how many. */
  items: { orderItemId: string; quantity: number }[];
}): Promise<RecordShipmentResult> {
  const db = getDb();

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)),
  });
  if (!order) return { ok: false, reason: "not_found" };

  /*
   * The same parse `shipOrder` does, and refused rather than stored for the
   * same reason: sellers paste `dhl.com/track?id=…` as often as a full URL, and
   * the only place this is ever used is a button in the buyer's email.
   */
  const raw = input.trackingUrl?.trim().slice(0, 500) ?? "";
  let trackingUrl: string | null = null;
  if (raw) {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      trackingUrl = new URL(candidate).toString();
    } catch {
      return { ok: false, reason: "bad_tracking_url" };
    }
  }

  const wanted = input.items
    .map((item) => ({
      orderItemId: item.orderItemId,
      quantity: Math.trunc(item.quantity),
    }))
    .filter((item) => item.quantity > 0);
  if (wanted.length === 0) return { ok: false, reason: "nothing_to_ship" };

  const state = await shipmentsForOrder(order.id);
  const byLine = new Map(state.coverage.map((line) => [line.orderItemId, line]));

  for (const item of wanted) {
    const line = byLine.get(item.orderItemId);
    // A line that is not on this order, or does not travel, is not shippable.
    if (!line) return { ok: false, reason: "not_found" };
    if (item.quantity > line.remaining) {
      return {
        ok: false,
        reason: "over_shipped",
        title: line.title,
        remaining: line.remaining,
      };
    }
  }

  const shipmentId = crypto.randomUUID();
  const shippedAt = new Date();

  await db.batch([
    db.insert(shipments).values({
      id: shipmentId,
      orderId: order.id,
      shopId: input.shopId,
      carrier: input.carrier?.trim().slice(0, 80) || null,
      trackingNumber: input.trackingNumber?.trim().slice(0, 120) || null,
      trackingUrl,
      note: input.note?.trim().slice(0, 500) || null,
      shippedAt,
    }),
    db.insert(shipmentItems).values(
      wanted.map((item) => ({
        shipmentId,
        orderItemId: item.orderItemId,
        quantity: item.quantity,
      })),
    ),
  ]);

  const after = await shipmentsForOrder(order.id);
  const complete = after.complete;

  /*
   * The header columns, and the order's status.
   *
   * `coalesce` on all four is what makes them the *first* shipment's rather
   * than the latest one's: a second box must not overwrite the tracking number
   * the buyer was already emailed, or their link stops resolving to the parcel
   * they were chasing. Expressed in SQL rather than by branching on the row we
   * read a moment ago, so two boxes recorded in the same second still leave one
   * of them as the first.
   *
   * `completed` only when every travelling line is covered, and `shipped`
   * otherwise. Both go through the same statement as the header copy, so an
   * order can never read `completed` with a tracking number that is not there.
   */
  await db
    .update(orders)
    .set({
      trackingCarrier: sql`coalesce(${orders.trackingCarrier}, ${input.carrier?.trim().slice(0, 80) || null})`,
      trackingNumber: sql`coalesce(${orders.trackingNumber}, ${input.trackingNumber?.trim().slice(0, 120) || null})`,
      trackingUrl: sql`coalesce(${orders.trackingUrl}, ${trackingUrl})`,
      shippedAt: sql`coalesce(${orders.shippedAt}, ${shippedAt})`,
      status: complete ? "completed" : "shipped",
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, order.id), eq(orders.shopId, input.shopId)));

  const written = await db.query.shipments.findFirst({
    where: eq(shipments.id, shipmentId),
  });
  if (!written) return { ok: false, reason: "not_found" };

  return { ok: true, shipment: written, complete };
}

/**
 * A box arrived, and who says so.
 *
 * `shipped` is not `delivered`, and `docs/chargebacks.md` says so in as many
 * words. The source is what separates evidence from an assertion: a carrier
 * scan and a seller ticking a box answer an issuer very differently, and spec
 * 45's fulfilment document prints which one it has.
 *
 * Claimed rather than set, so a carrier webhook and a seller clicking in the
 * same minute record one arrival at one time — and the *earlier* claim wins,
 * because the parcel arrived when it arrived.
 *
 * The order's own `delivered_at` (spec 44) is filled from the **last** box to
 * land, not the first: an order is delivered when all of it is. Half-delivered
 * is a real posture and `shipments` is where it can be read.
 */
export async function markShipmentDelivered(input: {
  shopId: string;
  shipmentId: string;
  source: "seller" | "carrier" | "buyer";
  at?: Date;
}): Promise<boolean> {
  const db = getDb();
  const at = input.at ?? new Date();

  const [claimed] = await db
    .update(shipments)
    .set({ deliveredAt: at, deliveredSource: input.source })
    .where(
      and(
        eq(shipments.id, input.shipmentId),
        eq(shipments.shopId, input.shopId),
        sql`${shipments.deliveredAt} is null`,
      ),
    )
    .returning({ id: shipments.id, orderId: shipments.orderId });
  if (!claimed) return false;

  /*
   * The order is delivered when its last box is.
   *
   * Written from the maximum of the shipments' own timestamps rather than from
   * `at`, so the order's date is the one an issuer can check against a carrier
   * — and left alone entirely while any box is still out, because "delivered"
   * on a half-delivered order is the claim spec 44 exists to stop us making.
   */
  await db
    .update(orders)
    .set({
      deliveredAt: sql`(
        select max(${shipments.deliveredAt}) from ${shipments}
        where ${shipments.orderId} = ${claimed.orderId}
      )`,
      deliveredSource: input.source,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, claimed.orderId),
        sql`not exists (
          select 1 from ${shipments}
          where ${shipments.orderId} = ${claimed.orderId}
            and ${shipments.deliveredAt} is null
        )`,
      ),
    );

  return true;
}

/** Whether this order has anything that travels at all. */
export function orderTravels(order: Pick<Order, "productKind">): boolean {
  return needsDelivery(order.productKind);
}
