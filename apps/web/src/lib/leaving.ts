"use client";

import { useEffect, useState } from "react";

/* ===========================================================================
   Deliberate departures

   Leaving the page cancels whatever the page still had in flight, and one of
   those things is not a mistake we should ever show a buyer.

   `createOrderIntent` calls `revalidatePath`, so its Server Action response
   does not end when the return value arrives — Next keeps the stream open to
   deliver the re-rendered tree for the route the client is on. The checkout
   reads its result and immediately assigns `window.location.href` to hand the
   buyer to WhatsApp, which cancels that still-open stream.

   Chromium reports the cancellation as an abort and React ignores it. WebKit
   rejects the fetch with `TypeError: Load failed`, React takes that for a real
   failure while committing the router update, and the nearest boundary paints
   — so an iPhone shows "Something went wrong" for the second or two before
   Safari finishes leaving for WhatsApp. Which is exactly what it looked like:
   an error, and then the redirect working anyway.

   Nothing is actually lost. `revalidatePath` did its work on the server before
   the response began; the cancelled half is a re-render for a page that is
   being replaced. So the fix is to stop drawing an error about it, not to stop
   revalidating.

   Suppression is deliberately timed rather than permanent. If the departure
   does not happen — a handoff URL the OS refuses, a network that drops — the
   grace period lapses and the boundary paints the error after all, because at
   that point the buyer really is stuck on a broken page and needs to know.
=========================================================================== */

/**
 * How long after a departure an error is treated as its wake.
 *
 * Long enough to cover a slow phone finishing a navigation, short enough that
 * a departure which never happened still surfaces its error while the buyer is
 * looking at the screen.
 */
const GRACE_MS = 6_000;

/** When we last decided to leave, or 0. Module state — one page, one exit. */
let leftAt = 0;

/**
 * Whether the browser actually took the page away.
 *
 * This is the difference between a departure that worked and one that did not,
 * and it matters most in the case the grace period gets wrong. A buyer handed
 * to WhatsApp on a phone very often comes *back* a few seconds later to check
 * the message sent — and comes back to this same document, restored from the
 * back-forward cache with its React tree and this module intact. If
 * suppression had already lapsed on a timer, the error would paint on arrival:
 * the buyer returns from a successful order to a page insisting something
 * broke, which is worse than the bug being fixed.
 *
 * Being hidden is the proof. Nothing hides a page except the browser leaving
 * it, so once that has happened the cancelled stream is explained for good.
 */
let departed = false;

/**
 * Call immediately before handing the page to another URL or app.
 *
 * Only for navigations that genuinely leave. `mailto:` and `tel:` do not — the
 * page survives them, so an error after one of those is real.
 */
export function markLeaving() {
  leftAt = Date.now();

  /*
   * Both events, because neither covers this alone. `pagehide` is the one iOS
   * fires on the way into the back-forward cache; `visibilitychange` catches
   * the app-switch that hands over to WhatsApp without unloading anything.
   * Whichever arrives first is enough, and a second registration is harmless.
   */
  const seal = () => {
    departed = true;
  };
  window.addEventListener("pagehide", seal, { once: true });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") seal();
    },
    { once: true },
  );
}

/**
 * Whether a deliberate departure is still plausibly in progress.
 *
 * Re-renders itself once when the grace period ends, so a boundary that stayed
 * quiet gets a second chance to speak.
 */
export function useLeaving(): boolean {
  const [, tick] = useState(0);
  const withinGrace = leftAt !== 0 && Date.now() - leftAt < GRACE_MS;
  const leaving = leftAt !== 0 && (departed || withinGrace);

  useEffect(() => {
    // Only the grace period expires. Once `departed` is set nothing revokes it,
    // so there is no deadline left to wake up for.
    if (!withinGrace || departed) return;
    const remaining = GRACE_MS - (Date.now() - leftAt);
    const id = setTimeout(() => tick((n) => n + 1), Math.max(remaining, 0) + 50);
    return () => clearTimeout(id);
  }, [withinGrace]);

  return leaving;
}
