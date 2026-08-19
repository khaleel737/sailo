import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderLines } from "./order-lines";
import {
  orders,
  productFiles,
  products,
  shops,
  type Order,
  type Product,
  type Shop,
} from "@sailo/db/schema";
import { eventAccessForOrder } from "../ticketing/event-access";
import { claimCodesForOrder } from "../catalog/code-pool";
import { mintLicensesForOrder } from "./licenses";
import { randomHex } from "@sailo/core/token";

/**
 * Digital delivery. A buyer never receives a file's storage URL — they get a
 * token that names their order, and the download route reads these rules
 * before it streams a single byte.
 */

export function newDownloadToken() {
  return randomHex(16);
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
/**
 * Whether an order has files to unlock at all.
 *
 * The token is the authority, and it is minted only when a line was found
 * carrying deliverable files — so its presence already means there is
 * something to release. `productKind` must not be consulted: it is a header
 * column describing the order's *first* line, so a basket holding a mug and
 * a PDF reads as "physical" and every release path refuses forever, leaving
 * a buyer who paid with files that no manual action can free.
 */
export function hasReleasableDownloads(order: {
  downloadToken: string | null;
  downloadReleasedAt: Date | null;
}): boolean {
  if (!order.downloadToken) return false;
  // Already released: claiming twice would send the buyer a second email.
  return order.downloadReleasedAt === null;
}

/**
 * Who to tell once the files unlock.
 *
 * A hook rather than an import, and the reason is structural: composing that
 * email needs an order's own lines, and reading an order's lines is this
 * package's job — so importing the sender here made `@sailo/commerce` and
 * `@sailo/email` depend on each other, which turbo refuses outright and which
 * would have been a worse tangle than the build error if it had not.
 *
 * The hooks pattern was already the answer everywhere else in this package —
 * `changeOrderStatus`, `refundOrder`, `shipOrder` all take their notifications
 * this way — and the release is no different: unlocking a file is the fact,
 * telling somebody is an effect, and only the caller knows which surface it is
 * being told from.
 */
export type ReleaseHooks = {
  notify?: (input: {
    shop: Shop;
    order: Order;
    url: string;
    events: Awaited<ReturnType<typeof eventAccessForOrder>>;
  }) => Promise<{ sent: boolean; reason?: string }>;
};

export async function releaseDownloads(
  orderId: string,
  hooks: ReleaseHooks = {},
): Promise<boolean> {
  const db = getDb();

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order || !hasReleasableDownloads(order)) return false;
  // Bound here because the guard above proves it to a reader, not to the
  // compiler — the narrowing does not cross a function boundary.
  const { downloadToken } = order;
  if (!downloadToken) return false;

  /*
   * Nothing coming back means another caller claimed it first — a webhook
   * retry racing the seller's own click. That is the ordinary outcome this
   * WHERE clause exists to produce, not a broken invariant, so it returns
   * false rather than throwing and failing the delivery.
   */
  const [claimed] = await db
    .update(orders)
    .set({ downloadReleasedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), isNull(orders.downloadReleasedAt)))
    .returning({ id: orders.id });
  if (!claimed) return false;

  /*
   * The code and the licence are spent *here*, on the winning side of the
   * claim above — spec 48.
   *
   * Not at checkout, and the distinction is the whole of the feature's
   * inventory story: roughly a third of card sessions are abandoned, and a
   * pool that burned a key when the Stripe page opened would be drained by
   * people who never paid. `0034` already made this decision for the file and
   * the event join URL — "they are the whole good; handing one to an unpaid
   * order gives the good away" — and a licence key is the same good in a
   * shorter string.
   *
   * After the UPDATE won rather than before it, so a webhook retry racing the
   * seller's own click reaches neither: the loser returned false three lines
   * up. Both are additionally idempotent on their own, because this is a real
   * second path — a seller toggling an order paid, unpaid, paid.
   *
   * Neither may fail the release. An empty pool is a real state and a buyer
   * whose files and tickets are held hostage by a missing key is worse off
   * than one who is short a code the seller can send by hand.
   */
  try {
    await claimCodesForOrder(orderId);
  } catch (error) {
    console.error("[sailo] could not claim pool codes for an order", error);
  }
  try {
    await mintLicensesForOrder(orderId);
  } catch (error) {
    console.error("[sailo] could not mint licence keys for an order", error);
  }

  if (order.customerEmail) {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, order.shopId),
    });
    if (shop) {
      /*
       * Read after the claim, not before it.
       *
       * `eventAccessForOrder` returns a join link only when the order has
       * been released, and the release is the UPDATE above — so asking
       * earlier would reliably answer "locked" and this email, the one whose
       * whole job is to hand over the link, would be the one email that never
       * carries it.
       */
      const events = await eventAccessForOrder({
        ...order,
        downloadReleasedAt: new Date(),
      });

      if (hooks.notify) {
        const result = await hooks.notify({
          shop,
          order,
          url: downloadUrl(downloadToken),
          events,
        });
        if (!result.sent) {
          console.warn(`[sailo] download email not sent: ${result.reason}`);
        }
      }
    }
  }

  return true;
}

