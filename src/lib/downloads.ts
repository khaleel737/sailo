import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  orders,
  productFiles,
  products,
  shops,
  type Order,
  type Product,
} from "@/db/schema";
import { sendDownloadReady } from "@/lib/email";

/**
 * Digital delivery. A buyer never receives a file's storage URL — they get a
 * token that names their order, and the download route reads these rules
 * before it streams a single byte.
 */

export function newDownloadToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function downloadExpiry(days: number | null, from: Date): Date | null {
  if (!days || days <= 0) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Whether the buyer pays before the file lands. Every rail here settles out of
 * band, so holding the file back is the default — but a free product has
 * nothing to wait for, and a rail that took the money already has confirmed it.
 */
export function releasesImmediately(
  product: Pick<Product, "releaseOnPayment">,
  order: { totalCents: number; paymentStatus: string },
) {
  if (!product.releaseOnPayment) return true;
  if (order.totalCents === 0) return true;
  return order.paymentStatus === "paid";
}

export type DownloadState = {
  released: boolean;
  expired: boolean;
  /** The per-order cap has been used up. */
  exhausted: boolean;
  /** Downloads left, or null when uncapped. */
  remaining: number | null;
  /** True when a file may actually be streamed right now. */
  open: boolean;
};

export function downloadState(
  order: Pick<
    Order,
    "downloadReleasedAt" | "downloadExpiresAt" | "downloadLimit" | "downloadCount"
  >,
  now = new Date(),
): DownloadState {
  const released = order.downloadReleasedAt !== null;
  const expired =
    order.downloadExpiresAt !== null && order.downloadExpiresAt <= now;
  const remaining =
    order.downloadLimit === null
      ? null
      : Math.max(0, order.downloadLimit - order.downloadCount);
  const exhausted = remaining !== null && remaining <= 0;

  return {
    released,
    expired,
    exhausted,
    remaining,
    open: released && !expired && !exhausted,
  };
}

export function downloadUrl(token: string, base = process.env.NEXT_PUBLIC_APP_URL) {
  return base ? `${base}/download/${token}` : `/download/${token}`;
}

/**
 * Unlocks an order's files and tells the buyer. Claiming `downloadReleasedAt`
 * in the update's WHERE clause means a webhook retry — or a seller flipping
 * the payment status twice — sends one email, not two.
 */
export async function releaseDownloads(orderId: string): Promise<boolean> {
  const db = getDb();

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order || !order.downloadToken || order.productKind !== "digital") {
    return false;
  }
  if (order.downloadReleasedAt) return false;

  const [claimed] = await db
    .update(orders)
    .set({ downloadReleasedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), isNull(orders.downloadReleasedAt)))
    .returning({ id: orders.id });
  if (!claimed) return false;

  if (order.customerEmail) {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, order.shopId),
    });
    if (shop) {
      const result = await sendDownloadReady({
        shop,
        order,
        url: downloadUrl(order.downloadToken),
      });
      if (!result.sent) {
        console.warn(`[sailo] download email not sent: ${result.reason}`);
      }
    }
  }

  return true;
}

/** The files an order is entitled to, in the seller's order. */
export async function filesForOrder(order: Order) {
  if (!order.productId) return [];
  return getDb().query.productFiles.findMany({
    where: eq(productFiles.productId, order.productId),
    orderBy: [asc(productFiles.position)],
  });
}

/** True when this product can actually deliver something. */
export async function hasDeliverableFiles(productId: string) {
  const file = await getDb().query.productFiles.findFirst({
    where: eq(productFiles.productId, productId),
    columns: { id: true },
  });
  return Boolean(file);
}

/** Looks an order up by its public download token, with the shop it belongs to. */
export async function getDownloadByToken(token: string) {
  const db = getDb();

  const order = await db.query.orders.findFirst({
    where: eq(orders.downloadToken, token),
  });
  if (!order) return null;

  const [shop, product] = await Promise.all([
    db.query.shops.findFirst({ where: eq(shops.id, order.shopId) }),
    order.productId
      ? db.query.products.findFirst({ where: eq(products.id, order.productId) })
      : Promise.resolve(undefined),
  ]);
  if (!shop) return null;

  return { order, shop, product: product ?? null, files: await filesForOrder(order) };
}
