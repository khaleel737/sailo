import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, tickets } from "@sailo/db/schema";
import { field } from "@/lib/csv";
import { issueTickets, type TicketDraft } from "@sailo/commerce/tickets";
import { parse } from "./parse";
import type { ImportReport } from "./types";

/**
 * A guest list, as a file.
 *
 * Everything that gets somebody through a door without buying a ticket lands
 * here: comps, the artist's plus-two, sponsor allocations, the fifty people
 * who paid the organiser in cash, and every attendee of an event that was
 * sold somewhere else before the seller moved. None of them had any way in
 * before this — the door could only admit a code minted by a Sailo order —
 * so the honest description of a five-hundred-person event with forty comps
 * was that forty people had to be waved past on trust.
 */

/**
 * A ceiling on one import, matching the customer importer's. Stated in the
 * report rather than applied silently: a file that half-imported and said
 * "500 added" would leave a seller believing the rest of the room is in here.
 */
export const MAX_TICKET_ROWS = 2_000;

/** A ceiling per row, so a typo in a quantity cell cannot mint a thousand. */
const MAX_PER_ROW = 50;

export async function importTickets(opts: {
  shopId: string;
  csv: string;
  dryRun: boolean;
  /** The event the seller was standing in when they opened the importer. */
  defaultProductId?: string | null;
}): Promise<ImportReport> {
  const all = parse(opts.csv);
  const rows = all.slice(0, MAX_TICKET_ROWS);

  const report: ImportReport = {
    type: "tickets",
    parsed: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    preview: [],
  };

  if (all.length > MAX_TICKET_ROWS) {
    report.errors.push({
      row: MAX_TICKET_ROWS + 1,
      message: `Only the first ${MAX_TICKET_ROWS} rows were read — ${all.length - MAX_TICKET_ROWS} were left out. Split the file and import again.`,
    });
    report.skipped += all.length - MAX_TICKET_ROWS;
  }

  const events = await eventLookup(opts.shopId);
  if (events.size === 0 && !opts.defaultProductId) {
    report.errors.push({
      row: 1,
      message: "This shop has no events to add guests to yet.",
    });
    return report;
  }

  /*
   * What the shop already holds, per event, keyed the same way the file is.
   *
   * Re-running an import is the normal case, not the exception — a seller
   * adds twenty names to the spreadsheet and uploads the whole thing again.
   * Without this, the first forty guests get a second ticket each and the
   * door list doubles. Counted rather than merely matched, because "Sarah
   * plus two" is one row and three admissions.
   */
  const held = await heldByKey(opts.shopId);
  const drafts: TicketDraft[] = [];

  for (const [index, raw] of rows.entries()) {
    const line = index + 2;

    const eventCell = field(raw, "Event", "Event Name", "Product", "Handle");
    const productId = eventCell
      ? (events.get(eventCell.trim().toLowerCase()) ?? null)
      : (opts.defaultProductId ?? null);

    if (!productId) {
      report.errors.push({
        row: line,
        message: eventCell
          ? `No event called "${eventCell}" in this shop`
          : "Needs an Event column, or import from an event's own check-in page",
      });
      report.skipped += 1;
      continue;
    }

    const name = field(raw, "Attendee Name", "Name", "Guest", "Full Name");
    const email = field(raw, "Attendee Email", "Email", "Email Address")
      .toLowerCase();

    /*
     * One of the two, because both are the dedupe key and a row with neither
     * cannot be recognised on a second run. It is also not admissible at a
     * door: a volunteer searching the list has a name or an address to type,
     * and an anonymous admission is indistinguishable from every other one.
     */
    if (!name && !email) {
      report.errors.push({
        row: line,
        message: "Needs a name or an email — the door has to be able to find them",
      });
      report.skipped += 1;
      continue;
    }
    if (email && !email.includes("@")) {
      report.errors.push({ row: line, message: `"${email}" is not a valid email` });
      report.skipped += 1;
      continue;
    }

    const quantityCell = field(raw, "Quantity", "Qty", "Tickets", "Admissions");
    const quantity = quantityCell ? Number.parseInt(quantityCell, 10) : 1;
    if (!Number.isFinite(quantity) || quantity < 1) {
      report.errors.push({
        row: line,
        message: `"${quantityCell}" is not a number of tickets`,
      });
      report.skipped += 1;
      continue;
    }
    if (quantity > MAX_PER_ROW) {
      report.errors.push({
        row: line,
        message: `${quantity} tickets on one row — the most one guest can hold is ${MAX_PER_ROW}`,
      });
      report.skipped += 1;
      continue;
    }

    const key = `${productId}:${email || `name:${name.toLowerCase()}`}`;
    const already = held.get(key) ?? 0;
    // The file says how many this guest should end up with, not how many to
    // add. A second run of an unchanged file therefore writes nothing, and a
    // run after bumping somebody from 2 to 3 writes exactly one.
    const shortfall = Math.max(0, quantity - already);

    if (shortfall === 0) {
      report.skipped += 1;
      continue;
    }
    held.set(key, already + shortfall);

    const tier = field(raw, "Tier", "Ticket Type", "Type", "Category") || null;
    const note = field(raw, "Note", "Notes", "Comment") || null;

    if (opts.dryRun) {
      report.preview.push({
        row: line,
        label:
          `${name || email}${shortfall > 1 ? ` ×${shortfall}` : ""}` +
          (tier ? ` — ${tier}` : ""),
        action: already > 0 ? "update" : "create",
      });
      if (already > 0) report.updated += shortfall;
      else report.created += shortfall;
      continue;
    }

    for (let n = 0; n < shortfall; n++) {
      drafts.push({
        productId,
        attendeeName: name.slice(0, 120) || null,
        attendeeEmail: email.slice(0, 200) || null,
        tier: tier?.slice(0, 80) ?? null,
        note: note?.slice(0, 300) ?? null,
        source: "import",
      });
    }
    if (already > 0) report.updated += shortfall;
    else report.created += shortfall;
  }

  if (!opts.dryRun && drafts.length > 0) {
    const written = await issueTickets(opts.shopId, drafts);
    // Report what landed, not what was attempted. `issueTickets` gives up
    // after three rounds of code collisions, and a seller told "500 added"
    // when 499 exist has no way to find the missing one.
    const missing = drafts.length - written.length;
    if (missing > 0) {
      report.errors.push({
        row: 0,
        message: `${missing} ticket${missing === 1 ? "" : "s"} could not be issued. Run the import again to add the rest.`,
      });
      report.created = Math.max(0, report.created - missing);
    }
  }

  return report;
}

