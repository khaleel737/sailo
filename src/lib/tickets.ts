import "server-only";
import { and, asc, eq, exists, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, products, tickets, type Ticket } from "@/db/schema";
import { variantLabel } from "@/lib/variants";
import type { QuoteLine } from "@/lib/quote";

/**
 * Event tickets. One row per admission, minted with the order and gated by
 * the order's own release timestamp — see the note on the `tickets` table.
 *
 * Since 0014 a ticket may have no order at all: a comp, a walk-up or a row
 * from an imported guest list is issued by the seller directly, which is a
 * stronger claim than a settled payment. Every query that decides validity
 * has to say so explicitly, because EXISTS over a null `order_id` is false
 * and would otherwise refuse a comp at the door for not being paid for.
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
 *
 * It also accepts a whole URL. Every ticket issued before the in-app scanner
 * existed carries a QR encoding `/admin/checkin?code=…` rather than the bare
 * code — those are sitting in buyers' inboxes and will keep arriving at doors
 * for as long as the events they belong to are in the future. The scanner
 * hands whatever it decoded straight to this function, so both shapes read
 * the same and no ticket is ever invalidated by us changing our minds.
 */
export function normalizeTicketCode(raw: string): string {
  let text = raw.trim();

  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).searchParams.get("code") ?? "";
    } catch {
      // A malformed URL is not a code. Fall through and let it normalize to
      // whatever it normalizes to, which will not match a row.
    }
  }

  const cleaned = text
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
 *
 * The tier is written down rather than joined. A variant renamed between the
 * on-sale and the night, or deleted after it, must not change what prints
 * beside a name on the door list.
 */
export function ticketValues(
  lines: Pick<
    QuoteLine,
    "kind" | "productId" | "quantity" | "variantOptions" | "options"
  >[],
  ids: { orderId: string; shopId: string },
) {
  return lines
    .filter((line) => line.kind === "event")
    .flatMap((line) => {
      const tier = line.variantOptions
        ? variantLabel(line.variantOptions, line.options)
        : null;
      return Array.from({ length: Math.max(0, line.quantity) }, () => ({
        shopId: ids.shopId,
        orderId: ids.orderId,
        productId: line.productId,
        code: newTicketCode(),
        tier,
        source: "order",
      }));
    });
}

/** Every admission an order carries, oldest first, for the delivery page. */
export async function ticketsForOrder(orderId: string) {
  return getDb().query.tickets.findMany({
    where: eq(tickets.orderId, orderId),
    orderBy: [asc(tickets.createdAt), asc(tickets.code)],
  });
}

/* -------------------------------------------------------------------------- */
/*  Issuing outside a sale                                                     */
/* -------------------------------------------------------------------------- */

export type TicketDraft = {
  productId: string;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  tier?: string | null;
  note?: string | null;
  /** import for a guest list, manual for somebody minted at the door. */
  source: "import" | "manual";
};

/**
 * Writes tickets that no order paid for, and survives the one failure mode a
 * batch insert of random codes has.
 *
 * `code` is globally unique, so a collision is a constraint violation that
 * takes the whole statement — and with it an entire two-hundred-row guest
 * list — down with it. At 50 bits the odds are remote, and "remote" is not
 * "never" across every shop and every re-run of an import.
 * `onConflictDoNothing` drops only the colliding rows, and the shortfall is
 * re-minted with fresh codes rather than reported as a failure the seller
 * cannot act on.
 */
export async function issueTickets(
  shopId: string,
  drafts: TicketDraft[],
): Promise<Ticket[]> {
  if (drafts.length === 0) return [];
  const db = getDb();

  const written: Ticket[] = [];
  let pending = drafts;

  for (let attempt = 0; attempt < 3 && pending.length > 0; attempt++) {
    const rows = await db
      .insert(tickets)
      .values(
        pending.map((draft) => ({
          shopId,
          orderId: null,
          productId: draft.productId,
          code: newTicketCode(),
          tier: draft.tier ?? null,
          attendeeName: draft.attendeeName ?? null,
          attendeeEmail: draft.attendeeEmail ?? null,
          note: draft.note ?? null,
          source: draft.source,
        })),
      )
      .onConflictDoNothing({ target: tickets.code })
      .returning();

    written.push(...rows);
    // Which drafts missed is not knowable from the returned rows — they carry
    // no back-reference — so the shortfall is taken from the tail. The drafts
    // are interchangeable by here, so which ones retry does not matter.
    pending = pending.slice(rows.length);
  }

  return written;
}

