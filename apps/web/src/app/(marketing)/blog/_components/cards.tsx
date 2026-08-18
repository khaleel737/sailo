import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ArticleSummary } from "@/lib/blog";
import { articlePath } from "@/lib/blog-urls";
import { directionOf, type Locale } from "@sailo/i18n/config";
import type { MarketingDictionary } from "@sailo/i18n/marketing";
import type { BlogDictionary } from "@sailo/i18n/marketing/blog";
import type { NewsletterSource } from "@sailo/marketing/newsletter";
import { NewsletterForm } from "@/components/marketing/newsletter-form";
import { cn } from "@sailo/design-system/web/cn";

/*
 * The blocks the blog's sidebar and its long pages are built from.
 *
 * Server components, all of them — the only client code on an article is the
 * table of contents' scroll-spy and the share row's clipboard call. A card
 * that renders a form is still a server component; the form inside it is the
 * client boundary, and keeping the boundary that small is why an article ships
 * almost no JavaScript.
 */

/* -------------------------------------------------------------------------- */
/*  The signup card                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The mailing list, as it appears in the rail beside an article.
 *
 * The single most valuable thing on a blog page and the reason the sidebar
 * exists at all: a reader who finishes an article and leaves is worth nothing,
 * and a reader who leaves an address is the top of the only funnel this
 * company has that does not cost money per head.
 *
 * `path` is threaded down from the page rather than read here, because a
 * server component has no idea what URL it is being rendered for — and that
 * value is the whole of the attribution. Without it the list can say four
 * thousand people joined and nothing about which writing won them.
 */
export function NewsletterCard({
  locale,
  b,
  source,
  path,
  stacked = true,
  className,
}: {
  locale: Locale;
  b: BlogDictionary;
  source: NewsletterSource;
  path?: string;
  stacked?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[var(--r-card)] border border-[var(--mute-200)] bg-[var(--paper-sunk)] p-5",
        className,
      )}
    >
      <h2 className="display-sm text-[1.0625rem] leading-snug text-[var(--ink)]">
        {b.subscribeTitle}
      </h2>
      <p className="mt-2 text-[0.8125rem] leading-[1.6] text-[var(--mute-600)]">
        {b.subscribeBody}
      </p>
      <NewsletterForm
        locale={locale}
        b={b}
        source={source}
        path={path}
        stacked={stacked}
        className="mt-4"
      />
    </section>
  );
}

/**
 * The same offer, as a full-width band.
 *
 * Used once halfway down a long article and once at the foot of the index —
 * the two places a reader has just finished something and is deciding what to
 * do next. The break is placed on a section boundary rather than mid-argument;
 * see `splitAtMidHeading`.
 *
 * Visually the inverse of the card: ink on paper rather than paper on ink, so
 * it reads as a deliberate interruption rather than as another card that
 * happened to be wide.
 */
