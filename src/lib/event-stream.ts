import "server-only";
import type { BusEvent, EventSubscription } from "@/lib/events";

/**
 * The response half of the realtime bus: one long-lived `text/event-stream`
 * per open dashboard tab, fed by a bus subscription.
 *
 * SSE rather than WebSockets on purpose. The traffic is strictly one-way —
 * the server says "something changed", the client re-reads through the
 * ordinary page — and for that shape EventSource gives reconnection with
 * backoff, `retry:` tuning, and proxy friendliness for free, where a socket
 * would hand us all of that to rebuild plus an upgrade dance on every hop.
 *
 * The stream deliberately carries hints, not data. Nothing here is
 * personal, nothing here is money; leaking the entire stream to the wrong
 * ear would reveal only that *something* about a shop changed. The reads
 * that follow still pass through the same session checks every page load
 * passes through.
 *
 * Lifetime is bounded. Serverless platforms cap a response's duration, so
 * rather than being killed mid-heartbeat at the platform's deadline the
 * stream closes itself a little early, cleanly, and the browser reconnects.
 * The close is jittered so a fleet of dashboards that all connected at a
 * deploy doesn't come back as one synchronized stampede. That rhythm is
 * also the safety net: every reconnect is a catch-up refresh on the client,
 * so even a lost event is stale for at most one stream lifetime.
 */

/** Comfortably inside the route's `maxDuration = 300`. */
const LIFETIME_MS = 240_000;
const LIFETIME_JITTER_MS = 30_000;

/**
 * Often enough that no proxy on the path mistakes the stream for idle and
 * folds it; rare enough to be free.
 */
const HEARTBEAT_MS = 20_000;

/** How quickly the browser should come back, with EventSource's own backoff on top. */
const RETRY_MS = 3_000;

export type SubscribeFn = (
  onEvent: (event: BusEvent) => void,
  onLost: () => void,
) => Promise<EventSubscription>;

/**
 * Builds the streaming response. The caller has already authenticated and
 * chosen which channel `subscribe` binds to — this function only speaks the
 * wire format and owns the lifecycle.
 */
export async function eventStreamResponse(
  subscribe: SubscribeFn,
  signal: AbortSignal,
): Promise<Response> {
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let subscription: EventSubscription | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let deadline: ReturnType<typeof setTimeout> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (deadline) clearTimeout(deadline);
        signal.removeEventListener("abort", close);
        // Detaching the bus listener and the Redis subscriber is the part
        // that must not be skipped — a leaked subscriber is a connection
        // held until the process dies.
        void subscription?.close();
        try {
          controller.close();
        } catch {
          // Already closed by the other side; that is a fine way to end.
        }
      };
      cleanup = close;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The consumer is gone but abort hasn't fired yet; stop cleanly
          // rather than throwing into the runtime.
          close();
        }
      };

      /*
       * Subscribe before saying hello: events between the subscription and
       * the greeting are delivered, where the other order has a gap.
       */
      subscription = await subscribe(
        (event) => write(`event: change\ndata: ${JSON.stringify(event)}\n\n`),
        /*
         * Push delivery died under us. Ending the stream is more honest
         * than staying open and deaf: the browser reconnects within
         * seconds into whatever mode is then available, and the reconnect
         * refresh covers anything missed while the ear was down.
         */
        close,
      );

      if (signal.aborted) {
        close();
        return;
      }
      signal.addEventListener("abort", close);

      /*
       * `mode` tells the client what this stream can promise. "live" means
       * cross-instance push; "local" means this process only — the client
       * should poll gently to cover writes that happen elsewhere, which is
       * also what makes development-without-Redis behave like production.
       */
      write(
        `retry: ${RETRY_MS}\n\nevent: mode\ndata: ${JSON.stringify({
          live: subscription.live,
        })}\n\n`,
      );

      heartbeat = setInterval(() => write(`: hb\n\n`), HEARTBEAT_MS);
      deadline = setTimeout(
        close,
        LIFETIME_MS + Math.floor(Math.random() * LIFETIME_JITTER_MS),
      );
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // `no-transform` matters as much as `no-cache`: a compressing proxy
      // that buffers to gzip would hold events until its window fills.
      "cache-control": "no-cache, no-transform",
      // Belt and braces for nginx-shaped middleboxes.
      "x-accel-buffering": "no",
    },
  });
}
