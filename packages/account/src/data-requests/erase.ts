import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, orders, subscriptions, tickets } from "@sailo/db/schema";
import { ERASURE_RULES, erasureRuleFor } from "@sailo/core/privacy";

/**
 * Erasure, which is mostly refusal reasoning.
 *
 * The decision table is `@sailo/core/privacy` and it is the spec; this is the
 * half that touches rows. Two rules govern everything below, and both come
 * straight from spec 03, which decided them for sellers first:
 *
 * **Pseudonymise, do not delete, anything a money row points at.** Replace the
 * identifiers and keep the row. The alternative breaks the ledger and the
 * invoice sequence, which a tax authority expects unbroken — spec 03 kept the
 * seller's ledger for exactly this reason and the buyer's side cannot decide
 * differently.
 *
 * **The suppression list is never touched.** Not by this function, not by any
 * function. Erasing an unsubscribe re-subscribes the person who asked to be left
 * alone: it is the one "deletion" that does the opposite of what was asked, and
 * the response says so rather than quietly doing the right thing.
 *
 * ## The surrogate
 *
 * `Deleted buyer` and `erased-<client id>@sailo.invalid`, mirroring
 * `tombstoneEmail` on the seller side. Stable, so the ledger keeps joining, and
 * unroutable, so nothing can ever mail it. Derived from the row's own id rather
 * than random, so a retried erasure produces the same surrogate and the second
 * run is a no-op instead of a second identity.
 */

export const ERASED_NAME = "Deleted buyer";

/** Stable and unroutable. `.invalid` is reserved by RFC 2606 for exactly this. */
export function erasedEmail(clientId: string): string {
  return `erased-${clientId}@sailo.invalid`;
}

export type ErasureReport = {
  /** Client rows pseudonymised. Zero when the buyer never got a client row. */
  clients: number;
  /** Orders whose buyer identifiers were replaced. */
  orders: number;
  /** Tickets whose attendee name and address were replaced. */
  tickets: number;
  /** Memberships left in place, counted so the reply can say so. */
  memberships: number;
  /** Suppression rows deliberately untouched — see the header. */
  suppressionsKept: number;
  /**
   * Whether a dispute window is still open on any order, which is what holds
   * `buyerIp`, `buyerUserAgent`, `buyerDeviceFingerprint` and the download log.
   */
  identifiersHeldForDisputes: boolean;
};

/**
 * How long a purchase identifier is held before it too is erased.
 *
 * The same 400 days `EVIDENCE_RETENTION_DAYS` names in
 * `@sailo/core/disputes`, and named again here rather than imported because the
 * two are the same number for the same reason but are separately load-bearing:
 * a change to the evidence window is a change to what this promise means, and a
 * silent import would let one move without the other being reconsidered.
 */
export const DISPUTE_WINDOW_DAYS = 400;

/**
 * Run the erasure for one buyer in one shop.
 *
 * Shop-scoped in every statement. Idempotent: running it twice writes the same
 * surrogate and reports the same counts, because the surrogate is derived from
 * the row's own id and the WHERE clauses no longer match once it is written.
 */
