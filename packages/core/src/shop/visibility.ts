import type { ProductKind } from "../catalog/variants";
import { PRODUCT_KIND_VALUES } from "../catalog/variants";

/**
 * Whether the public can see a shop at all, and what it can link out to.
 *
 * From `apps/web/src/lib/utils.ts`, because the phone asks the same questions —
 * a seller's dashboard shows whether their shop is live, and the settings screen
 * lists the same social platforms the web form does.
 */

/**
 * Whether the public can reach a shop at all.
 *
 * Three separate switches with one answer: `isPublished` is the seller's,
 * `suspendedAt` is ours, and `deletedAt` is the tombstone left behind by
 * self-serve deletion — the row survives only to hold the invoice sequence
 * and the orders that hang off it, and must never serve a page again. Kept
 * together in one function so a new public route can't honour one and forget
 * another, which is how a suspended shop ends up quietly still selling on a
 * page nobody remembered to guard.
 */
export function isShopLive(shop: {
  isPublished: boolean;
  suspendedAt: Date | null;
  deletedAt?: Date | null;
}) {
  return shop.isPublished && !shop.suspendedAt && !shop.deletedAt;
}

/**
 * `isUuid` moved to `@sailo/core/uuid` — the tracking beacon, the admin routes
 * and the broadcast segment builder all guard with it, and they are now in
 * three different packages.
 */
export { isUuid } from "@sailo/core/uuid";


export const SOCIAL_PLATFORMS = [
  "instagram", "tiktok", "x", "youtube", "facebook",
  "whatsapp", "telegram", "snapchat", "pinterest", "website",
] as const;

/**
 * The product kinds, paired with the label a form shows.
 *
 * Derived from `PRODUCT_KIND_VALUES` rather than written out. It was written out
 * — five values in `@sailo/core/variants` and the same five again in
 * `apps/web/src/lib/utils.ts` — and a sixth kind added to one and not the other
 * is a `<select>` that cannot produce a value the validator accepts, or worse,
 * a validator that accepts one no form offers.
 *
 * The labels are English. That is a pre-existing gap in a product shipping 22
 * languages, left as it was found rather than changed silently; the fix is a
 * dictionary key per kind, which is a translation change and not a refactor.
 */
export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = {
  physical: "Physical product",
  digital: "Digital product",
  service: "Service",
  event: "Event tickets",
  membership: "Membership",
};

export const PRODUCT_KINDS = PRODUCT_KIND_VALUES.map((value) => ({
  value,
  label: PRODUCT_KIND_LABELS[value],
}));
