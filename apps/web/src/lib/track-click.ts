import type { ClickKind } from "@/db/schema";

/**
 * Fire-and-forget outbound click beacon.
 *
 * `sendBeacon` first, because the click that matters most is the one that
 * navigates away — the browser owns a beacon's delivery and keeps it alive
 * through the unload, where an ordinary fetch is cancelled with the page.
 * `keepalive` fetch is the fallback for browsers without it (and for the rare
 * false return when the beacon queue is full).
 *
 * The full URL is posted; the server derives and stores only the host — see
 * `outboundHost` and the `clicks` table for why.
 */
export function trackClick(shopId: string, url: string, kind: ClickKind) {
  const body = JSON.stringify({ type: "click", shopId, url, kind });

  try {
    if (navigator.sendBeacon?.("/api/track", body)) return;
  } catch {
    // Some browsers throw on exotic payloads rather than returning false.
  }

  fetch("/api/track", { method: "POST", body, keepalive: true }).catch(
    () => {},
  );
}
