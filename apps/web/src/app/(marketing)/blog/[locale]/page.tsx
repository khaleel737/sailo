import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticlePageIn, getArticlesIn, getContentLocales } from "@/lib/blog";
import { blogIndexLanguages, blogIndexPath } from "@/lib/blog-urls";
import { directionOf, isLocale } from "@sailo/i18n/config";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { getBlogDictionary } from "@sailo/i18n/marketing/blog";
import { Container } from "@/components/marketing/kit";
import { absolute } from "@sailo/core/origin";
import { blogJsonLd } from "@/lib/seo";
import { ArticleList, Pagination } from "../_components/article-list";
import { BlogIndexLayout } from "../_components/index-layout";
import { NewsletterBand } from "../_components/cards";

/*
 * One language's index.
 *
 * Reached as `/<locale>/blog`, rewritten onto this route by `src/proxy.ts`. The
 * canonical URL is always the prefixed public one — the internal path exists
 * only because `[handle]` owns the root dynamic segment.
 *
 * Reads one locale exactly. The blog is written per market, so the French index
 * is French articles, not French translations of English ones, and an empty
 * locale is a 404 rather than a page of English under a French URL.
 */

export async function generateStaticParams() {
  return (await getContentLocales()).map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: PageProps<"/blog/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return { title: "Not found" };

  const m = getMarketingDictionary(locale);
  const { total } = await getArticlePageIn(locale, 1);

  return {
    title: m.blog.title,
    description: m.blog.intro,
    /*
     * A language with nothing written yet is a real page a reader can reach and
     * a thin one a crawler should ignore. `notFound()` cannot help: the root
     * layout reads cookies, so the response has already begun streaming and the
     * status is 200 whatever this route asks for. `noindex` is the part that
     * actually keeps it out of the index, and it lifts on its own the moment
     * the first article for that language lands.
     */
    ...(total === 0 ? { robots: { index: false, follow: true } } : {}),
    /*
     * Self-canonical, plus every other language's index as an `hreflang`
     * alternate. The 35 indexes are the same page — the blog's door — in 35
     * languages, so each one has to name the others or Google indexes them as
     * 35 unrelated pages and serves whichever it prefers to a French searcher.
     *
     * The alternates are the same for all of them by construction, because
     * they are built from what is on disk rather than from this locale.
     */
    alternates: {
      canonical: blogIndexPath(locale),
      languages: await blogIndexLanguages(),
    },
    openGraph: {
      type: "website",
      title: m.blog.title,
      description: m.blog.intro,
      url: absolute(blogIndexPath(locale)),
      locale,
      // What the other 34 indexes are, in the vocabulary a social scraper
      // reads — `alternates.languages` above is for crawlers only.
      alternateLocale: (await getContentLocales()).filter((l) => l !== locale),
    },
  };
}

/** How many titles the rail lists. One screen's worth on a laptop. */
const HEADLINES = 10;

export default async function LocaleBlogIndex({ params }: PageProps<"/blog/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { articles, page, pageCount } = await getArticlePageIn(locale, 1);
  const m = getMarketingDictionary(locale);
  const b = getBlogDictionary(locale);

  /*
   * A shipped language with nothing written yet gets its own empty state rather
   * than a not-found page. It is a real section of the site that simply has no
   * articles, the copy for saying so is already translated, and `generateMetadata`
   * marks the page `noindex` so nothing thin reaches the index.
   *
   * The signup band still renders. A language with no articles yet is exactly
   * the audience worth capturing — somebody who came looking and found nothing
   * is the one reader who would genuinely like to be told when there is
   * something.
   */
  if (articles.length === 0) {
    return (
      <Container
        lang={locale}
        dir={directionOf(locale)}
        className="py-16 sm:py-24"
      >
        <header className="max-w-2xl">
          <h1 className="display text-[clamp(2.25rem,6vw,3.5rem)] text-[var(--ink)]">
            {m.blog.title}
          </h1>
          <p className="mt-4 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
            {m.blog.intro}
          </p>
        </header>
        <p className="mt-14 text-[var(--mute-500)]">{m.blog.empty}</p>
        <NewsletterBand
          locale={locale}
          b={b}
          source="blog"
          path={blogIndexPath(locale)}
          className="mt-10 max-w-3xl"
        />
      </Container>
    );
  }

  /*
   * The rail's headline list is the newest ten of the whole language, not this
   * page's twelve. On page one those overlap almost entirely, which is fine —
   * the list is there so the same rail can be right on page seven, where the
   * cards are from last spring and "latest" still has to mean latest.
   */
  const headlines = (await getArticlesIn(locale)).slice(0, HEADLINES);

  return (
    <>
      {/* Not on the empty state above: that page is `noindex`, and declaring a
        Blog with nothing in it is structured data describing a page that does
        not exist yet. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            blogJsonLd({
              name: m.blog.title,
              description: m.blog.intro,
              path: blogIndexPath(locale),
              locale,
            }),
          ),
        }}
      />
      <BlogIndexLayout
        locale={locale}
        m={m}
        b={b}
        headlines={headlines}
        path={blogIndexPath(locale)}
      >
        <ArticleList articles={articles} locale={locale} m={m} withLead />
        <Pagination locale={locale} page={page} pageCount={pageCount} m={m} />
      </BlogIndexLayout>
    </>
  );
}
