import "server-only";
import { and, asc, eq, exists, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, products, tickets } from "@/db/schema";
import type { QuoteLine } from "@/lib/quote";

/**
 * Event tickets. One row per admission, minted with the order and gated by
 * the order's own release timestamp — see the note on the `tickets` table.
 */

/**
 * Crockford's base32: no I, L, O or U, so a code read aloud at a door or
 * typed from a phone photo can't be mistaken for another. Ten characters is
 * 50 bits — at a billion issued tickets, guessing one live code takes an
 * expected 2^20 tries against an endpoint that requires the seller's session.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newTicketCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let code = "";
  for (const b of bytes) code += ALPHABET[b % 32];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * What the door sees, however it was typed: lowercase, spaces, a missing or
 * misplaced dash, and the four lookalikes folded back to what was printed.
 */
export function normalizeTicketCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/I|L/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
  return cleaned.length === 10
    ? `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`
    : cleaned;
}

/**
 * The rows an order's event lines earn. Quantity fans out — three tickets is
 * three admissions — and it reads the lines, never the header: the header's
 * quantity describes the first line only, which is bug shape number four.
 */
export function ticketValues(
  lines: Pick<QuoteLine, "kind" | "productId" | "quantity">[],
  ids: { orderId: string; shopId: string },
) {
  return lines
    .filter((line) => line.kind === "event")
    .flatMap((line) =>
      Array.from({ length: Math.max(0, line.quantity) }, () => ({
        shopId: ids.shopId,
        orderId: ids.orderId,
        productId: line.productId,
        code: newTicketCode(),
      })),
    );
}

/** Every admission an order carries, oldest first, for the delivery page. */
export async function ticketsForOrder(orderId: string) {
  return getDb().query.tickets.findMany({
    where: eq(tickets.orderId, orderId),
    orderBy: [asc(tickets.createdAt), asc(tickets.code)],
  });
}

/**
 * The door. One code comes in; exactly one of these goes back out, and
 * `checked_in` can happen once per ticket for all time.
 */
export type CheckInState =
  | { status: "idle" }
  | {
      status: "checked_in" | "already_used";
      code: string;
      buyer: string | null;
      productTitle: string | null;
      eventStartsAt: Date | null;
      usedAt: Date | null;
    }
  | { status: "not_released"; code: string }
  | { status: "not_found"; code: string };

export async function checkInTicketForShop(
  shopId: string,
  rawCode: string,
): Promise<CheckInState> {
  const db = getDb();

  const code = normalizeTicketCode(rawCode);
  if (!code) return { status: "not_found", code: "" };

  /*
   * The decision lives in the WHERE, not in a read before it. Two staff
   * phones scanning the same ticket in the same second race here, and the
   * row lock decides: one gets the row back and the green screen, the other
   * falls through to the reads below and is told when the first one was.
   *
   * Validity also requires the order to be released — the same timestamp
   * that opens a digital order's files. An unpaid ticket is not a ticket.
   */
  const released = exists(
    db
      .select({ one: sql`1` })
      .from(orders)
      .where(
        and(eq(orders.id, tickets.orderId), isNotNull(orders.downloadReleasedAt)),
      ),
  );

  const [claimed] = await db
    .update(tickets)
    .set({ status: "used", usedAt: new Date() })
    .where(
      and(
        eq(tickets.code, code),
        eq(tickets.shopId, shopId),
        eq(tickets.status, "valid"),
        released,
      ),
    )
    .returning();

  const ticket =
    claimed ??
    (await db.query.tickets.findFirst({
      where: and(eq(tickets.code, code), eq(tickets.shopId, shopId)),
    }));
  if (!ticket) return { status: "not_found", code };

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, ticket.orderId),
    columns: { customerName: true, downloadReleasedAt: true },
  });
  const product = ticket.productId
    ? await db.query.products.findFirst({
        where: eq(products.id, ticket.productId),
        columns: { title: true, eventStartsAt: true },
      })
    : null;

  if (!claimed && !order?.downloadReleasedAt) {
    return { status: "not_released", code };
  }

  return {
    status: claimed ? "checked_in" : "already_used",
    code,
    buyer: order?.customerName ?? null,
    productTitle: product?.title ?? null,
    eventStartsAt: product?.eventStartsAt ?? null,
    usedAt: ticket.usedAt,
  };
}

/** True when ticket sales for this event are still open. */
export function eventSalesOpen(
  product: { kind: string; eventStartsAt: Date | null },
  now = new Date(),
): boolean {
  if (product.kind !== "event") return true;
  // No start time recorded means nothing to close on — the product form
  // requires one, but a row written by an older build must stay sellable.
  if (!product.eventStartsAt) return true;
  return product.eventStartsAt > now;
}
