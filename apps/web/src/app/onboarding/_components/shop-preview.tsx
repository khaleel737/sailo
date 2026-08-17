"use client";

import { MapPin } from "lucide-react";
import { formatMoney } from "@sailo/core/currency";

/**
 * The shop being described, as it will look. It updates on every keystroke, so
 * the three abstract questions in the form have something concrete attached to
 * them — the flow stops feeling like data entry around step two.
 */
export function ShopPreview({
  handle,
  name,
  description,
  location,
  currency,
  locale,
  fallbackName,
}: {
  handle: string;
  name: string;
  description: string;
  location: string;
  currency: string;
  /** Punctuates the sample price like the page around it. */
  locale: string;
  /** Stands in until the seller has typed a name. Translated by the caller. */
  fallbackName: string;
}) {
  const shopName = name.trim() || fallbackName;
  const initials = shopName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
      {/* Address bar — the thing they are actually claiming. */}
      <div className="flex items-center gap-1.5 border-b border-ink-200 bg-ink-50 px-3 py-2">
        <span className="flex gap-1">
          {["bg-red-300", "bg-amber-300", "bg-emerald-300"].map((tint) => (
            <span key={tint} className={`size-2 rounded-full ${tint}`} />
          ))}
        </span>
        <span className="ms-1.5 truncate text-[11px] text-ink-500">
          sailo.store/
          <span className="font-semibold text-ink-900">{handle || "…"}</span>
        </span>
      </div>

      <div className="flex flex-col items-center px-4 pb-4 pt-5 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-semibold text-white shadow-md">
          {initials || "S"}
        </div>
        <p className="mt-2.5 truncate text-sm font-bold tracking-tight text-ink-900">
          {shopName}
        </p>
        {description.trim() ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink-500">
            {description}
          </p>
        ) : null}
        {location.trim() ? (
          <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-ink-400">
            <MapPin className="size-2.5" />
            {location}
          </p>
        ) : null}

        {/* One placeholder product, so the currency choice has somewhere to land. */}
        <div className="mt-4 w-full rounded-xl border border-ink-200 p-2">
          <div className="h-14 rounded-lg bg-gradient-to-br from-ink-100 to-ink-200" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="h-2 w-14 rounded-full bg-ink-200" />
            <span className="tabular text-[11px] font-semibold text-ink-900">
              {formatMoney(2800, currency, locale)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
