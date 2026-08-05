"use client";

import { CartProvider } from "./cart-provider";
import { CartButton } from "./cart-button";
import { CartSheet } from "./cart-sheet";
import type { CheckoutDelivery, CheckoutMethod } from "./checkout-panel";
import type { Dictionary } from "@/i18n";
import { shopThemeVars } from "@/lib/utils";

/**
 * Wraps a storefront page in its basket: the provider the buttons talk to, the
 * pill that follows the buyer down the page, and the drawer it opens.
 *
 * The page's own content is passed through untouched, so it stays a server
 * component and only the basket ships as JavaScript.
 */
export function CartRegion({
  shopId,
  shopName,
  currency,
  theme,
  accentColor,
  dir,
  locale,
  methods,
  deliveryOptions,
  contactEmail,
  t,
  children,
}: {
  shopId: string;
  shopName: string;
  currency: string;
  /** light | dark */
  theme: string;
  accentColor: string;
  dir: string;
  locale: string;
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  contactEmail: string | null;
  t: Dictionary;
  children: React.ReactNode;
}) {
  return (
    <CartProvider shopId={shopId}>
      {children}

      {/*
        The basket floats above the page rather than inside it, so it needs its
        own copy of the shop's palette and text direction — the surface colours
        are CSS variables scoped to `[data-surface]`, and without this wrapper
        the drawer renders with no background at all.
      */}
      <div
        data-surface={theme === "dark" ? "dark" : "light"}
        dir={dir}
        lang={locale}
        style={shopThemeVars(accentColor)}
      >
        <CartButton currency={currency} t={t} />
        <CartSheet
          shopId={shopId}
          shopName={shopName}
          currency={currency}
          methods={methods}
          deliveryOptions={deliveryOptions}
          contactEmail={contactEmail}
          t={t}
        />
      </div>
    </CartProvider>
  );
}
