import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getArticleIn,
  getSlugLocales,
  getEveryArticleByLocale,
  getRelatedArticlesIn,
} from "@/lib/blog";
import { splitAtMidHeading } from "@/lib/blog-toc";
import { directionOf, isLocale } from "@sailo/i18n/config";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { getBlogDictionary } from "@sailo/i18n/marketing/blog";
import { Container } from "@/components/marketing/kit";
import { absolute } from "@sailo/core/origin";
import { breadcrumbJsonLd } from "@/lib/seo";
import { articlePath, blogIndexPath } from "@/lib/blog-urls";
import {
  TableOfContents,
  TableOfContentsDisclosure,
} from "../../_components/table-of-contents";
import { ShareRow } from "../../_components/share-row";
import {
  AuthorCard,
  NewsletterBand,
  NewsletterCard,
  ProductCard,
  RelatedArticles,
  TagRow,
} from "../../_components/cards";

/**
 * One article, in one language, at `/<locale>/blog/<slug>`.
 *
 * Every article the programme has, in every language, is a param here — the
 * whole point of the locale prefix is that each language's articles are their
 * own indexable pages rather than one URL switching content on a cookie.
 *
 * THE LAYOUT, AND WHY IT IS TWO COLUMNS
 *
 * The article used to be a 44rem measure alone on the page, which is the right
 * measure for reading and the wrong page for a blog that has to earn anything.
 * A reader who finished a post had exactly one thing to do next: leave. The
 * rail beside it now carries the four things they might actually want — where
 * they are in the piece, the list they can join, the product the writing is
 * for, and a way to pass it on — without any of them interrupting the column
 * they are reading.
 *
 * The measure itself is unchanged. The rail is `17rem` beside a `44rem`
 * column, so the prose is exactly as wide as it was; the page around it got
 * wider rather than the article getting narrower, which is the difference
 * between adding a sidebar and taking space from the writing.
 *
 * Below `lg` the rail unstacks into the flow: the contents become a closed
 * `<details>` above the article, the signup band keeps its place halfway
 * down, and the product card and share row land after the last paragraph.
 * Nothing is hidden at any width — a phone gets the same four things in the
 * order they make sense in one column.
 */
export async function generateStaticParams() {
  return (await getEveryArticleByLocale()).map(({ locale, article }) => ({
    locale,
    slug: article.slug,
  }));
}

