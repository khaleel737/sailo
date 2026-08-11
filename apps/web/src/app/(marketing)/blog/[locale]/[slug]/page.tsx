import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getArticleIn, getSlugLocales, getEveryArticleByLocale } from "@/lib/blog";
import { directionOf, isLocale } from "@/i18n/config";
import { getMarketingDictionary } from "@/i18n/marketing";
import { Container } from "@/components/marketing/kit";
import { absolute, breadcrumbJsonLd } from "@/lib/seo";
import { articlePath, blogIndexPath } from "@/lib/blog-urls";

/**
 * One article, in one language, at `/<locale>/blog/<slug>`.
 *
 * Every article the programme has, in every language, is a param here — the
 * whole point of the locale prefix is that each language's articles are their
 * own indexable pages rather than one URL switching content on a cookie.
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

export default async function ArticlePage({ params }: PageProps<"/blog/[locale]/[slug]">) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  const article = await getArticleIn(slug, locale);
  if (!article) notFound();

  const m = getMarketingDictionary(locale);
  const posted = new Date(article.date).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

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
            mainEntityOfPage: absolute(articlePath(locale, slug)),
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
              { name: article.title, path: articlePath(locale, slug) },
            ]),
          ),
        }}
      />

      <Container className="max-w-[44rem] py-12 sm:py-20">
        <Link
          href={blogIndexPath(locale)}
          className="focus-line inline-flex min-h-11 items-center gap-2 text-[0.8125rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft className="size-3.5" />
          {m.blog.backToBlog}
        </Link>

        {/*
          The article's own language and direction, which the URL now also
          carries. An Arabic article lays out right-to-left because the file is
          Arabic, not because of anything the visitor has set.
        */}
        <article
          lang={article.locale}
          dir={directionOf(article.locale)}
          className="mt-6"
        >
          <header>
            <h1 className="display text-[clamp(2rem,5.5vw,3rem)] leading-[1.1] text-[var(--ink)]">
              {article.title}
            </h1>
            <p className="mt-5 text-[0.8125rem] text-[var(--mute-400)]">
              <time dateTime={article.date}>{posted}</time>
              <span aria-hidden> · </span>
              {article.author}
              <span aria-hidden> · </span>
              {article.readingMinutes} {m.blog.minuteRead}
            </p>
          </header>

          {article.cover ? (
            <div className="relative mt-8 aspect-[1200/630] w-full overflow-hidden rounded-[var(--r-card)] bg-[var(--paper-sunk)]">
              <Image
                src={article.cover}
                alt={article.coverAlt}
                fill
                priority
                sizes="(min-width: 768px) 44rem, 100vw"
                className="object-cover"
              />
            </div>
          ) : null}

          <div
            className="prose mt-10"
            dangerouslySetInnerHTML={{ __html: article.html }}
          />

          {article.tags.length > 0 ? (
            <ul className="mt-12 flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full border border-[var(--mute-200)] px-3 py-1 text-[0.75rem] text-[var(--mute-500)]"
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      </Container>
    </>
  );
}
