"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { cn } from "@sailo/design-system/web/cn";

/**
 * What a staff member sees when a page throws.
 *
 * apps/web has its own `ErrorPanel` and this is deliberately not it. That one
 * carries a subscribe/snapshot store to get translated strings into a Client
 * Component without awaiting a locale cookie above `{children}` — because doing
 * so would have held the entire site out of the CDN. It is a careful answer to
 * a real problem, and the problem is one this app does not have: HQ is English,
 * has no locale cookie, and does not enable `cacheComponents`, so there is
 * nothing to prerender and nothing to keep out of the way of it.
 *
 * It also drops `useLeaving`. That exists so a storefront navigating away
 * mid-checkout doesn't flash a failure at a buyer whose payment actually
 * succeeded. Nothing here is a checkout and nobody here is a buyer.
 *
 * What is left is the part that was always the point: say what happened, offer
 * the retry Next hands us, and print the digest so the line in Sentry and the
 * line on the screen can be matched to each other.
 */
export function ErrorPanel({
  error,
  retry,
  className,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  className?: string;
}) {
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
        Something went wrong
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-500">
        This page didn&apos;t load. It is usually temporary, so trying again is
        worth a go.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={retry}
          className="focus-ring press inline-flex h-11 items-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
        >
          <RotateCw className="size-4" />
          Try again
        </button>
        <Link
          href="/"
          className="focus-ring inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-ink-500 transition hover:text-ink-900"
        >
          Back to the panel
        </Link>
      </div>

      {/*
       * The digest is the only thread between what a colleague saw and what
       * Sentry recorded — Next replaces the real error with an opaque one
       * before it reaches the browser, so without this the report and the
       * screenshot cannot be matched up.
       */}
      {error.digest ? (
        <p className="tabular mt-8 text-xs text-ink-400">
          Reference {error.digest}
        </p>
      ) : null}
    </div>
  );
}