export async function eraseSubject(
  shopId: string,
  email: string,
  now = new Date(),
): Promise<ErasureReport> {
  const db = getDb();
  const address = email.trim().toLowerCase();

  /* ── The customer record: pseudonymised, never deleted ─────────────────── */

  const clientRows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.shopId, shopId), sql`lower(${clients.email}) = ${address}`));

  for (const row of clientRows) {
    await db
      .update(clients)
      .set({
        name: ERASED_NAME,
        email: erasedEmail(row.id),
        phone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        region: null,
        postalCode: null,
        country: null,
        notes: null,
        // Consent and list membership go outright: they are not a money row and
        // nothing points at them.
        marketingConsentAt: null,
        tags: [],
        updatedAt: now,
      })
      .where(eq(clients.id, row.id));
  }

  /* ── The orders: the header's copy of the buyer, replaced in place ─────── */

  const orderRows = await db
    .select({ id: orders.id, clientId: orders.clientId, createdAt: orders.createdAt })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), sql`lower(${orders.customerEmail}) = ${address}`));

  /*
   * Whether a card network can still reverse any of these.
   *
   * Decided before the write, because the write is what makes the question
   * unanswerable afterwards. Where the window is open the purchase identifiers
   * stay and the reply says which and for how long; where it has closed they go
   * with everything else.
   */
  const cutoff = new Date(now.getTime() - DISPUTE_WINDOW_DAYS * 86_400_000);
  const identifiersHeldForDisputes = orderRows.some((row) => row.createdAt > cutoff);

  for (const row of orderRows) {
    await db
      .update(orders)
      .set({
        customerName: ERASED_NAME,
        customerEmail: row.clientId ? erasedEmail(row.clientId) : `erased-${row.id}@sailo.invalid`,
        customerPhone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        region: null,
        postalCode: null,
        /*
         * `country` stays. It is on the order because it decides the tax rate
         * and the delivery zone that were actually charged, so removing it
         * changes what the invoice says was owed — and a country on its own
         * identifies nobody.
         */
        note: null,
        ...(identifiersHeldForDisputes
          ? {}
          : {
              /*
               * Only once no bank can still ask. These four are the evidence a
               * chargeback is answered with, and erasing them while a case can
               * still arrive would disarm the seller over an order the buyer
               * themselves placed — spec 52's own table says "retain while a
               * dispute window is open; erase after", and this is after.
               */
              buyerIp: null,
              buyerUserAgent: null,
              buyerDeviceFingerprint: null,
            }),
        updatedAt: now,
      })
      .where(eq(orders.id, row.id));
  }

  /* ── Tickets: the attendee's own name, which is not the buyer's ────────── */

  const orderIds = orderRows.map((row) => row.id);
  const ticketRows = orderIds.length
    ? await db
        .update(tickets)
        .set({ attendeeName: null, attendeeEmail: null })
        .where(inArray(tickets.orderId, orderIds))
        .returning({ id: tickets.id })
    : [];

  /* ── Memberships: kept, and counted so the reply can say they were ─────── */

  const memberships = clientRows.length
    ? await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.shopId, shopId),
            inArray(
              subscriptions.clientId,
              clientRows.map((row) => row.id),
            ),
          ),
        )
    : [];

  /* ── The suppression list, deliberately not touched ────────────────────── */

  /*
   * Counted and left. There is no branch here that could ever delete one, which
   * is the point: the protection is the absence of the statement rather than a
   * flag somebody can pass. `countSuppressions` reads.
   */
  const suppressionsKept = await countSuppressions(shopId, address);

  return {
    clients: clientRows.length,
    orders: orderRows.length,
    tickets: ticketRows.length,
    memberships: memberships.length,
    suppressionsKept,
    identifiersHeldForDisputes,
  };
}

async function countSuppressions(shopId: string, address: string): Promise<number> {
  const { emailSuppressions } = await import("@sailo/db/schema");
  const rows = await getDb()
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.shopId, shopId),
        sql`lower(${emailSuppressions.email}) = ${address}`,
      ),
    );
  return rows.length;
}

/**
 * What the buyer is told, assembled from the decision table.
 *
 * Every category, in the table's order, with the verdict and the reason. Not a
 * summary a seller writes: "a refusal is an answer", and an answer has to name
 * which data, why, and for how long — which is exactly what each rule carries.
 */
export function erasureStatement(report: ErasureReport): string {
  const lines: string[] = ["What was erased, and what was not:", ""];

  for (const rule of ERASURE_RULES) {
    const verdict = erasureRuleFor(rule.category).verdict;
    const mark =
      verdict === "erase" || verdict === "pseudonymise"
        ? "Removed"
        : verdict === "already_anonymous"
          ? "Nothing held"
          : "Kept";
    lines.push(`${mark}: ${rule.reason}`);
  }

  if (report.identifiersHeldForDisputes) {
    lines.push(
      "",
      `Because at least one of your orders is recent enough that a bank could still reverse the payment, the address and browser recorded at checkout are held for up to ${DISPUTE_WINDOW_DAYS} days from the order, then erased.`,
    );
  }

  return lines.join("\n");
}
