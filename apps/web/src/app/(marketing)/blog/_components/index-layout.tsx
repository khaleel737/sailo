import type { ReactNode } from "react";
import type { ArticleSummary } from "@/lib/blog";
import { directionOf, type Locale } from "@sailo/i18n/config";
import type { MarketingDictionary } from "@sailo/i18n/marketing";
import type { BlogDictionary } from "@sailo/i18n/marketing/blog";
import { Container } from "@/components/marketing/kit";
import { HeadlineList, NewsletterCard, ProductCard } from "./cards";

/**
 * The shell both index routes wear: masthead, list, rail.
 *
 * `/<locale>/blog` and `/<locale>/blog/page/2` are the same page with a
 * different slice, and they were already sharing their cards through
 * `article-list.tsx`. They were not sharing the frame, which is how the
 * pagination on page two ended up a different distance from the grid than the
 * one on page one — a difference nobody sees until both are open at once, and
 * then cannot unsee.
 *
 * The rail carries the same two offers as an article's, plus a headline list.
 * On the index that list is doing something the cards cannot: twelve titles in
 * the space one card takes, which is how a reader finds the piece they
 * half-remember rather than the piece we published most recently.
 */
export function BlogIndexLayout({
  locale,
  m,
  b,
  /** The masthead. Page two says which page it is; page one does not. */
  heading,
  headlines,
  path,
  children,
}: {
  locale: Locale;
  m: MarketingDictionary;
  b: BlogDictionary;
  heading?: ReactNode;
  /** The rail's title list. Deliberately the newest, not this page's slice. */
  headlines: ArticleSummary[];
  /** Which page the signup form is standing on, for attribution. */
  path: string;
  children: ReactNode;
}) {
  return (
    /*
      The index's own language governs the whole page, not just the card
      titles.

      `/ar/blog` is a page written in Arabic — masthead, intro, headlines and
      all — reached under a URL that says so, so the frame around it has to be
      Arabic too. Without this the document direction comes from the visitor's
      cookie, and an Arabic paragraph laid out left-to-right puts its
      sentence-final full stop on the left: not a preference, a bug that only
      readers of that language can see. It also moves the rail to the side a
      sidebar belongs on in Arabic, which the grid does on its own once the
      inline axis is right.
    */
    <Container
      lang={locale}
      dir={directionOf(locale)}
      className="py-14 sm:py-20"
    >
      <header className="max-w-2xl">
        <h1 className="display text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.05] text-[var(--ink)]">
          {m.blog.title}
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
          {m.blog.intro}
        </p>
        {heading}
      </header>

      {/*
        `items-start` for the same reason it is on the article: a grid item
        stretches to the row height by default, and a sticky child inside a
        full-height item has nowhere left to travel.
      */}
      <div className="mt-12 grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-16">
        <div className="min-w-0">{children}</div>

        <aside className="lg:sticky lg:top-24">
          <div className="space-y-8">
            <NewsletterCard locale={locale} b={b} source="blog" path={path} />
            {/*
              The headline list is the one rail item a phone does not get. On a
              narrow screen the cards below it are already a list of headlines,
              with covers — repeating the same twelve titles above them would be
              the same information twice and a screenful of it.
            */}
            <HeadlineList
              articles={headlines}
              label={b.latest}
              className="hidden lg:block"
            />
            <ProductCard m={m} />
          </div>
        </aside>
      </div>
    </Container>
  );
}