/* -------------------------------------------------------------------------- */
/*  The door                                                                   */
/* -------------------------------------------------------------------------- */

export type AdmittedTicket = {
  ticketId: string;
  code: string;
  /** Who this admission is for: the attendee's own name, else the buyer's. */
  attendee: string | null;
  buyer: string | null;
  tier: string | null;
  productTitle: string | null;
  eventStartsAt: Date | null;
  usedAt: Date | null;
  checkedInBy: string | null;
};

/**
 * One code comes in; exactly one of these goes back out, and `checked_in` can
 * happen once per ticket until somebody undoes it.
 */
export type CheckInState =
  | { status: "idle" }
  | ({ status: "checked_in" | "already_used" } & AdmittedTicket)
  /** A real ticket, but for something else happening in the same shop. */
  | { status: "wrong_event"; code: string; productTitle: string | null }
  | { status: "revoked"; code: string }
  | { status: "not_released"; code: string }
  | { status: "not_found"; code: string };

/**
 * Validity, as one expression: the order is released, or nobody sold this.
 *
 * Written as a function because more than one statement needs it, and a rule
 * copied into three WHERE clauses is a rule that will be true in two of them.
 */
function releasedOrIssued() {
  const db = getDb();
  return or(
    isNull(tickets.orderId),
    exists(
      db
        .select({ one: sql`1` })
        .from(orders)
        .where(
          and(
            eq(orders.id, tickets.orderId),
            isNotNull(orders.downloadReleasedAt),
          ),
        ),
    ),
  );
}

/** Fills in the names a door screen shows beside a decision. */
async function describe(ticket: Ticket): Promise<AdmittedTicket> {
  const db = getDb();

  const [order, product] = await Promise.all([
    ticket.orderId
      ? db.query.orders.findFirst({
          where: eq(orders.id, ticket.orderId),
          columns: { customerName: true },
        })
      : null,
    ticket.productId
      ? db.query.products.findFirst({
          where: eq(products.id, ticket.productId),
          columns: { title: true, eventStartsAt: true },
        })
      : null,
  ]);

  return {
    ticketId: ticket.id,
    code: ticket.code,
    attendee: ticket.attendeeName ?? order?.customerName ?? null,
    buyer: order?.customerName ?? null,
    tier: ticket.tier,
    productTitle: product?.title ?? null,
    eventStartsAt: product?.eventStartsAt ?? null,
    usedAt: ticket.usedAt,
    checkedInBy: ticket.checkedInBy,
  };
}

export type CheckInOptions = {
  /** Scope the door to one event; anything else is `wrong_event`. */
  productId?: string | null;
  /** The door pass that scanned, recorded on the row. Null is the owner. */
  by?: string | null;
};

export async function checkInTicketForShop(
  shopId: string,
  rawCode: string,
  options: CheckInOptions = {},
): Promise<CheckInState> {
  const code = normalizeTicketCode(rawCode);
  if (!code) return { status: "not_found", code: "" };

  return claim(
    and(eq(tickets.code, code), eq(tickets.shopId, shopId)),
    code,
    options,
  );
}

/**
 * The same decision reached by tapping a name instead of scanning a code.
 *
 * A guest whose phone is dead is the case the door list exists for, and it
 * must go through the identical claim rather than a read-then-write beside
 * it — two volunteers, one on the list and one on the scanner, race exactly
 * as two scanners do.
 */
export async function checkInTicketById(
  shopId: string,
  ticketId: string,
  options: CheckInOptions = {},
): Promise<CheckInState> {
  return claim(
    and(eq(tickets.id, ticketId), eq(tickets.shopId, shopId)),
    "",
    options,
  );
}

/**
 * The claim itself.
 *
 * The decision lives in the WHERE, not in a read before it. Two staff phones
 * scanning the same ticket in the same second race here, and the row lock
 * decides: one gets the row back and the green screen, the other falls
 * through to the reads below and is told when the first one was, and by whom.
 */
