import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, products } from "@sailo/db/schema";
import { claimedCodeRows } from "@sailo/commerce/catalog";
import { csvResponse, date, toCsv } from "@sailo/core/csv";
import { isUuid } from "@sailo/core/uuid";
import { requireShop } from "@/lib/session";

/**
 * The seller's audit of one code pool — spec 48.
 *
 * **Claimed codes only, and that is the whole design of this route.**
 *
 * An export of *unclaimed* keys is a shop's inventory in a file that will sit
 * in a downloads folder for years, get attached to an email, and be synced to
 * whatever the seller's laptop syncs to. Every one of those strings is worth
 * money exactly once. What a seller actually needs from an export is the
 * audit — which code went to which order, and when — and that half is safe to
 * write down because the buyer already has it.
 *
 * So `claimedCodeRows` filters on `claimed_at is not null` in SQL rather than
 * here: a filter applied after the read is one a later refactor can drop
 * without the query changing shape, and this is not a rule to leave in
 * JavaScript.
 *
 * Formula-escaped through `toCsv`, like every other export in the tree. A
 * licence key beginning with `=` or `-` is not far-fetched, and a spreadsheet
 * that executes one is the seller's own machine running a stranger's string.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/admin/products/[id]/codes.csv">,
) {
  const { id } = await params;
  const { shop } = await requireShop("products:read");
  if (!isUuid(id)) return new Response("Not found", { status: 404 });

  /*
   * Ownership in the WHERE. The id comes from the URL, so a seller who edits
   * it must match nothing rather than read another shop's pool — the guard
   * working, not an error to report.
   */
  const product = await getDb().query.products.findFirst({
    where: and(eq(products.id, id), eq(products.shopId, shop.id)),
    columns: { id: true, slug: true },
  });
  if (!product) return new Response("Not found", { status: 404 });

  const rows = await claimedCodeRows(product.id);

  /*
   * The buyer's address beside the order id, because that is what a seller
   * reconciles against.
   *
   * A support case reads "I never got my key from Ana" — the id answers "which
   * order" and the address answers "was it this one", and a file with only the
   * id makes them open every order in a tab to find out. Both are the seller's
   * own data about their own sale.
   *
   * One query rather than one per row: a pool of two hundred claimed codes
   * would otherwise be two hundred round trips on a route a seller clicks
   * while looking at the screen.
   */
  const ids = [...new Set(rows.flatMap((r) => (r.orderId ? [r.orderId] : [])))];
  const buyers = new Map<string, string>();
  if (ids.length > 0) {
    const found = await getDb()
      .select({ id: orders.id, email: orders.customerEmail })
      .from(orders)
      .where(and(eq(orders.shopId, shop.id), inArray(orders.id, ids)));
    for (const order of found) buyers.set(order.id, order.email ?? "");
  }

  const body = toCsv(
    ["Code", "Order", "Buyer", "Handed out", "Revoked"],
    rows.map((row) => [
      row.code,
      row.orderId ?? "",
      row.orderId ? (buyers.get(row.orderId) ?? "") : "",
      date(row.claimedAt),
      date(row.revokedAt),
    ]),
  );

  return csvResponse(`${product.slug}-codes.csv`, body);
}
