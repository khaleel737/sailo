import { renderBody } from "@sailo/marketing/broadcasts";
import { parseFaq } from "@sailo/core/shop-pages";
import type { ShopPage } from "@sailo/db/schema";
import type { Dictionary } from "@sailo/i18n";

/**
 * The two storefront blocks spec 41 adds, and the two the page-builder refusal
 * left room for.
 *
 * `GAP-2026-08-easytools.md` §4.1 refuses the Easypage website builder outright
 * — the storefront *is* the page — and names an FAQ block and an About block as
 * the pieces worth having from it. So: two known blocks, on or off, rendered
 * from `shop_pages`. **Not a section editor.** There is no ordering, no layout,
 * no third block, and adding one is re-opening a decision rather than extending
 * a feature.
 *
 * Both render only when the seller has published the page, so a shop that has
 * written nothing looks exactly as it did.
 *
 * ## Why the FAQ is `<details>` and not a client component
 *
 * An accordion is the one interaction the platform already implements. Native
 * `<details>` opens without JavaScript, is keyboard-operable and
 * screen-reader-labelled for free, and survives a failed hydration on a page
 * whose whole job is to answer a question before somebody buys. A hand-rolled
 * one would be a client bundle, an `aria-expanded` to get right, and a focus
 * trap to forget.
 */

/** A light panel, because the markdown pipeline styles its own ink. */
const PANEL =
  "rounded-2xl bg-white p-5 text-ink-900 shadow-sm sm:p-7 [&_a]:underline [&_a]:underline-offset-2";

export function AboutBlock({ page }: { page: ShopPage | null }) {
  if (!page?.bodyMd?.trim()) return null;

  return (
    <section className="mt-12">
      <div className={PANEL}>
        <div lang="en" dangerouslySetInnerHTML={{ __html: renderBody(page.bodyMd) }} />
      </div>
    </section>
  );
}

export function FaqBlock({
  page,
  t,
}: {
  page: ShopPage | null;
  t: Dictionary;
}) {
  const entries = parseFaq(page?.bodyMd);
  /*
   * Nothing rendered for a published-but-empty FAQ. A heading over no rows is a
   * shop advertising that it answers questions and then answering none, which
   * reads worse than the block being absent.
   */
  if (entries.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="mb-3 text-sm font-semibold tracking-tight">
        {page?.title?.trim() || t.pages.faq}
      </h2>

      <div className={`${PANEL} divide-y divide-ink-100 p-0 sm:p-0`}>
        {entries.map((entry, index) => (
          <details key={`${index}-${entry.question}`} className="group px-5 py-4">
            <summary className="focus-ring-accent flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
              <span lang="en">{entry.question}</span>
              {/*
                A rotating chevron drawn in CSS rather than an icon component:
                this is the only moving part on the block and pulling in an icon
                for it would be a bundle for a triangle.
              */}
              <span
                aria-hidden
                className="shrink-0 text-ink-400 transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <div
              lang="en"
              className="mt-2 text-sm"
              dangerouslySetInnerHTML={{ __html: renderBody(entry.answer) }}
            />
          </details>
        ))}
      </div>
    </section>
  );
}
