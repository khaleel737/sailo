import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticlePageIn } from "@/lib/blog";
import { isLocale } from "@/i18n/config";
import { getMarketingDictionary } from "@/i18n/marketing";
import { Container } from "@/components/marketing/kit";
import { absolute } from "@/lib/seo";
import { ArticleList, Pagination } from "../../../_components/article-list";
import { publicBlogHref } from "../../page";

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
    alternates: { canonical: publicBlogHref(locale, page) },
    openGraph: {
      type: "website",
      title: `${m.blog.title} — ${page}/${pageCount}`,
      description: m.blog.intro,
      url: absolute(publicBlogHref(locale, page)),
      locale,
    },
  };
}

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

  return (
    <Container className="py-16 sm:py-24">
      <header className="max-w-2xl">
        <h1 className="display text-[clamp(2.25rem,6vw,3.5rem)] text-[var(--ink)]">
          {m.blog.title}
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
          {m.blog.intro}
        </p>
      </header>

      <ArticleList articles={articles} locale={locale} m={m} withLead={false} />
      <Pagination locale={locale} page={page} pageCount={pageCount} m={m} />
    </Container>
  );
}
