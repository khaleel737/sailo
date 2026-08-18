import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticlePageIn, getArticlesIn } from "@/lib/blog";
import { isLocale } from "@sailo/i18n/config";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { getBlogDictionary } from "@sailo/i18n/marketing/blog";
import { absolute } from "@sailo/core/origin";
import { ArticleList, Pagination } from "../../../_components/article-list";
import { BlogIndexLayout } from "../../../_components/index-layout";
import { blogIndexPath } from "@/lib/blog-urls";

/*
 * Pages two and up of one language's index: `/<locale>/blog/page/2`.
 *
 * `page` is a literal segment, so it resolves ahead of `[slug]` and the two
 * never compete. An article slug of "page" would break that, which is why the
 * registry test refuses one.
 */

function parsePage(raw: string): number | null {
  // Plain positive integers only. "01", "2.5" and "-1" would mint duplicate
  // URLs for content that already has a canonical home.
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/blog/[locale]/page/[page]">): Promise<Metadata> {
  const { locale, page: raw } = await params;
  const page = parsePage(raw);
  if (!isLocale(locale) || page === null) return { title: "Not found" };

  const { pageCount } = await getArticlePageIn(locale, page);
  const m = getMarketingDictionary(locale);

  return {
    title: `${m.blog.title} — ${page}/${pageCount}`,
    description: m.blog.intro,
    /*
     * Self-canonical and no `hreflang`, unlike page one.
     *
     * The blog is written per market rather than translated, so the languages
     * hold different numbers of articles and page 3 of the Italian index is
     * not the Italian version of page 3 of the English one — it is a different
     * set of posts that happens to fall at the same offset. Page one is the
     * blog's door in each language and genuinely has 34 counterparts; an
     * arbitrary slice of the archive does not, and claiming otherwise would be
     * a lie a crawler can act on.
     */
    alternates: { canonical: blogIndexPath(locale, page) },
    openGraph: {
      type: "website",
      title: `${m.blog.title} — ${page}/${pageCount}`,
      description: m.blog.intro,
      url: absolute(blogIndexPath(locale, page)),
      locale,
    },
  };
}

/** How many titles the rail lists. One screen's worth on a laptop. */
const HEADLINES = 10;

export default async function LocaleBlogPage({
  params,
}: PageProps<"/blog/[locale]/page/[page]">) {
  const { locale, page: raw } = await params;
  const requested = parsePage(raw);
  if (!isLocale(locale) || requested === null) notFound();

  const { articles, page, pageCount } = await getArticlePageIn(locale, requested);

  // Page one already lives at `/<locale>/blog`, and a page past the end is not
  // a page. Neither should answer 200 with content that has a canonical home.
  if (requested === 1 || requested > pageCount || articles.length === 0) notFound();

  const m = getMarketingDictionary(locale);
  const b = getBlogDictionary(locale);
  const headlines = (await getArticlesIn(locale)).slice(0, HEADLINES);

  return (
    <BlogIndexLayout
      locale={locale}
      m={m}
      b={b}
      headlines={headlines}
      path={blogIndexPath(locale, page)}
      heading={
        /*
         * Which page this is, said in the page rather than only in the title.
         *
         * A reader who lands on page 7 from a search result sees the same
         * masthead as page 1 and, without this, no way to tell they are seven
         * screens into an archive rather than looking at what was published
         * this week. The pager at the foot says so too, but that is below
         * twelve cards.
         */
        <p className="mt-5 text-[0.8125rem] text-[var(--mute-400)]">
          {page} / {pageCount}
        </p>
      }
    >
      <ArticleList articles={articles} locale={locale} m={m} withLead={false} />
      <Pagination locale={locale} page={page} pageCount={pageCount} m={m} />
    </BlogIndexLayout>
  );
}
