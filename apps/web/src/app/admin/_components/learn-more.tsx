"use client";

import { interpolate } from "@sailo/i18n";
import { useAdminT } from "./admin-i18n";

/**
 * The quiet line every Shopify page ends on — `Learn more about <topic>` —
 * adopted as a rule (spec 01): a page's last word points at its docs.
 *
 * `topic` is the page's own translated title, passed in rather than looked
 * up, so the sentence always names the page in the reader's language. The
 * href lands on the docs site the sidebar already links.
 */
export function LearnMore({ topic, href }: { topic: string; href: string }) {
  const a = useAdminT();
  return (
    <p className="mt-10 text-center">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring rounded text-xs font-medium text-ink-400 transition hover:text-ink-700 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
      >
        {interpolate(a.common.learnMore, { topic })}
      </a>
    </p>
  );
}