/** Every event in the shop, findable by slug or by title, case-insensitively. */
async function eventLookup(shopId: string): Promise<Map<string, string>> {
  const rows = await getDb()
    .select({ id: products.id, slug: products.slug, title: products.title })
    .from(products)
    .where(and(eq(products.shopId, shopId), eq(products.kind, "event")));

  const lookup = new Map<string, string>();
  for (const row of rows) {
    // Slug first, so a shop with two events sharing a title still resolves
    // the one the seller named exactly.
    lookup.set(row.slug.toLowerCase(), row.id);
    if (!lookup.has(row.title.toLowerCase())) {
      lookup.set(row.title.toLowerCase(), row.id);
    }
  }
  return lookup;
}

/**
 * How many admissions each guest already holds, per event.
 *
 * Keyed on email when there is one and on name otherwise, which is the same
 * key the file is read with — so the two agree about who is already on the
 * list. Revoked tickets are excluded: a seller who cancelled somebody and
 * then re-imported the list means to put them back.
 */
async function heldByKey(shopId: string): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({
      productId: tickets.productId,
      email: tickets.attendeeEmail,
      name: tickets.attendeeName,
      count: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.shopId, shopId),
        inArray(tickets.source, ["import", "manual"]),
        sql`${tickets.status} <> 'void'`,
      ),
    )
    .groupBy(tickets.productId, tickets.attendeeEmail, tickets.attendeeName);

  const held = new Map<string, number>();
  for (const row of rows) {
    if (!row.productId) continue;
    const identity = row.email
      ? row.email.toLowerCase()
      : row.name
        ? `name:${row.name.toLowerCase()}`
        : null;
    if (!identity) continue;
    const key = `${row.productId}:${identity}`;
    held.set(key, (held.get(key) ?? 0) + row.count);
  }
  return held;
}