/**
 * The files an order is entitled to, in the seller's order.
 *
 * Across every line, not just `order.productId`. That column names the
 * header's single product, so reading it alone would show a buyer who paid
 * for two digital products the files of one of them and nothing to explain
 * where the rest went.
 *
 * PER VARIANT, SINCE SPEC 48
 *
 * `product_files.variant_id` is NULL for the product default and set for a
 * combination's own files, and the resolution is Easytools' rule: the ordered
 * variant's files where any exist, else the default. A product sold as "PDF
 * only / PDF + Figma / everything" delivered the same set to all three before
 * this, which is the feature the column exists for.
 *
 * **Both directions matter.** Falling back when a variant has no files of its
 * own keeps every single-variant catalogue working untouched; *not* widening
 * when it does is the security half — buying the cheap variant must not
 * download the expensive one's files.
 */
export async function filesForOrder(order: Order) {
  return entitledFiles(order);
}

/**
 * The ordered (product, variant) pairs, deduplicated.
 *
 * A basket holding two variants of one product is entitled to both sets, which
 * is why this is a list of pairs rather than a map from product to variant.
 */
async function orderedCombinations(
  order: Order,
): Promise<{ productId: string; variantId: string | null }[]> {
  const lines = await orderLines(order);
  const seen = new Set<string>();
  const out: { productId: string; variantId: string | null }[] = [];

  for (const line of lines) {
    if (!line.productId) continue;
    const key = `${line.productId}:${line.variantId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ productId: line.productId, variantId: line.variantId ?? null });
  }
  return out;
}

async function entitledFiles(order: Order) {
  const combinations = await orderedCombinations(order);
  if (combinations.length === 0) return [];

  const rows = await getDb().query.productFiles.findMany({
    where: inArray(
      productFiles.productId,
      combinations.map((c) => c.productId),
    ),
    orderBy: [asc(productFiles.position)],
  });

  const kept = new Map<string, (typeof rows)[number]>();
  for (const combination of combinations) {
    for (const file of filesForVariant(rows, combination)) kept.set(file.id, file);
  }
  return [...kept.values()];
}

/**
 * One combination's files: its own if it has any, otherwise the product's
 * defaults.
 *
 * Pure over rows already read, so the download route and the delivery page
 * cannot disagree about what a buyer is entitled to — which is exactly the
 * kind of rule that grows a second, slightly different copy and then a bug.
 */
export function filesForVariant<
  T extends { productId: string; variantId: string | null },
>(files: T[], combination: { productId: string; variantId: string | null }): T[] {
  const mine = files.filter((f) => f.productId === combination.productId);
  if (combination.variantId) {
    const own = mine.filter((f) => f.variantId === combination.variantId);
    if (own.length > 0) return own;
  }
  return mine.filter((f) => f.variantId === null);
}

/**
 * Whether this exact file may be streamed to this order.
 *
 * The gate the download route asks. It used to be "does this file belong to a
 * product on the order", which stopped being sufficient the moment files could
 * belong to a variant: the cheap variant's buyer would pass it while asking
 * for the expensive one's file.
 */
export async function orderMayFetchFile(
  order: Order,
  fileId: string,
): Promise<boolean> {
  const files = await entitledFiles(order);
  return files.some((f) => f.id === fileId);
}

/** Every product in an order, deduplicated. Entitlement is judged on this. */
export async function orderedProductIds(order: Order): Promise<string[]> {
  const lines = await orderLines(order);
  return [
    ...new Set(
      lines.map((line) => line.productId).filter((id): id is string => !!id),
    ),
  ];
}

/**
 * True when this exact combination can actually deliver something.
 *
 * Variant-aware since spec 48, and it has to be: a product whose only files
 * hang off the expensive variant would otherwise mint a download token for a
 * buyer of the cheap one and hand them a delivery page with nothing on it.
 * The fallback is `filesForVariant`'s — the variant's own files, else the
 * product defaults — so a catalogue with no per-variant files answers exactly
 * as it did before.
 */
export async function hasDeliverableFiles(
  productId: string,
  variantId: string | null = null,
) {
  const rows = await getDb().query.productFiles.findMany({
    where: eq(productFiles.productId, productId),
    columns: { id: true, productId: true, variantId: true },
  });
  return filesForVariant(rows, { productId, variantId }).length > 0;
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
