"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import type { Dictionary } from "@sailo/i18n";
import { cn } from "@/lib/utils";

/* ===========================================================================
   Error boundaries

   `error.tsx` has to be a Client Component, so it cannot await a dictionary,
   and Next passes it nothing but `error` and `retry`. The root layout is a
   Server Component that already has the visitor's locale, so it puts these
   five strings in context on the way past and every boundary in the app reads
   them from there — no dictionary in the client bundle, no English fallbacks.

   `global-error.tsx` is the one exception: it replaces the root layout, so the
   provider is gone by the time it renders and it carries its own English copy.
=========================================================================== */

type ErrorStrings = Dictionary["errors"];

const ENGLISH: ErrorStrings = {
  title: "Something went wrong",
  body: "This page didn't load. It is usually temporary, so trying again is worth a go.",
  retry: "Try again",
  home: "Go to the homepage",
  reference: "Reference",
};

/**
 * A store rather than a context, and that is the whole point.
 *
 * These strings used to arrive as `<ErrorStringsProvider value={t.errors}>`
 * wrapping the entire app from the root layout. Reading `t` meant awaiting the
 * visitor's locale, which meant awaiting cookies, above `{children}` — so no
 * page beneath it could ever be prerendered and every response in the product
 * was `Cache-Control: private, no-store`. One provider held the whole site out
 * of the CDN.
 *
 * Publishing sideways instead of wrapping breaks that. `<ErrorStringsSource>`
 * is a sibling of the page, not its parent, so it can stream in at its own
 * pace while the page around it prerenders.
 *
 * The strings still reach every boundary in time, because `error.tsx` is a
 * Client Component: React renders it after hydration, by which point the
 * effect below has run. Anything that somehow renders earlier gets English,
 * which is exactly what a missing provider gave before.
 */
let published: ErrorStrings = ENGLISH;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

const snapshot = () => published;
const serverSnapshot = () => ENGLISH;

/** Streamed in beside the page. Renders nothing. */
export function ErrorStringsSource({ value }: { value: ErrorStrings }) {
  useEffect(() => {
    published = value;
    for (const listener of listeners) listener();
  }, [value]);

  return null;
}

/**
 * The strings, or English if nothing has published them yet.
 *
 * Unlike `useAdminT`, this does not throw when they are missing. It is the one
 * hook whose whole job is to render when things have already gone wrong.
 */
function useErrorStrings(): ErrorStrings {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * What every `error.tsx` renders.
 *
 * The two actions are deliberately different in kind. `retry()` re-fetches and
 * re-renders the segment, which fixes the common case — a query that timed out,
 * a connection that dropped. The link out is for when it does not, so nobody
 * ends up on a page whose only button does nothing.
 *
 * `digest` is shown because it is the only thing that ties what the visitor saw
 * to the server log. It is a hash, not a stack trace — Next deliberately does
 * not forward server-side error messages to the browser, so there is nothing
 * here to leak.
 */
export function ErrorPanel({
  error,
  retry,
  homeHref = "/",
  className,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  /** Where "home" means from here — the shop for a storefront, / elsewhere. */
  homeHref?: string;
  className?: string;
}) {
  const t = useErrorStrings();

  useEffect(() => {
    // Server errors arrive already logged with this digest; client ones do not.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center px-4 py-16 text-center",
        className,
      )}
    >
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">
        {t.title}
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-500">{t.body}</p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={retry}
          className="focus-ring press inline-flex h-11 items-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
        >
          <RotateCw className="size-4" />
          {t.retry}
        </button>
        <Link
          href={homeHref}
          className="focus-ring inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-ink-500 transition hover:text-ink-900"
        >
          {t.home}
        </Link>
      </div>

      {error.digest ? (
        <p className="tabular mt-8 text-xs text-ink-400">
          {t.reference} {error.digest}
        </p>
      ) : null}
    </div>
  );
}
