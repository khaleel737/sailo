import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ArticleSummary } from "@/lib/blog";
import { articlePath, blogIndexPath } from "@/lib/blog-urls";
import { directionOf, type Locale } from "@sailo/i18n/config";
import type { MarketingDictionary } from "@sailo/i18n/marketing";

/*
 * The index's cards and its pager, shared by `/blog` and `/blog/page/[page]`.
 *
 * Split out when the blog passed two hundred articles and one page stopped
 * being a page. Both routes render exactly the same list; only the slice and
 * the lead card differ, so the markup lives in one place rather than being
 * copied and then quietly diverging.
 */

type Props = {
  articles: ArticleSummary[];
  locale: Locale;
  m: MarketingDictionary;
  /** The first card runs full width. Only true on page one. */
  withLead: boolean;
};

function formatDate(date: string, locale: Locale) {
  return new Date(date).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ArticleList({ articles, locale, m, withLead }: Props) {
  // Page one gives its newest post the full width; later pages are all grid,
  // because a lead card halfway through an archive is just a bigger card.
  const lead = withLead ? articles[0] : undefined;
  const rest = withLead ? articles.slice(1) : articles;

  return (
    <div className="mt-14 space-y-12">
      {lead ? (
        <Link
          href={articlePath(lead.locale, lead.slug)}
          className="focus-line group block overflow-hidden rounded-[var(--r-card)] border border-[var(--mute-200)] transition-colors hover:border-[var(--mute-300)]"
        >
          {lead.cover ? (
            <div className="relative aspect-[1200/630] w-full overflow-hidden bg-[var(--paper-sunk)]">
              <Image
                src={lead.cover}
                alt={lead.coverAlt}
                fill
                // The lead image is the largest thing above the fold on this
                // page, so it is the LCP element on most visits.
                priority
                sizes="(min-width: 1024px) 60rem, 100vw"
                className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              />
            </div>
          ) : null}
          <div className="p-6 sm:p-8">
            <p className="text-[0.8125rem] text-[var(--mute-400)]">
              <time dateTime={lead.date}>{formatDate(lead.date, locale)}</time>
              <span aria-hidden> · </span>
              {lead.readingMinutes} {m.blog.minuteRead}
            </p>
            {/* The post's own language, not the visitor's — see the note on the
                article page. Declared rather than sniffed: the copy on disk
                knows which language it is in, so `auto` would only be guessing
                at something already known. */}
            <h2
              lang={lead.locale}
              dir={directionOf(lead.locale)}
              className="display-sm mt-3 text-[clamp(1.5rem,3.5vw,2.125rem)] text-[var(--ink)]"
            >
              {lead.title}
            </h2>
            <p
              lang={lead.locale}
              dir={directionOf(lead.locale)}
              className="mt-3 max-w-2xl text-[0.9375rem] leading-[1.7] text-[var(--mute-600)]"
            >
              {lead.description}
            </p>
          </div>
        </Link>
      ) : null}

      {rest.length > 0 ? (
        <ul className="grid gap-8 sm:grid-cols-2">
          {rest.map((article, i) => (
            <li key={article.slug}>
              <Link
                href={articlePath(article.locale, article.slug)}
                className="focus-line group block h-full overflow-hidden rounded-[var(--r-card)] border border-[var(--mute-200)] transition-colors hover:border-[var(--mute-300)]"
              >
                {article.cover ? (
                  <div className="relative aspect-[1200/630] w-full overflow-hidden bg-[var(--paper-sunk)]">
                    <Image
                      src={article.cover}
                      alt={article.coverAlt}
                      fill
                      // On a page with no lead card the first two cards are the
                      // LCP candidates, so they load eagerly and the rest stay
                      // lazy — twelve eager images would be worse than none.
                      priority={!withLead && i < 2}
                      sizes="(min-width: 640px) 28rem, 100vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                  </div>
                ) : null}
                <div className="p-5">
                  <p className="text-[0.8125rem] text-[var(--mute-400)]">
                    <time dateTime={article.date}>{formatDate(article.date, locale)}</time>
                    <span aria-hidden> · </span>
                    {article.readingMinutes} {m.blog.minuteRead}
                  </p>
                  <h2
                    lang={article.locale}
                    dir={directionOf(article.locale)}
                    className="display-sm mt-2 text-[1.25rem] leading-snug text-[var(--ink)]"
                  >
                    {article.title}
                  </h2>
                  <p
                    lang={article.locale}
                    dir={directionOf(article.locale)}
                    className="mt-2 text-[0.9375rem] leading-[1.7] text-[var(--mute-600)]"
                  >
                    {article.description}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Numbered pager.
 *
 * Numbers rather than an endless "load more": with two hundred articles a
 * reader who wants the oldest post should be able to get there, and a crawler
 * needs a real link to follow rather than a button that only exists once
 * JavaScript has run.
 */
export function Pagination({
  locale,
  page,
  pageCount,
  m,
}: {
  locale: Locale;
  page: number;
  pageCount: number;
  m: MarketingDictionary;
}) {
  if (pageCount <= 1) return null;

  // A window around the current page, always with the first and last in reach,
  // so the control stays the same width on page 2 and page 17.
  const window = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => window.add(n));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => window.add(n));

  const pages = [...window].filter((n) => n >= 1 && n <= pageCount).toSorted((a, b) => a - b);

  const step =
    "focus-line inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--mute-200)] px-3 text-[0.8125rem] transition-colors";

  return (
    <nav aria-label={m.blog.pagination} className="mt-16 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={blogIndexPath(locale, page - 1)} rel="prev" className={`${step} text-[var(--mute-600)] hover:border-[var(--mute-300)] hover:text-[var(--ink)]`}>
          <ChevronLeft className="size-4" aria-hidden />
          <span className="sr-only">{m.blog.previousPage}</span>
        </Link>
      ) : null}

      {pages.map((n, i) => (
        <span key={n} className="contents">
          {/* A gap in the sequence is a real gap, not a link to nowhere. */}
          {i > 0 && n - (pages[i - 1] ?? 0) > 1 ? (
            <span aria-hidden className="px-1 text-[var(--mute-400)]">
              …
            </span>
          ) : null}
          {n === page ? (
            <span
              aria-current="page"
              className={`${step} border-[var(--ink)] bg-[var(--ink)] font-medium text-[var(--paper)]`}
            >
              {n}
            </span>
          ) : (
            <Link
              href={blogIndexPath(locale, n)}
              className={`${step} text-[var(--mute-600)] hover:border-[var(--mute-300)] hover:text-[var(--ink)]`}
            >
              {n}
            </Link>
          )}
        </span>
      ))}

      {page < pageCount ? (
        <Link href={blogIndexPath(locale, page + 1)} rel="next" className={`${step} text-[var(--mute-600)] hover:border-[var(--mute-300)] hover:text-[var(--ink)]`}>
          <ChevronRight className="size-4" aria-hidden />
          <span className="sr-only">{m.blog.nextPage}</span>
        </Link>
      ) : null}
    </nav>
  );
}
