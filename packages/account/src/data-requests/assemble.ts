import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  downloadEvents,
  emailSuppressions,
  invoices,
  orderItems,
  orderMessages,
  orders,
  shops,
  subscriptions,
  tickets,
} from "@sailo/db/schema";
import { escapeField, toCsv } from "@sailo/core/csv";

/**
 * Everything one shop holds about one buyer, gathered for a subject access or
 * portability request.
 *
 * ─── THE BOUNDARY THAT IS A HARD ACCESS-CONTROL TEST ────────────────────────
 * **Scoped to one shop, always.** A buyer of five Sailo shops asking one seller
 * receives that seller's data and nothing else. This is the same line
 * `GAP-2026-08-easytools.md` §4.2 refuses to cross for the cross-seller buyer
 * network, and here it is not a product decision but an access-control one:
 * every query below carries `shopId` in its WHERE, and the shop id comes from
 * the request row rather than from anything a caller passes alongside it.
 *
 * ─── AND THE ORDER OF OPERATIONS ────────────────────────────────────────────
 * Nothing here may run before `verified_at` is set. Assembling somebody's order
 * history and *then* checking who asked is how a data-protection feature becomes
 * a breach — the caller enforces it, and `assembleSubjectData` is deliberately
 * not exported from a path that could be reached without going through it.
 */

/** Formula-escaped on every column: a buyer's own name is attacker input. */
function csv(headers: string[], rows: unknown[][]): string {
  return toCsv(headers, rows);
}

export type SubjectExport = {
  /** The machine-readable copy — everything, one object. */
  json: string;
  /** The readable copies, for the tables a person can actually read. */
  files: { name: string; body: string }[];
  /** Counts, for the seller's confirmation and the audit line. */
  summary: { orders: number; messages: number; downloads: number; tickets: number };
};

/**
 * Assemble it.
 *
 * `email` is the key because Sailo's buyers hold no accounts — a storefront
 * takes an order from a stranger — so the address they gave at checkout is the
 * only durable identifier there is. That is also why the match is exact and
 * lowercased rather than fuzzy: a net wide enough to catch "the same person with
 * a different address" is a net that hands one person another's order history.
 */
export async function assembleSubjectData(
  shopId: string,
  email: string,
): Promise<SubjectExport> {
  const db = getDb();
  const address = email.trim().toLowerCase();

  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, shopId),
    columns: { name: true, handle: true, contactEmail: true },
  });

  const clientRows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.shopId, shopId), sql`lower(${clients.email}) = ${address}`));

  const orderRows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.shopId, shopId), sql`lower(${orders.customerEmail}) = ${address}`))
    .orderBy(orders.createdAt);

  const orderIds = orderRows.map((row) => row.id);

  /*
   * Every child read is bounded by the order ids above, which were themselves
   * bounded by `shopId`. Nothing here reaches a table by email a second time:
   * one narrowing, then joins from it, so there is exactly one place the shop
   * boundary can be got wrong rather than six.
   */
  const [items, invoiceRows, messages, downloads, ticketRows, subs, suppressions] =
    await Promise.all([
      orderIds.length
        ? db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
        : [],
      orderIds.length
        ? db.select().from(invoices).where(inArray(invoices.orderId, orderIds))
        : [],
      orderIds.length
        ? db
            .select()
            .from(orderMessages)
            .where(inArray(orderMessages.orderId, orderIds))
            .orderBy(orderMessages.sentAt)
        : [],
      orderIds.length
        ? db
            .select()
            .from(downloadEvents)
            .where(inArray(downloadEvents.orderId, orderIds))
            .orderBy(downloadEvents.at)
        : [],
      orderIds.length
        ? db.select().from(tickets).where(inArray(tickets.orderId, orderIds))
        : [],
      clientRows.length
        ? db
            .select()
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
        : [],
      /*
       * Included in the *export* and never erased. A buyer asking what is held
       * about them is entitled to be told that their unsubscribe is on record —
       * it is the one row here that exists for their benefit.
       */
      db
        .select()
        .from(emailSuppressions)
        .where(
          and(
            eq(emailSuppressions.shopId, shopId),
            sql`lower(${emailSuppressions.email}) = ${address}`,
          ),
        ),
    ]);

  const payload = {
    about: {
      shop: shop?.name ?? null,
      shopHandle: shop?.handle ?? null,
      shopContact: shop?.contactEmail ?? null,
      subject: address,
      assembledAt: new Date().toISOString(),
      /*
       * Stated in the file itself, because the file will outlive the email that
       * explained it. A buyer of five shops who downloads five exports needs
       * each one to say which shop it is from and that it is only that shop.
       */
      scope:
        "This export covers one shop only. Other shops on Sailo hold their own separate records and must be asked separately.",
    },
    customerRecord: clientRows,
    orders: orderRows,
    orderLines: items,
    invoices: invoiceRows,
    messagesSentToYou: messages,
    downloads,
    tickets: ticketRows,
    memberships: subs,
    emailSuppressions: suppressions,
  };

  const files = [
    {
      name: "orders.csv",
      body: csv(
        ["Order", "Placed", "Status", "Payment", "Total", "Currency", "Items"],
        orderRows.map((row) => [
          row.id,
          row.createdAt.toISOString(),
          row.status,
          row.paymentStatus,
          (row.totalCents / 100).toFixed(2),
          row.currency,
          items.filter((item) => item.orderId === row.id).length,
        ]),
      ),
    },
    {
      name: "messages.csv",
      body: csv(
        ["Sent", "Kind", "Direction", "To", "Subject", "Delivery"],
        messages.map((row) => [
          row.sentAt.toISOString(),
          row.kind,
          row.direction,
          row.toAddress ?? "",
          row.subject ?? "",
          row.status ?? "",
        ]),
      ),
    },
    {
      name: "downloads.csv",
      body: csv(
        ["When", "File", "From address"],
        downloads.map((row) => [
          row.at.toISOString(),
          row.fileName ?? "",
          row.ip ?? "",
        ]),
      ),
    },
  ];

  return {
    json: JSON.stringify(payload, null, 2),
    files,
    summary: {
      orders: orderRows.length,
      messages: messages.length,
      downloads: downloads.length,
      tickets: ticketRows.length,
    },
  };
}

/**
 * A single downloadable document, so the seller releases one link rather than
 * four.
 *
 * Every CSV cell goes through `escapeField`, which quotes a leading `=`, `+`,
 * `-` or `@`. That is the highest-risk escaping in the product and it is worth
 * naming why: the export is opened in Excel, by the *seller*, and the most
 * attacker-controlled string in it is the buyer's own name — a field the buyer
 * typed at a checkout with no validation on it beyond length.
 */
export function packSubjectExport(exported: SubjectExport): string {
  const parts = [
    "SAILO DATA EXPORT",
    "",
    "The JSON below is the complete record. The CSV sections after it are the",
    "same data in a form a spreadsheet will open.",
    "",
    "=== data.json ===",
    exported.json,
  ];

  for (const file of exported.files) {
    parts.push("", `=== ${escapeField(file.name)} ===`, file.body);
  }

  return parts.join("\n");
}
