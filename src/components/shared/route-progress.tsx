"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * How long a navigation may take before it is worth telling anyone about.
 *
 * Most navigations here are prefetched and commit in well under this, and a
 * bar that flashes on every click reads as jank rather than as feedback.
 */
const SHOW_AFTER_MS = 120;

/**
 * If a click never produces a navigation — a handler called `preventDefault`,
 * the server hung — the bar has to let go on its own rather than sit there.
 *
 * A capture-phase listener cannot tell those apart at click time: it runs
 * before the element's own handlers, so `defaultPrevented` is always false,
 * and moving to the bubble phase does not help because `<Link>` cancels the
 * event too. So the bar times out instead. Eight seconds is longer than any
 * navigation worth waiting for and short enough that a stuck bar is a blip.
 */
const GIVE_UP_MS = 8_000;

/** The part of the URL a route change is visible in. Fragments are not it. */
function routeKey(url: { pathname: string; search: string }) {
  return url.pathname + url.search;
}

type State = "idle" | "loading" | "done";

/**
 * The hairline that runs across the top of the viewport during a navigation.
 *
 * Next 16 has no global "a navigation is in flight" signal. `useLinkStatus`
 * is per-`<Link>` and has to be rendered inside one, so it cannot drive a bar
 * that lives in the root layout. What is observable from up here is:
 *
 *   start   a click on an in-app anchor, caught in the capture phase before
 *           the router sees it, plus `popstate` for back and forward
 *   finish  `usePathname()` / `useSearchParams()` changing, which is exactly
 *           when the new route commits — including when it commits to a
 *           `loading.tsx` fallback, at which point the skeleton takes over
 *           and the bar has nothing left to say
 *
 * Programmatic `router.push` from a client component is not covered, and is
 * not meant to be: the four places this app does that (the storefront filter
 * bar, the HQ filters, the two post-auth redirects) each already own a pending
 * state on the control that triggered them.
 */
export function RouteProgress({ label }: { label: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = search ? `${pathname}?${search}` : pathname;

  const [state, setState] = useState<State>("idle");

  /* The URL the bar believes is on screen. A ref, not state: it is written
     from inside the effect that reacts to it, and as state that would loop. */
  const committed = useRef(url);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    const start = () => {
      clearTimers();
      timers.current.push(
        window.setTimeout(() => setState("loading"), SHOW_AFTER_MS),
        window.setTimeout(() => {
          setState("idle");
          clearTimers();
        }, GIVE_UP_MS),
      );
    };

    const onClick = (event: MouseEvent) => {
      // Anything but a plain primary click is the browser's business: a new
      // tab, a download, a context menu. None of them navigate this document.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      let next: URL;
      try {
        next = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (next.origin !== window.location.origin) return;

      // Same page, or a jump to an anchor on it — no route change, no bar.
      const here = window.location;
      if (next.pathname === here.pathname && next.search === here.search) return;

      start();
    };

    /*
     * Back and forward have no click to catch, and are the slowest navigations
     * in the app because nothing on the way back was prefetched.
     *
     * The guard is load-bearing rather than defensive: the App Router fires a
     * synthetic `popstate` when it handles an in-page fragment jump, and that
     * changes no route. Starting on it left the bar running with nothing that
     * could ever finish it.
     */
    const onPopState = () => {
      if (routeKey(window.location) === committed.current) return;
      start();
    };

    // Belt and braces for the same case: if a fragment jump ever does start
    // the bar, this puts it away immediately rather than after the timeout.
    const onHashChange = () => {
      if (routeKey(window.location) !== committed.current) return;
      clearTimers();
      setState("idle");
    };

    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (url === committed.current) return;
    committed.current = url;
    clearTimers();

    /* Nothing was ever shown — a fast navigation beat SHOW_AFTER_MS. Drop
       straight back to idle so no bar paints at all. */
    setState((current) => (current === "loading" ? "done" : "idle"));

    // Let the completion animation finish before arming the bar again.
    timers.current.push(window.setTimeout(() => setState("idle"), 500));
  }, [url]);

  return (
    <>
      {/* The visible half: decorative, so it is hidden from the reader. */}
      <div aria-hidden className="route-progress" data-state={state} />
      {/*
        The announced half. The live region is the element itself rather than a
        `display: contents` wrapper around it — some screen readers drop
        regions they cannot compute a box for.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {state === "loading" ? label : ""}
      </span>
    </>
  );
}
