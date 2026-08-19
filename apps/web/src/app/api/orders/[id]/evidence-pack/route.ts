import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders } from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import { isUuid } from "@sailo/core/uuid";
import { requireShop } from "@/lib/session";
import { renderOrderPack } from "@/lib/evidence-pack";

/**
 * The seller's own evidence pack for one order. Spec 45.
 *
 * ─── AVAILABLE BEFORE ANY DISPUTE ──────────────────────────────────────────
 *
 * That is what "always ready" means, and it is also the best way for a seller to
 * find a gap while it is still fixable: a pack full of "Not on record" is a shop
 * that has not been marking things shipped, and the moment to learn that is not
 * an hour before a deadline.
 *
 * ─── THREE READERS, THREE CHECKS, AND NO PUBLIC TOKEN ROUTE ────────────────
 *
 * The pack contains a buyer's name, email, address and IP. The shop reaches it
 * through `requireShop` and its own `shopId`; staff reach it through /hq's own
 * dispute page; **nobody else reaches it at all**. Unlike an invoice, this is
 * not a document the buyer gets — there is no token form of this URL and there
 * must never be one.
 *
 * ─── AND IT IS RATE LIMITED ────────────────────────────────────────────────
 *
 * Rendering two hundred download-log lines into a PDF is CPU-bound work behind
 * an authenticated endpoint, which is a shape worth metering even when only the
 * owner can reach it. Per shop rather than per order: a seller pulling packs for
 * their whole order history is the case this bounds, and one order is the case
 * it must not obstruct.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/orders/[id]/evidence-pack">,
) {
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });

  // Redirects if unauthenticated, so only a signed-in seller gets this far.
  const { shop } = await requireShop();

  const gate = await rateLimit(`evidence-pack:${shop.id}`, 30, 300);
  if (!gate.allowed) {
    return new Response("Too many requests. Try again in a few minutes.", {
      status: 429,
    });
  }

  const order = await getDb().query.orders.findFirst({ where: eq(orders.id, id) });
  /*
   * The same answer for another shop's order as for one that does not exist. A
   * 403 here would confirm the id belongs to somebody, which on a sequence of
   * uuids is little use and is still more than nothing.
   */
  if (!order || order.shopId !== shop.id) {
    return new Response("Not found", { status: 404 });
  }

  const { bytes, filename } = await renderOrderPack({
    order,
    shop,
    /*
     * The clock is read here and passed down. Nothing inside the pack reads one,
     * so two renders of the same order differ only in this line — which is what
     * makes "re-render the case exactly" true rather than approximate.
     */
    renderedAt: new Date(),
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A private document about a named buyer. Nothing about it is cacheable.
      "Cache-Control": "private, no-store",
    },
  });
}
