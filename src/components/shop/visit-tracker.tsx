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
