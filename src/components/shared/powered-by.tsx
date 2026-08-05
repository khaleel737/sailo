import Link from "next/link";
import { Store } from "lucide-react";
import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { can } from "@/lib/plans";
import { APP_URL } from "@/lib/seo";

/**
 * The free tier's rent.
 *
 * A free shop carries this; Pro and Business remove it. That makes it the
 * platform's distribution channel, not decoration — so it lives in one place
 * rather than being hand-rolled per page. Every earlier copy was its own
 * private decision about whether to check the plan at all, and the invoice
 * page simply forgot, branding shops that had paid to remove it.
 *
 * Two things follow from treating it as distribution:
 *
 * The copy addresses the visitor, not the seller. "Powered by" credits a
 * vendor; naming the shop invites the person reading to open one too, which
 * is the only reason a free tier pays for itself.
 *
 * And the link is attributed. Without `utm_content` there is no way to know
 * which shop sent a signup, so the channel can't be measured and can't be
 * argued about with numbers.
 */

/** Only the columns the gate and the label read, so any shop query fits. */
export type BadgeShop = Pick<
  Shop,
  "name" | "handle" | "plan" | "subscriptionStatus"
> & {
  compPlan?: string | null;
};

/** Whether this shop's pages must carry the badge. */
export function showsBadge(shop: BadgeShop): boolean {
  return !can(shop, "removeBadge");
}

/**
 * Where the badge points. Absolute so the same builder serves the PDF, which
 * has no origin to resolve a relative path against.
 */
export function badgeHref(handle: string, base: string = APP_URL): string {
  const url = new URL("/", base);
  url.searchParams.set("utm_source", "sailo");
  url.searchParams.set("utm_medium", "shop");
  url.searchParams.set("utm_campaign", "footer_badge");
  url.searchParams.set("utm_content", handle);
  return url.toString();
}

/** The badge label, e.g. "Join Irieti on Sailo". */
export function badgeLabel(shop: BadgeShop, t: Dictionary): string {
  return interpolate(t.shop.joinOnSailo, { shop: shop.name });
}

/**
 * Renders nothing for a paid shop. Callers can drop this in unconditionally —
 * that is the point, since a caller deciding for itself is how the invoice
 * page got it wrong.
 */
export function PoweredBy({
  shop,
  t,
  className = "",
}: {
  shop: BadgeShop;
  t: Dictionary;
  className?: string;
}) {
  if (!showsBadge(shop)) return null;

  return (
    <Link
      href={badgeHref(shop.handle)}
      className={`text-muted inline-flex items-center gap-1.5 text-xs transition hover:opacity-70 ${className}`.trim()}
    >
      <Store className="size-3.5" />
      {badgeLabel(shop, t)}
    </Link>
  );
}