export async function generateMetadata({
  params,
}: PageProps<"/blog/[locale]/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;

  /*
   * `noindex` on anything that is not an article in this language.
   *
   * `notFound()` renders the right page but cannot set a 404: the root layout
   * reads cookies, so the response is already streaming. Without this, a
   * crawler that guesses `/pt/blog/<an-english-slug>` would index a not-found
   * page as a real Portuguese URL.
   */
  const missing = { title: "Not found", robots: { index: false, follow: false } };

  if (!isLocale(locale)) return missing;

  const article = await getArticleIn(slug, locale);
  if (!article) return missing;

  const url = absolute(articlePath(locale, slug));

  /*
   * `hreflang` only where the same article genuinely exists in another
   * language. Most of this blog is written per market, so most articles have no
   * alternates and none are emitted. Listing unrelated articles as alternates
   * would be telling a crawler, in a machine-readable format, something untrue.
   */
  const others = await getSlugLocales(slug);
  const languages =
    others.length > 1
      ? Object.fromEntries(others.map((l) => [l, absolute(articlePath(l, slug))]))
      : undefined;

  /*
   * The article's own cover, absolute, as its share and preview image.
   *
   * Every article has a distinct one, so this is what stops 260 pages sharing a
   * single site-wide picture in search results, on social cards and in the
   * image index. `alt` carries the same text the page renders, in the article's
   * own language.
   */
  const images = article.cover
    ? [{ url: absolute(article.cover), width: 1200, height: 630, alt: article.coverAlt }]
    : undefined;

  return {
    title: article.title,
    description: article.description,
    /*
     * The article's own tags, replacing the site-wide list the root layout
     * sets. Inherited keywords put "Linktree alternative" on a piece about
     * pricing knitwear, which describes the site rather than the page.
     */
    keywords: article.tags.length > 0 ? article.tags : undefined,
    authors: [{ name: article.author }],
    alternates: { canonical: url, ...(languages ? { languages } : {}) },
    openGraph: {
      type: "article",
      title: article.title,
      description: article.description,
      url,
      locale,
      publishedTime: article.date,
      authors: [article.author],
      tags: article.tags,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.description,
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
  };
}

/**
 * How many sections an article needs before a contents list earns its place.
 *
 * Two headings are not a structure, they are two headings — and a map of them
 * in a sticky rail is furniture pretending to be navigation. Below this the
 * rail simply starts with the signup card instead.
 */
const MIN_HEADINGS_FOR_TOC = 3;

export default async function ArticlePage({ params }: PageProps<"/blog/[locale]/[slug]">) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  const article = await getArticleIn(slug, locale);
  if (!article) notFound();

  const m = getMarketingDictionary(locale);
  const b = getBlogDictionary(locale);
  const related = await getRelatedArticlesIn(locale, slug, article.tags);

  const posted = new Date(article.date).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const path = articlePath(locale, slug);
  const url = absolute(path);
  const dir = directionOf(article.locale);
  const showToc = article.headings.length >= MIN_HEADINGS_FOR_TOC;

  /*
   * The body, split at the section boundary nearest the middle, so the signup
   * band lands between two sections rather than between a paragraph and the
   * sentence finishing its thought. A short article comes back unsplit and
   * renders as one block — see `splitAtMidHeading`.
   */
  const [bodyStart, bodyRest] = splitAtMidHeading(article.html);

  const shareLabels = {
    share: b.share,
    copyLink: b.copyLink,
    copied: b.copied,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: article.title,
            description: article.description,
            datePublished: article.date,
            inLanguage: article.locale,
            // Organization, not Person: the byline is the team. Declaring a
            // Person named "Sailo team" would be structured data asserting
            // something untrue about a human being.
            author: { "@type": "Organization", name: article.author },
            publisher: {
              "@type": "Organization",
              name: "Sailo",
              logo: absolute("/brand/sailo-mark-512.png"),
            },
            mainEntityOfPage: absolute(path),
            ...(article.cover ? { image: absolute(article.cover) } : {}),
            ...(article.tags.length > 0 ? { keywords: article.tags } : {}),
          }),
        }}
      />
      {/* Blog › this article. The blog's own index is the only parent an
        article has, and it is the page a reader who lands here from search is
        most likely to want next. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([
              { name: m.blog.title, path: blogIndexPath(locale) },
              { name: article.title, path },
            ]),
          ),
        }}
      />

      {/*
        How far through the piece the reader is.

        Fixed under the sticky header rather than above it, so it reads as
        belonging to the article and not to the site. No JavaScript at all —
        it is a scroll-driven animation; see `.read-progress` in globals.css.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-16 z-30 h-[2px]"
      >
        <div className="read-progress h-full w-full bg-[var(--ink)]" />
      </div>

      {/*
        The article's own direction governs the whole layout, not just the
        prose. An Arabic post puts its rail on the right because that is where
        a sidebar belongs in Arabic — the grid follows the inline axis, so this
        one attribute does it.
      */}
      <div lang={article.locale} dir={dir}>
        <Container className="py-10 sm:py-14">
          <Link
            href={blogIndexPath(locale)}
            className="focus-line inline-flex min-h-11 items-center gap-2 text-[0.8125rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
            {m.blog.backToBlog}
          </Link>

          <header className="mt-4 max-w-[44rem]">
            <h1 className="display text-[clamp(2rem,5.5vw,3.25rem)] leading-[1.08] text-[var(--ink)]">
              {article.title}
            </h1>
            <p className="mt-5 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
              {article.description}
            </p>
            <p className="mt-5 text-[0.8125rem] text-[var(--mute-400)]">
              <time dateTime={article.date}>{posted}</time>
              <span aria-hidden> · </span>
              {article.author}
              <span aria-hidden> · </span>
              {article.readingMinutes} {m.blog.minuteRead}
            </p>
          </header>

          {article.cover ? (
            <div className="relative mt-9 aspect-[1200/630] w-full overflow-hidden rounded-[var(--r-card)] bg-[var(--paper-sunk)]">
              <Image
                src={article.cover}
                alt={article.coverAlt}
                fill
                // The LCP element on nearly every visit to this page.
                priority
                sizes="(min-width: 1280px) 78rem, 100vw"
                className="object-cover"
              />
            </div>
          ) : null}

          {/*
            One column of prose at its own measure, one rail beside it.

            `items-start` is what makes `sticky` work in the rail: a grid item
            stretches to the row height by default, so a sticky child inside it
            has nothing left to travel within and never sticks at all.
          */}
          {/*
            `justify-between` because both tracks are bounded: the prose is
            capped at its own measure and the rail is a fixed width, so on a
            wide screen the leftover space would otherwise pile up after the
            rail and leave it floating short of the page edge while the article
            hugged the left. Between them, it reads as one spread.
          */}
          <div className="mt-12 grid items-start justify-between gap-12 lg:grid-cols-[minmax(0,44rem)_17rem] lg:gap-16">
            <main className="min-w-0">
              {showToc ? (
                <TableOfContentsDisclosure
                  headings={article.headings}
                  label={b.onThisPage}
                  className="mb-10 lg:hidden"
                />
              ) : null}

              <div
                className="prose"
                dangerouslySetInnerHTML={{ __html: bodyStart }}
              />

              {bodyRest ? (
                <>
                  <NewsletterBand
                    locale={locale}
                    b={b}
                    source="article"
                    path={path}
                    className="my-14"
                  />
                  <div
                    className="prose"
                    dangerouslySetInnerHTML={{ __html: bodyRest }}
                  />
                </>
              ) : null}

              <TagRow tags={article.tags} label={b.topics} />

              <ShareRow
                url={url}
                title={article.title}
                labels={shareLabels}
                className="mt-10 border-t border-[var(--mute-200)] pt-8"
              />

              <AuthorCard
                author={article.author}
                writtenBy={b.writtenBy}
                tagline={m.footer.tagline}
                className="mt-8"
              />

              {/*
                On a phone the rail's two cards land here, after the article, in
                the order a reader wants them: join the list first, because they
                have just finished reading and that is the smallest next step,
                then the product.

                Hidden above `lg` because the rail renders both. Duplicated
                markup rather than a reordered single copy — CSS `order` inside
                a grid would leave the sticky rail sharing a scroll container
                with the article, which is the thing that stops it sticking.
              */}
              <div className="mt-8 space-y-6 lg:hidden">
                <NewsletterCard
                  locale={locale}
                  b={b}
                  source="article"
                  path={path}
                  stacked={false}
                />
                <ProductCard m={m} />
              </div>
            </main>

            <aside className="hidden lg:sticky lg:top-24 lg:block">
              <div className="space-y-8">
                {showToc ? (
                  <TableOfContents
                    headings={article.headings}
                    label={b.onThisPage}
                    /*
                     * The one scrollable thing in the rail. A forty-heading
                     * article would otherwise push the signup card off the
                     * bottom of a laptop screen, where nobody would ever see
                     * it — which is the card the whole rail exists for.
                     */
                    className="max-h-[min(24rem,50vh)] overflow-y-auto"
                  />
                ) : null}

                <NewsletterCard
                  locale={locale}
                  b={b}
                  source="article"
                  path={path}
                />

                <ProductCard m={m} />

                <ShareRow
                  url={url}
                  title={article.title}
                  labels={shareLabels}
                  variant="rail"
                />
              </div>
            </aside>
          </div>

          <RelatedArticles articles={related} m={m} heading={b.keepReading} />
        </Container>
      </div>
    </>
  );
}
