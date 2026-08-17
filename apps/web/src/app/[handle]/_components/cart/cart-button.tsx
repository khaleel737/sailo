"use client";

import { ShoppingBag } from "lucide-react";
import { useCart } from "./cart-provider";
import { formatMoney } from "@sailo/core/currency";
import { interpolate } from "@sailo/i18n";
import type { Dictionary } from "@sailo/i18n";

/**
 * The basket, pinned to the bottom of every page of the shop.
 *
 * It exists only when there's something in it: an empty shop shows nothing at
 * all, and the moment a buyer adds their first item the bar rises into place
 * and stays there while they keep browsing. It sits above the safe area so a
 * phone's home indicator doesn't cut it in half.
 */
export function CartButton({
  currency,
  t,
}: {
  currency: string;
  t: Dictionary;
}) {
  const cart = useCart();

  // Hidden until hydration so the server's empty basket never flashes a bar.
  if (!cart?.ready || cart.count === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => cart.setOpen(true)}
        aria-label={interpolate(t.cart.itemCount, { count: cart.count })}
        className="accent-bg animate-rise pointer-events-auto flex h-12 items-center gap-3 rounded-full px-5 text-sm font-semibold shadow-lg transition hover:opacity-95 active:scale-[0.99]"
      >
        <span className="relative flex items-center">
          <ShoppingBag className="size-5" />
          <span className="absolute -end-2 -top-2 flex size-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black">
            {cart.count > 9 ? "9+" : cart.count}
          </span>
        </span>
        <span>{t.cart.view}</span>
        <span className="tabular-nums opacity-80">
          {formatMoney(cart.cachedTotalCents, currency, cart.locale)}
        </span>
      </button>
    </div>
  );
}
