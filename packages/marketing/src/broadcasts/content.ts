/**
 * The offer a broadcast carries, resolved at the moment of sending.
 *
 * Separate from the sending because *when* this runs is the whole point: a coupon that
 * expired between composing and sending, or a product that went out of stock, must not be
 * in the message. Reading it here rather than at compose time is what makes that true.
 */

import "server-only";
import { getDb } from "@sailo/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { coupons, productImages, products, type Broadcast, type Shop } from "@sailo/db/schema";
import { getDictionary } from "@sailo/i18n";
import { appOrigin } from "@sailo/core/origin";
import type { ShopDictionary } from "./labels";
import type { BroadcastContent } from "./render";

/**
 * The offer, as it stands at this moment.
 *
 * Read rather than snapshotted, and that is the deliberate choice: a seller
 * who fixes a typo in a coupon's terms, or unpublishes a product they have
 * sold out of, between two batches of the same send has that fix reach the
 * batches still to go. The alternative — freezing everything at queue time —
 * means a send that started at 9am is still promising, at noon, something the
 * shop stopped offering at ten.
 *
 * Everything here degrades to nothing rather than to an error. A deleted
 * coupon renders no coupon block; an unpublished product simply is not in the
 * list. A broadcast is not worth failing over its decoration.
 */
export type BroadcastDraft = Pick<
  Broadcast,
  "subject" | "previewText" | "bodyMarkdown" | "couponId" | "productIds" | "ctaLabel" | "ctaUrl"
>;

export async function resolveContent(
  shop: Shop,
  broadcast: BroadcastDraft,
  t: ShopDictionary = getDictionary(shop.locale ?? "en"),
): Promise<BroadcastContent> {
  const db = getDb();

  const coupon = broadcast.couponId
    ? await db.query.coupons.findFirst({
        // Shop-scoped even though the id came from our own row: a coupon that
        // somehow points elsewhere must not have its code mailed out.
        where: and(eq(coupons.id, broadcast.couponId), eq(coupons.shopId, shop.id)),
      })
    : null;

  const ids = Array.isArray(broadcast.productIds) ? broadcast.productIds.slice(0, MAX_PROMO_PRODUCTS) : [];
  const rows =
    ids.length > 0
      ? await db
          .select({
            id: products.id,
            title: products.title,
            slug: products.slug,
            priceCents: products.priceCents,
            compareAtCents: products.compareAtCents,
            imageUrl: sql<string | null>`(
              select ${productImages.url} from ${productImages}
              where ${productImages.productId} = ${products.id}
              order by ${productImages.position}
              limit 1
            )`,
          })
          .from(products)
          .where(
            and(
              eq(products.shopId, shop.id),
              inArray(products.id, ids),
              // An unpublished product's page 404s for a buyer, so a card
              // pointing at one is a link to nothing in every inbox.
              eq(products.isPublished, true),
            ),
          )
      : [];

  // The seller's order, not the database's — the first card is the one the
  // campaign is about, and `inArray` has no opinion about which that is.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const base = appOrigin();

  const cta = broadcast.ctaUrl || broadcast.ctaLabel
    ? {
        label: broadcast.ctaLabel || t.mailing.shopNow,
        url: broadcast.ctaUrl || `${base}/${shop.handle}`,
      }
    : null;

  return {
    subject: broadcast.subject,
    previewText: broadcast.previewText,
    bodyMarkdown: broadcast.bodyMarkdown,
    coupon: coupon
      ? {
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          minSubtotalCents: coupon.minSubtotalCents,
          expiresAt: coupon.expiresAt,
        }
      : null,
    products: ids.flatMap((id) => {
      const row = byId.get(id);
      return row
        ? [
            {
              title: row.title,
              priceCents: row.priceCents,
              compareAtCents: row.compareAtCents,
              imageUrl: row.imageUrl,
              url: `${base}/${shop.handle}/p/${row.slug}`,
            },
          ]
        : [];
    }),
    cta,
  };
}

/** How many product cards one message may carry. */
export const MAX_PROMO_PRODUCTS = 4;
