import { and, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, products } from "@sailo/db/schema";
import { roleCan } from "@sailo/auth/permissions";
import { requireShop } from "@/lib/session";
import { getShopOrders } from "@/lib/queries";
import { orderSummaryTitle } from "@/lib/order-lines";

/**
 * What ⌘K finds beyond pages: this shop's own orders, products and clients.
 *
 * The palette's phase 2 (spec §13). Same auth as every admin page —
 * `requireShop` gates the route, and each group only runs when the member's
 * role could open the page the result links to, so a search cannot show a
 * teammate rows the sidebar would refuse them. The channel is the session's
 * shop, never a parameter.
 *
 * Five per group, newest first. The palette is a doorway, not a report — a
 * query that needs more than five of anything wants the page's own search,
 * which the top pages-result already offers.
 */
export async function GET(request: Request) {
  const { shop, role } = await requireShop("orders:read");

  const q =
    new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
  if (q.length < 2) {
    return Response.json({ orders: [], products: [], clients: [] });
  }
  // `%` and `_` are match syntax inside ILIKE, not text.
  const term = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const db = getDb();

  const [orderRows, productRows, clientRows] = await Promise.all([
    getShopOrders(shop.id, 5, { search: q }),
    roleCan(role, "products:read")
      ? db
          .select({ id: products.id, title: products.title })
          .from(products)
          .where(and(eq(products.shopId, shop.id), ilike(products.title, term)))
          .limit(5)
      : Promise.resolve([]),
    roleCan(role, "customers:read")
      ? db
          .select({ id: clients.id, name: clients.name, email: clients.email })
          .from(clients)
          .where(
            and(
              eq(clients.shopId, shop.id),
              or(ilike(clients.name, term), ilike(clients.email, term)),
            ),
          )
          .limit(5)
      : Promise.resolve([]),
  ]);

  return Response.json({
    orders: orderRows.map((order) => ({
      label: orderSummaryTitle(order),
      sub: order.customerName ?? order.customerEmail ?? "",
      href: `/admin/orders/${order.id}`,
    })),
    products: productRows.map((p) => ({
      label: p.title,
      href: `/admin/products/${p.id}`,
    })),
    clients: clientRows.map((c) => ({
      label: c.name ?? c.email ?? "—",
      sub: c.name ? (c.email ?? "") : "",
      href: `/admin/clients/${c.id}`,
    })),
  });
}
