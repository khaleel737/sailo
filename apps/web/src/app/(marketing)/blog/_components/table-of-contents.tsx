"use client";

import { useEffect, useState } from "react";
import { ListTree } from "lucide-react";
import type { Heading } from "@/lib/blog-toc";
import { cn } from "@sailo/design-system/web/cn";

/**
 * The article's sections, and where the reader currently is in them.
 *
 * The single change that makes a two-thousand-word post readable. Without one,
 * a long article is a scroll bar and a hope; with one, a reader who came from
 * search for the third of eight sections can get there, and a reader deciding
 * whether to start can see what they are committing to.
 *
 * **The active state is the half that matters.** A list of links is a table of
 * contents; a list of links that knows where you are is a map. It is also the
 * part that is easy to get subtly wrong, which is what the observer below is
 * about.
 */

/**
 * Why an IntersectionObserver and not a scroll handler.
 *
 * A scroll handler asking `getBoundingClientRect()` of forty headings runs on
 * every frame of every scroll and forces layout each time — on a long article
 * that is the difference between a page that scrolls at 60fps and one that
 * stutters on a mid-range phone. The observer does the same work in the
 * browser's own compositor and calls back only when something crosses.
 *
 * The `rootMargin` is the trick that makes it read correctly. A plain
 * observer reports a heading as visible the moment it enters the viewport
 * from the bottom, so scrolling down highlights the *next* section while the
 * reader is still in the middle of the current one. Shrinking the observation
 * band to a thin strip below the sticky header means "active" is the heading
 * the reader has actually scrolled past, which is what they expect.
 */
const BAND = "-88px 0px -70% 0px";

export function TableOfContents({
  headings,
  label,
  className,
}: {
  headings: Heading[];
  label: string;
  className?: string;
}) {
  const [active, setActive] = useState<string>(headings[0]?.id ?? "");

  useEffect(() => {
    if (headings.length === 0) return;

    const seen = new Map<string, boolean>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          seen.set(entry.target.id, entry.isIntersecting);
        }
        /*
         * The first heading inside the band wins, in document order.
         *
         * Not "the last one that fired": entries arrive in whatever order the
         * browser batched them, so keying off the most recent callback makes
         * the highlight jump around when two headings cross in one frame —
         * which is exactly what a fast scroll does.
         */
        const current = headings.find((h) => seen.get(h.id));
        if (current) setActive(current.id);
      },
      { rootMargin: BAND, threshold: 0 },
    );

    for (const heading of headings) {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav aria-labelledby="toc-label" className={className}>
      <p
        id="toc-label"
        className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[var(--mute-400)]"
      >
        <ListTree className="size-3.5" aria-hidden />
        {label}
      </p>
      <ul className="mt-3 space-y-0.5 border-s border-[var(--mute-200)]">
        {headings.map((heading) => {
          const current = heading.id === active;
          return (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                /*
                 * `aria-current="location"` and not `"page"`. The reader is on
                 * one page; this says which part of it — which is precisely
                 * what the `location` token means, and the only one a screen
                 * reader will announce correctly here.
                 */
                aria-current={current ? "location" : undefined}
                className={cn(
                  /*
                   * `pointer-coarse:min-h-11` rather than a taller row for
                   * everyone. A mouse rewards the density — a twelve-section
                   * map that needs scrolling is a map nobody reads — and a
                   * finger does not: anything under 44pt is a mis-tap, which
                   * here means being thrown to the wrong part of the article.
                   */
                  "focus-line -ms-px flex items-center border-s-2 py-1.5 text-[0.8125rem] leading-[1.45] transition-colors pointer-coarse:min-h-11",
                  heading.level === 3 ? "ps-6" : "ps-3.5",
                  current
                    ? "border-[var(--ink)] font-medium text-[var(--ink)]"
                    : "border-transparent text-[var(--mute-500)] hover:border-[var(--mute-300)] hover:text-[var(--ink)]",
                )}
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The same list, folded away, for the width where there is no rail to put it
 * in.
 *
 * A `<details>` rather than a state-driven panel, and closed by default. On a
 * phone the article itself is what the reader came for, and an open list of
 * twelve sections is a screenful of navigation between them and the first
 * paragraph. `<details>` also means it works before hydration and that the
 * browser's own find-in-page can open it.
 *
 * No scroll-spy here on purpose: the panel is shut while reading, so there is
 * nothing for an active state to tell anybody, and the observer would be
 * running for a list nobody can see.
 */
export function TableOfContentsDisclosure({
  headings,
  label,
  className,
}: {
  headings: Heading[];
  label: string;
  className?: string;
}) {
  if (headings.length === 0) return null;

  return (
    <details
      className={cn(
        "group rounded-[var(--r-card)] border border-[var(--mute-200)] bg-[var(--paper-sunk)]",
        className,
      )}
    >
      {/* `min-h-11` unconditionally: this control only exists below `lg`, so
          the pointer opening it is a finger by construction. */}
      <summary className="focus-line flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[0.8125rem] font-medium text-[var(--ink)] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <ListTree className="size-3.5 text-[var(--mute-400)]" aria-hidden />
          {label}
        </span>
        <span
          aria-hidden
          className="text-[var(--mute-400)] transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <ul className="space-y-0.5 px-4 pb-4">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={cn(
                "focus-line flex min-h-11 items-center py-1.5 text-[0.8125rem] leading-[1.45] text-[var(--mute-600)]",
                heading.level === 3 && "ps-4",
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
