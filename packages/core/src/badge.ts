import { can } from "./plans";

/**
 * The free tier's rent, as two decisions rather than as a component.
 *
 * `apps/web/src/components/shared/powered-by.tsx` still draws the badge — it is
 * a React component with a mark in it and it belongs there. What lives here is
 * the pair of questions that component asks and that a transactional email now
 * has to ask too: *is this shop carrying the badge*, and *where does it point*.
 *
 * They moved because `@sailo/email` builds the footer of every receipt this
 * platform sends, and neither app may reach into the other. A second copy of
 * `showsBadge` would be a shop that had paid to remove the badge still finding
 * it on their order confirmations — which is exactly the bug the component's
 * own header records the invoice page having shipped.
 */

/** What deciding about the badge needs to know about a shop. */
export type BadgeShop = Parameters<typeof can>[0];

/** A free shop carries the badge; Pro and Business remove it. */
export function showsBadge(shop: BadgeShop): boolean {
  return !can(shop, "removeBadge");
}

/**
 * Where the badge points.
 *
 * Absolute, because the same builder serves a PDF and an email — neither has an
 * origin to resolve a relative path against. `base` is a parameter rather than
 * read from the environment here: this package is imported by two apps and a
 * background sender, and each knows its own origin.
 *
 * `medium` separates the surfaces it appears on. A shop page and an order
 * confirmation are different channels with different economics — the page is
 * seen by whoever browses, the email lands with somebody who has already
 * bought — and rolling them into one figure hides which of the two the free
 * tier is actually being paid for.
 */
export function badgeHref(
  handle: string,
  base: string,
  medium: "shop" | "email" = "shop",
): string {
  const url = new URL("/", base);
  url.searchParams.set("utm_source", "sailo");
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", "footer_badge");
  url.searchParams.set("utm_content", handle);
  return url.toString();
}
