"use client";

import { MapPin } from "lucide-react";
import { formatMoney } from "@sailo/core/currency";
import { initials } from "@sailo/design-system/initials";
import { readableOn } from "@sailo/design-system/web/cn";

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
  accentColor,
  avatarUrl,
  locale,
  fallbackName,
}: {
  handle: string;
  name: string;
  description: string;
  location: string;
  currency: string;
  /** Tints the avatar and the buy pill, the two places the storefront uses it. */
  accentColor: string;
  /** Object URL of the photo picked on the customize step, if any. */
  avatarUrl: string | null;
  /** Punctuates the sample price like the page around it. */
  locale: string;
  /** Stands in until the seller has typed a name. Translated by the caller. */
  fallbackName: string;
}) {
  const shopName = name.trim() || fallbackName;
  const monogram = initials(shopName);
  const onAccent = readableOn(accentColor);

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
        {avatarUrl ? (
          // Plain <img>: an object URL of a file still in the browser, which
          // next/image cannot fetch, let alone optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="size-14 rounded-full object-cover shadow-md"
          />
        ) : (
          <div
            className="flex size-14 items-center justify-center rounded-full text-sm font-semibold shadow-md transition-colors duration-300"
            style={{ backgroundColor: accentColor, color: onAccent }}
          >
            {monogram || "S"}
          </div>
        )}
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

        {/* One placeholder product, so the currency and the colour both have
            somewhere to land — the price wears the accent the way the real
            storefront's buy button does. */}
        <div className="mt-4 w-full rounded-xl border border-ink-200 p-2">
          <div className="h-14 rounded-lg bg-gradient-to-br from-ink-100 to-ink-200" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="h-2 w-14 rounded-full bg-ink-200" />
            <span
              className="tabular rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors duration-300"
              style={{ backgroundColor: accentColor, color: onAccent }}
            >
              {formatMoney(2800, currency, locale)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
