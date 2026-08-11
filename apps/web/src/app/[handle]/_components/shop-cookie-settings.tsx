"use client";

import { useCallback } from "react";
import { clearShopConsent } from "@/lib/shop-consent";

/**
 * Reopens this shop's consent request, from the storefront footer.
 *
 * Withdrawing has to be as easy as giving. Forgetting the stored answer is
 * the whole mechanism — the banner asks again because there is no answer,
 * and the tags unmount on the same event, so nothing further is measured
 * from the click. A button, not a link: it changes state here and navigates
 * nowhere.
 */
export function ShopCookieSettings({
  shopId,
  label,
}: {
  shopId: string;
  label: string;
}) {
  const reopen = useCallback(() => clearShopConsent(shopId), [shopId]);

  return (
    <button
      type="button"
      onClick={reopen}
      className="text-muted focus-ring-accent inline-flex min-h-11 items-center rounded text-xs transition hover:opacity-70"
    >
      {label}
    </button>
  );
}
