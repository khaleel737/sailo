import { requireShop } from "@/lib/session";
import { subscribeShopEvents } from "@sailo/events";
import { eventStreamResponse } from "@sailo/events/stream";

/**
 * The seller dashboard's ear: one stream per open /admin tab, carrying
 * change hints for that seller's shop and nothing else.
 *
 * Authentication is the page's own: `requireShop` redirects a signed-out
 * caller, and EventSource treats the HTML it lands on as a dead connection
 * and stops — which is the right end state for a tab whose session expired.
 * The channel is the session's shop, never a parameter, so there is nothing
 * here to point at someone else's shop.
 */

// The stream closes itself around four minutes (see event-stream.ts) and
// the browser reconnects; this is the platform ceiling it stays under.
export const maxDuration = 300;

export async function GET(request: Request) {
  const { shop } = await requireShop();

  return eventStreamResponse(
    (onEvent, onLost) => subscribeShopEvents(shop.id, onEvent, onLost),
    request.signal,
  );
}
