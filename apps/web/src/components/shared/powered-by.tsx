import Link from "next/link";
import type { ReactNode } from "react";
import type { Shop } from "@sailo/db/schema";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import { can } from "@/lib/plans";
import { APP_URL } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { SailoMark } from "@/components/brand";

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
 *
 * `medium` separates the surfaces the badge appears on. A shop page and an
 * order confirmation are different channels with different economics — the
 * page is seen by whoever browses, the email lands with someone who has
 * already bought — and rolling them into one figure hides which of the two
 * the free tier is actually being paid for.
 */
export function badgeHref(
  handle: string,
  base: string = APP_URL,
  medium: "shop" | "email" = "shop",
): string {
  const url = new URL("/", base);
  url.searchParams.set("utm_source", "sailo");
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", "footer_badge");
  url.searchParams.set("utm_content", handle);
  return url.toString();
}

/** The badge label, e.g. "Join Irieti on Sailo". */
export function badgeLabel(shop: BadgeShop, t: Dictionary): string {
  return interpolate(t.shop.joinOnSailo, { shop: shop.name });
}

const BRAND = "Sailo";

/**
 * The label with our name at full strength and the rest of the sentence muted.
 *
 * Split rather than composed from two strings, because the name does not sit
 * in the same place in every language — it opens the Japanese and Chinese
 * lines, ends the German one, and takes a suffix in Turkish ("Sailo'ya").
 * Splitting on the word finds it wherever the grammar put it, and a locale
 * that somehow lacks it still renders a correct, if evenly weighted, sentence.
 */
function emphasised(label: string): ReactNode {
  const at = label.indexOf(BRAND);
  if (at === -1) return label;

  return (
    <>
      {label.slice(0, at)}
      <span className="font-semibold text-[var(--surface-fg)]">{BRAND}</span>
      {label.slice(at + BRAND.length)}
    </>
  );
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

  const label = badgeLabel(shop, t);

  return (
    <Link
      href={badgeHref(shop.handle)}
      /*
       * A pill rather than a line of small print. As muted 12px text beside a
       * generic shop glyph it read as a caption and was skipped; carried on a
       * card, with our own mark, it reads as a thing you can press — which is
       * the whole point of a channel we are choosing to measure.
       *
       * It still defers to the seller: same pill shape and size as the
       * referral chip above it, no accent fill, and it sits below their
       * content rather than beside it.
       */
      className={cn(
        "surface-card focus-ring-accent press",
        // min-h-11 is 44px — the same hit area the legal links in this footer
        // already take. Padding alone left it at 38px, which is a miss on a
        // phone and inconsistent with its own neighbours.
        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full px-3.5",
        // `press` owns the transform transition, so naming opacity here keeps
        // the two from overwriting each other through the shorthand — and the
        // curve is the app's, not Tailwind's default ease-in-out.
        "text-muted text-xs font-medium",
        "transition-opacity duration-150 ease-[var(--ease-out-quint)] hover:opacity-70",
        className,
      )}
      // The sentence already names Sailo, so the mark beside it would only
      // repeat the word to a screen reader.
      aria-label={label}
    >
      <SailoMark className="size-4 shrink-0 text-[var(--badge-mark)]" />
      {/* `min-w-0` or the flex item refuses to shrink and `truncate` never
          fires — a long shop name would push the pill past its container. */}
      <span className="min-w-0 truncate">{emphasised(label)}</span>
    </Link>
  );
}
