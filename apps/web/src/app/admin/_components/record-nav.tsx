import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@sailo/design-system/web/cn";

/**
 * Shopify's ↑ ↓ record arrows — walk the neighbouring records without going
 * back to the list. The order is the list's own (the caller computes the two
 * hrefs from the same query the list renders), so "next" always means "the
 * row under this one".
 *
 * A server component on purpose: two links need no hydration, and the edit
 * pages this sits on are heavy enough already. An edge with no neighbour
 * renders the arrow disabled rather than dropping it — the pair reads as one
 * control, and a control that loses half of itself at either end looks
 * broken, not empty.
 */
export function RecordNav({
  prevHref,
  nextHref,
  prevLabel,
  nextLabel,
}: {
  prevHref: string | null;
  nextHref: string | null;
  prevLabel: string;
  nextLabel: string;
}) {
  const arrow = (
    href: string | null,
    label: string,
    icon: React.ReactNode,
    side: "start" | "end",
  ) => {
    const shape = cn(
      "flex size-8 items-center justify-center transition pointer-coarse:size-11",
      side === "start" ? "rounded-s-lg" : "rounded-e-lg -ms-px",
    );
    return href ? (
      <Link
        href={href}
        aria-label={label}
        title={label}
        className={cn(
          shape,
          "focus-ring press border border-ink-200 bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-900",
        )}
      >
        {icon}
      </Link>
    ) : (
      <span
        aria-hidden
        className={cn(shape, "border border-ink-200 bg-white text-ink-200")}
      >
        {icon}
      </span>
    );
  };

  return (
    <span className="inline-flex">
      {arrow(prevHref, prevLabel, <ChevronUp className="size-4" />, "start")}
      {arrow(nextHref, nextLabel, <ChevronDown className="size-4" />, "end")}
    </span>
  );
}
