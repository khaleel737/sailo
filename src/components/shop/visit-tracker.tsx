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
      body: JSON.stringify({ shopId, productId }),
      keepalive: true,
    }).catch(() => {});
  }, [shopId, productId]);

  return null;
}