async function claim(
  identity: ReturnType<typeof and>,
  fallbackCode: string,
  options: CheckInOptions,
): Promise<CheckInState> {
  const db = getDb();
  const scope = options.productId
    ? eq(tickets.productId, options.productId)
    : undefined;

  const [claimed] = await db
    .update(tickets)
    .set({
      status: "used",
      usedAt: new Date(),
      checkedInBy: options.by ?? null,
    })
    .where(and(identity, eq(tickets.status, "valid"), releasedOrIssued(), scope))
    .returning();

  if (claimed) {
    return { status: "checked_in", ...(await describe(claimed)) };
  }

  // Nothing was claimed, so the answer is one of five reasons. Read the row
  // *without* the event scope: a ticket for the wrong room has to be named as
  // that rather than reported as unknown, or the volunteer turns away a guest
  // who is standing outside the right building.
  const ticket = await db.query.tickets.findFirst({ where: identity });
  if (!ticket) return { status: "not_found", code: fallbackCode };

  const code = ticket.code;

  if (options.productId && ticket.productId !== options.productId) {
    const product = ticket.productId
      ? await db.query.products.findFirst({
          where: eq(products.id, ticket.productId),
          columns: { title: true },
        })
      : null;
    return { status: "wrong_event", code, productTitle: product?.title ?? null };
  }

  if (ticket.status === "void") return { status: "revoked", code };

  if (ticket.orderId) {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, ticket.orderId),
      columns: { downloadReleasedAt: true },
    });
    if (!order?.downloadReleasedAt) return { status: "not_released", code };
  }

  return { status: "already_used", ...(await describe(ticket)) };
}

/**
 * Puts a ticket back, because the alternative is turning away the person it
 * belongs to.
 *
 * A mis-scan — the wrong code typed, a QR read twice through a phone case,
 * the volunteer's thumb — burns a real admission, and without this the guest
 * standing there has no ticket and no recourse. Atomic for the same reason
 * the claim is: two people fixing one mistake must not double-undo a ticket
 * that has since been legitimately re-scanned.
 */
export async function undoCheckIn(
  shopId: string,
  ticketId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .update(tickets)
    .set({ status: "valid", usedAt: null, checkedInBy: null })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.shopId, shopId),
        eq(tickets.status, "used"),
      ),
    )
    .returning({ id: tickets.id });
  return Boolean(row);
}

/** Revokes a ticket, or puts a revoked one back. Never resurrects a used one. */
export async function setTicketRevoked(
  shopId: string,
  ticketId: string,
  revoked: boolean,
): Promise<boolean> {
  const [row] = await getDb()
    .update(tickets)
    .set({ status: revoked ? "void" : "valid" })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.shopId, shopId),
        eq(tickets.status, revoked ? "valid" : "void"),
      ),
    )
    .returning({ id: tickets.id });
  return Boolean(row);
}

/**
 * A refunded or cancelled order stops admitting people.
 *
 * This did not exist, and its absence was not a missing feature: the money
 * went back and the ticket stayed valid, so a buyer could refund a fifty-
 * pound ticket on the afternoon of the show and walk in on it that evening.
 * Only `valid` rows are touched — voiding a ticket somebody already used
 * would rewrite the attendance record of an event that has happened.
 */
export async function voidTicketsForOrder(orderId: string): Promise<number> {
  const rows = await getDb()
    .update(tickets)
    .set({ status: "void" })
    .where(and(eq(tickets.orderId, orderId), eq(tickets.status, "valid")))
    .returning({ id: tickets.id });
  return rows.length;
}

/**
 * The other direction, for a seller un-cancelling an order.
 *
 * Follows the stock rule in `order-admin`: cancelling is reversible because
 * the goods never left, refunding is not. Only `void` rows come back, so a
 * ticket already used stays used and the attendance record is not rewritten
 * by a dropdown.
 */
export async function reinstateTicketsForOrder(
  orderId: string,
): Promise<number> {
  const rows = await getDb()
    .update(tickets)
    .set({ status: "valid" })
    .where(and(eq(tickets.orderId, orderId), eq(tickets.status, "void")))
    .returning({ id: tickets.id });
  return rows.length;
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
