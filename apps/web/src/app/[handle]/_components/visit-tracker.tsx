"use client";

import { useEffect, useRef } from "react";

/** Fire-and-forget pageview beacon. One per mount, failures are ignored. */
export function VisitTracker({
  shopId,
  productId,
}: {
  shopId: string;
  productId?: string;
}) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    // A browser driven by automation — a crawler, a link-preview renderer, a
    // synthetic monitor — sets `navigator.webdriver`. Skipping the beacon keeps
    // its pageview out of the seller's numbers even when it wears an ordinary
    // desktop user-agent, which is the one case the server's UA screen misses.
    if (typeof navigator !== "undefined" && navigator.webdriver) return;

    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `document.referrer` is the only place the real referring page exists;
      // the server sees only its own URL in the `Referer` header.
      body: JSON.stringify({
        shopId,
        productId,
        referrer: document.referrer || null,
        url: window.location.href,
      }),
      keepalive: true,
    }).catch(() => {});
  }, [shopId, productId]);

  return null;
}
