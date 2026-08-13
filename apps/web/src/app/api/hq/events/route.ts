import { requireStaff } from "@/lib/session";
import { subscribeHqEvents } from "@sailo/events";
import { eventStreamResponse } from "@sailo/events/stream";

/**
 * The staff panel's ear: platform-wide change hints, already folded and
 * rate-shaped by the bus (see `HQ_GATE_SECONDS` in events.ts).
 *
 * `requireStaff` answers a stranger with the same 404 the /hq pages do, and
 * EventSource gives up on it permanently — no retry loop hammering a door
 * that will not open.
 */

export const maxDuration = 300;

export async function GET(request: Request) {
  await requireStaff();

  return eventStreamResponse(
    (onEvent, onLost) => subscribeHqEvents(onEvent, onLost),
    request.signal,
  );
}
