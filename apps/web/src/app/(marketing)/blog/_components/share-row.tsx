"use client";

import { useEffect, useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";

/**
 * The three places a post actually gets shared from, and a copy button.
 *
 * Deliberately not a share-widget library. Every one of them loads a script
 * from a third party, which on a page under this site's CSP would have to be
 * allowed through, and each of those scripts sets a cookie for a company the
 * reader has no relationship with. These are four links and a clipboard call.
 *
 * The networks are chosen rather than exhaustive: X, LinkedIn and WhatsApp are
 * where a post about running a small shop is passed on, and WhatsApp in
 * particular is where most of this audience's sharing actually happens — a
 * "share" row without it, on a product whose whole premise is selling in the
 * DMs, would be a row designed for a different audience.
 */

/** `share-*` URLs, built by hand so nothing is guessed at render time. */
function targets(url: string, title: string) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return [
    { id: "x", label: "X", href: `https://x.com/intent/post?url=${u}&text=${t}` },
    {
      id: "linkedin",
      label: "LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/?text=${t}%20${u}`,
    },
  ] as const;
}

export function ShareRow({
  url,
  title,
  labels,
  /** The rail lays these out in a row under a heading; inline is a single line. */
  variant = "inline",
  className,
}: {
  url: string;
  title: string;
  labels: { share: string; copyLink: string; copied: string };
  variant?: "inline" | "rail";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  /*
   * The confirmation clears itself, and the timer is cleaned up.
   *
   * Without the cleanup, a reader who copies and immediately navigates leaves
   * a pending `setState` against an unmounted component — harmless today,
   * noisy in the console, and the exact shape of bug that becomes real the
   * moment this component is ever rendered inside something that suspends.
   */
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /*
       * Clipboard access is refused in more situations than people expect —
       * an insecure origin, a browser policy, a permission the reader denied
       * — and there is nothing useful to say about any of them. The URL is in
       * the address bar; the button simply does not confirm.
       */
    }
  }

  const chip =
    "focus-line inline-flex h-9 items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--mute-200)] px-3 text-[0.75rem] text-[var(--mute-600)] transition-colors hover:border-[var(--mute-300)] hover:text-[var(--ink)] pointer-coarse:h-11";

  return (
    <div className={className}>
      {variant === "rail" ? (
        <p className="mb-3 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[var(--mute-400)]">
          {labels.share}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {variant === "inline" ? (
          <span className="me-1 inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-[var(--mute-400)]">
            <Share2 className="size-3.5" aria-hidden />
            {labels.share}
          </span>
        ) : null}

        {targets(url, title).map((target) => (
          <a
            key={target.id}
            href={target.href}
            target="_blank"
            /*
             * `noopener` for the usual reason, and `nofollow` because a share
             * intent is not an endorsement of the network — without it, 260
             * articles each pass link equity to three social domains.
             */
            rel="noopener noreferrer nofollow"
            className={chip}
          >
            {target.label}
          </a>
        ))}

        <button type="button" onClick={copy} className={chip}>
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Link2 className="size-3.5" aria-hidden />
          )}
          {copied ? labels.copied : labels.copyLink}
        </button>
      </div>

      {/*
        The copy confirmation, announced rather than only shown.

        The button's own label changes, which a sighted reader sees — but a
        screen-reader user who has already moved focus on would hear nothing at
        all. `aria-live="polite"` says it once, without interrupting.
      */}
      <span aria-live="polite" className="sr-only">
        {copied ? labels.copied : ""}
      </span>
    </div>
  );
}
