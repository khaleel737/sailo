"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The client half of the realtime bus: listens to a change-hint stream and
 * turns hints into `router.refresh()`.
 *
 * That one call is the entire trick. Every panel in this app is a Server
 * Component re-reading Postgres per request, so a refresh re-renders the
 * page *and* the layout around it — order lists, charts, the notification
 * bell, the sidebar badges — through the same session checks as always,
 * without touching client state like an open dropdown or scroll position.
 * Nothing on the wire is data; the wire only says "worth re-reading".
 *
 * What keeps this from becoming a refresh storm:
 *
 *   - Bursts coalesce. A webhook settling an order fires order + payment
 *     within milliseconds; a short gather window turns that into one
 *     refresh, and a floor between refreshes keeps a hostile stream from
 *     commanding more than one every few seconds.
 *   - Visits ride a longer fuse. They are already gated per shop on the
 *     server; the extra patience here means a busy storefront reads as a
 *     dashboard that ticks, not one that shivers.
 *   - A hidden tab does nothing. Refreshing a page nobody is looking at
 *     spends a server render to update pixels the OS won't paint; the tab
 *     notes that it owes a refresh and pays when it next becomes visible.
 *     Hidden long enough, it hangs up the stream entirely — a wall of
 *     backgrounded dashboards must not hold a wall of open connections —
 *     and reopens on return.
 *   - Money refreshes echo once. Dashboards read from replicas, and a
 *     replica may not yet have the row the event announced; a second
 *     refresh a few seconds later closes that window without anyone
 *     noticing it happened.
 *   - Every reconnect is a catch-up. The server ends each stream after a
 *     few minutes by design, and events can die with a cold Redis; the
 *     refresh-on-reconnect turns both into "stale for one stream lifetime,
 *     at worst". When the server says it can only hear its own process
 *     ("local" mode), a gentle poll covers the rest.
 *
 * Renders nothing, needs nothing, and — deliberately — imports nothing but
 * React and the router: this file must stay importable from any client
 * tree without dragging server modules with it.
 */

/** Gather window for human-frequency events (orders, reviews, …). */
const SOON_MS = 300;
/** Gather window for visit ticks, on top of the server's per-shop gate. */
const VISIT_MS = 4_000;
/** Hard floor between two refreshes, whatever the stream says. */
const MIN_GAP_MS = 2_500;
/** The replica-lag echo: one repeat, this long after a money refresh. */
const ECHO_MS = 5_000;
/** Poll cadence when the stream can only hear its own process. */
const POLL_MS = 45_000;
/** How long a tab may sit hidden before the stream is hung up. */
const HIDDEN_HANGUP_MS = 300_000;
/** Manual retry after EventSource declares the connection dead for good. */
const RETRY_DEAD_MS = 60_000;

export function LiveRefresh({ url }: { url: string }) {
  const router = useRouter();

  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;

    /** Epoch ms of the pending refresh, or null. */
    let plannedAt: number | null = null;
    let plannedTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshAt = 0;
    /** A hidden tab owes the refresh it suppressed. */
    let owed = false;
    /** The pending refresh includes a non-visit event, so echo after it. */
    let echoWanted = false;
    let everOpened = false;

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let hangupTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshNow = () => {
      plannedAt = null;
      plannedTimer = null;
      if (document.hidden) {
        owed = true;
        return;
      }
      lastRefreshAt = Date.now();
      startTransition(() => router.refresh());
      if (echoWanted) {
        echoWanted = false;
        schedule(ECHO_MS);
      }
    };

    /**
     * One pending refresh at a time, at the earliest deadline asked for,
     * but never closer than MIN_GAP_MS after the previous one ran.
     */
    const schedule = (delay: number) => {
      if (disposed) return;
      const at = Math.max(Date.now() + delay, lastRefreshAt + MIN_GAP_MS);
      if (plannedAt !== null && plannedAt <= at) return;
      if (plannedTimer) clearTimeout(plannedTimer);
      plannedAt = at;
      plannedTimer = setTimeout(refreshNow, at - Date.now());
    };

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const disconnect = () => {
      source?.close();
      source = null;
      stopPolling();
    };

    const connect = () => {
      if (disposed || source) return;
      const es = new EventSource(url);
      source = es;

      es.addEventListener("open", () => {
        if (disposed) return;
        /*
         * Anything could have happened while there was no ear: the first
         * stream of this tab's life is the one case where the page render
         * itself was the catch-up.
         */
        if (everOpened) {
          echoWanted = true;
          schedule(0);
        }
        everOpened = true;
      });

      es.addEventListener("change", (event) => {
        let kind = "";
        try {
          kind = (JSON.parse((event as MessageEvent<string>).data) as {
            kind?: string;
          }).kind ?? "";
        } catch {
          // An unreadable hint is still a hint.
        }
        if (kind === "visit") {
          schedule(VISIT_MS);
        } else {
          echoWanted = true;
          schedule(SOON_MS);
        }
      });

      es.addEventListener("mode", (event) => {
        let live = true;
        try {
          live = (JSON.parse((event as MessageEvent<string>).data) as {
            live?: boolean;
          }).live !== false;
        } catch {
          // Assume the stronger mode; the reconnect rhythm still bounds
          // staleness either way.
        }
        stopPolling();
        if (!live) {
          // Jittered so a fleet of local-mode tabs doesn't poll in step.
          pollTimer = setInterval(
            () => schedule(0),
            POLL_MS + Math.floor(Math.random() * 10_000),
          );
        }
      });

      es.addEventListener("error", () => {
        if (disposed || !source) return;
        /*
         * CONNECTING means the browser is already retrying and needs no
         * help. CLOSED is EventSource giving up for good — an auth
         * redirect, a 5xx — and deserves patience, not a loop: one quiet
         * attempt a minute either heals a blip or costs almost nothing
         * against a door that stays shut.
         */
        if (source.readyState === EventSource.CLOSED) {
          disconnect();
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(connect, RETRY_DEAD_MS);
        }
      });
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (hangupTimer) clearTimeout(hangupTimer);
        hangupTimer = setTimeout(disconnect, HIDDEN_HANGUP_MS);
        return;
      }
      if (hangupTimer) clearTimeout(hangupTimer);
      hangupTimer = null;
      if (!source) {
        // The stream was hung up while hidden; whatever it would have
        // said is unknown, so reopening owes a refresh.
        owed = true;
        connect();
      }
      if (owed) {
        owed = false;
        echoWanted = true;
        schedule(0);
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      disconnect();
      if (plannedTimer) clearTimeout(plannedTimer);
      if (hangupTimer) clearTimeout(hangupTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [router, url]);

  return null;
}