export function NewsletterBand({
  locale,
  b,
  source,
  path,
  className,
}: {
  locale: Locale;
  b: BlogDictionary;
  source: NewsletterSource;
  path?: string;
  className?: string;
}) {
  return (
    <section
      /*
        `surface-invert` redefines this subtree's ink and paper tokens — see
        `brand.css`. That is what lets the same signup form render here without
        knowing it is on a dark panel: it asks for `--ink` and `--paper` as it
        always does, and gets the inverted pair. A `tone` prop threaded into
        the form would put that knowledge in the wrong place, and the first
        component that forgot to pass it would be invisible on this background.
      */
      className={cn(
        "surface-invert rounded-[var(--r-card)] px-6 py-8 sm:px-10 sm:py-10",
        className,
      )}
    >
      <div className="max-w-xl">
        <h2 className="display-sm text-[clamp(1.25rem,3vw,1.625rem)] leading-tight text-[var(--ink)]">
          {b.subscribeTitle}
        </h2>
        <p className="mt-3 text-[0.9375rem] leading-[1.7] text-[var(--mute-500)]">
          {b.subscribeBody}
        </p>
        <NewsletterForm
          locale={locale}
          b={b}
          source={source}
          path={path}
          className="mt-5"
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  The product                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the blog is for, said once, in the rail.
 *
 * The copy is `m.cta.*` — the same words the landing page's closing section
 * uses — rather than a second set written for this surface. A reader who
 * arrives from search, reads a post and clicks through should meet the sentence
 * they were already told, not a variant of it that a marketing page and a blog
 * would then have to be kept in step by hand.
 */
export function ProductCard({
  m,
  className,
}: {
  m: MarketingDictionary;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[var(--r-card)] border border-[var(--mute-200)] p-5",
        className,
      )}
    >
      <h2 className="display-sm text-[1.0625rem] leading-snug text-[var(--ink)]">
        {m.cta.title}
      </h2>
      <p className="mt-2 text-[0.8125rem] leading-[1.6] text-[var(--mute-600)]">
        {m.cta.body}
      </p>
      <Link
        href="/signup"
        className="focus-line mt-4 inline-flex h-10 items-center gap-1.5 rounded-[var(--r-pill)] bg-[var(--ink)] px-4 text-[0.8125rem] font-medium text-[var(--paper)] transition-opacity hover:opacity-90 pointer-coarse:h-11"
      >
        {m.cta.button}
        <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
      </Link>
      <p className="mt-3 text-[0.6875rem] text-[var(--mute-400)]">{m.cta.note}</p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Around the article                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The byline, at the foot of the piece.
 *
 * An Organization and not a person, matching the `BlogPosting` structured data
 * exactly: the byline on these posts is the team, and inventing a face and a
 * biography for "Sailo team" would be the page and its own machine-readable
 * description disagreeing about who wrote it.
 */
export function AuthorCard({
  author,
  writtenBy,
  tagline,
  className,
}: {
  author: string;
  writtenBy: string;
  tagline: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex items-start gap-4 rounded-[var(--r-card)] border border-[var(--mute-200)] p-5",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-[0.8125rem] font-semibold text-[var(--paper)]"
      >
        {author.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0">
        <p className="text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--mute-400)]">
          {writtenBy}
        </p>
        <p className="mt-0.5 text-[0.9375rem] font-medium text-[var(--ink)]">
          {author}
        </p>
        <p className="mt-1 text-[0.8125rem] leading-[1.6] text-[var(--mute-500)]">
          {tagline}
        </p>
      </div>
    </section>
  );
}

/**
 * What to read next — three articles, chosen by shared tags rather than by
 * recency.
 *
 * The alternative, "the three newest", puts the same three cards under every
 * article on the site, which carries no information and trains readers to
 * ignore the section entirely. See `getRelatedArticlesIn`.
 */
export function RelatedArticles({
  articles,
  m,
  heading,
}: {
  articles: ArticleSummary[];
  m: MarketingDictionary;
  heading: string;
}) {
  if (articles.length === 0) return null;

  return (
    <section className="mt-20 border-t border-[var(--mute-200)] pt-12">
      <h2 className="display-sm text-[1.25rem] text-[var(--ink)]">{heading}</h2>
      <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => (
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
                    // Never eager: this section is below a whole article, so a
                    // priority hint here would compete with the cover image
                    // that is the actual LCP element.
                    sizes="(min-width: 1024px) 20rem, (min-width: 640px) 45vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                </div>
              ) : null}
              <div className="p-4">
                <p className="text-[0.75rem] text-[var(--mute-400)]">
                  {article.readingMinutes} {m.blog.minuteRead}
                </p>
                <h3
                  lang={article.locale}
                  dir={directionOf(article.locale)}
                  className="mt-1.5 text-[0.9375rem] font-medium leading-snug text-[var(--ink)]"
                >
                  {article.title}
                </h3>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The article's tags, as a row.
 *
 * Presentational and not links, deliberately. A tag page is a real page with
 * real SEO consequences — thirty of them, mostly holding two articles each,
 * every one of them thin and every one of them competing with the index that
 * already ranks. When there is enough written under a tag to make a page worth
 * indexing, these become links; until then they are a label.
 */
export function TagRow({ tags, label }: { tags: string[]; label: string }) {
  if (tags.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[var(--mute-400)]">
        {label}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <li
            key={tag}
            className="rounded-[var(--r-pill)] border border-[var(--mute-200)] px-3 py-1 text-[0.75rem] text-[var(--mute-500)]"
          >
            {tag}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The index's rail: the last few headlines, as a list rather than as cards.
 *
 * The cards already show covers and descriptions; repeating them smaller
 * beside themselves would be the same information twice. What a headline list
 * adds is *scannability* — twelve titles in the space one card takes, which is
 * how a reader finds the one piece they half-remember.
 */
export function HeadlineList({
  articles,
  label,
  className,
}: {
  articles: ArticleSummary[];
  label: string;
  className?: string;
}) {
  if (articles.length === 0) return null;

  return (
    <nav aria-labelledby="headlines-label" className={className}>
      <p
        id="headlines-label"
        className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[var(--mute-400)]"
      >
        {label}
      </p>
      <ul className="mt-3 space-y-0.5 border-s border-[var(--mute-200)]">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={articlePath(article.locale, article.slug)}
              lang={article.locale}
              dir={directionOf(article.locale)}
              className="focus-line -ms-px flex items-center border-s-2 border-transparent py-1.5 ps-3.5 text-[0.8125rem] leading-[1.45] text-[var(--mute-500)] transition-colors hover:border-[var(--mute-300)] hover:text-[var(--ink)] pointer-coarse:min-h-11"
            >
              {article.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
