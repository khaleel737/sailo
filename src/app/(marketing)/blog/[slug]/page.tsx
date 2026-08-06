import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getArticle, getArticles } from "@/lib/blog";
import { getLocale } from "@/i18n/server";
import { getMarketingDictionary } from "@/i18n/marketing";
import { Container } from "@/components/marketing/kit";
import { absolute } from "@/lib/seo";

/**
 * The posts ship with the code, so the full set is known at build time. This
 * turns every article into a static page — no database, no per-request work.
 */
export async function generateStaticParams() {
  const articles = await getArticles();
  return articles.map((article) => ({ slug: article.slug }));
}

/**
 * An unknown slug is not an article, so nothing should render for one.
 *
 * Measured caveat: this currently has no effect. The root layout calls
 * `getLocale()`, which reads cookies, so every route in the app is dynamic —
 * the build reports this one as `ƒ`, `generateStaticParams` gates nothing, and
 * `/blog/nope` answers 200 with the not-found page rather than 404.
 *
 * That soft 404 is app-wide, not a blog problem: `/no-such-shop-xyz` does the
 * same in production today. `notFound()` throws after the response has begun
 * streaming, and the status is fixed by then. Fixing it properly means making
 * the locale something other than a cookie the root layout reads, which is a
 * change to how the whole site resolves language.
 *
 * Left in place because it is the correct declaration for this route and costs
 * nothing — it will start working the day that changes.
 */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) return { title: "Not found" };

  const url = absolute(`/blog/${article.slug}`);

  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: article.title,
      description: article.description,
      url,
      publishedTime: article.date,
      authors: [article.author],
      tags: article.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.description,
    },
  };
}

export default async function ArticlePage({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) notFound();

  const locale = await getLocale();
  const m = getMarketingDictionary(locale);
  const posted = new Date(article.date).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      {/*
        Structured data, so the post can appear as an article rather than a
        page. Built from the same frontmatter the page renders.
      */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: article.title,
            description: article.description,
            datePublished: article.date,
            author: { "@type": "Person", name: article.author },
            publisher: {
              "@type": "Organization",
              name: "Sailo",
              logo: absolute("/brand/sailo-mark-512.png"),
            },
            mainEntityOfPage: absolute(`/blog/${article.slug}`),
            ...(article.cover ? { image: absolute(article.cover) } : {}),
          }),
        }}
      />

      <Container className="max-w-[44rem] py-12 sm:py-20">
        <Link
          href="/blog"
          className="focus-line inline-flex min-h-11 items-center gap-2 text-[0.8125rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft className="size-3.5" />
          {m.blog.backToBlog}
        </Link>

        {/*
          `dir="auto"` on the article, not on the page. The chrome around it —
          the back link, the reading time — is translated and follows the
          visitor's direction. The post is written in one language and has to
          read in that language's direction whatever locale it is opened in.
        */}
        <article dir="auto" className="mt-6">
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

          {/*
            The article body, from Markdown. `prose` is a local set of rules in
            globals.css rather than a plugin — the page has one typographic
            scale already, and a second one shipped by a dependency would
            quietly disagree with it.
          */}
          <div
            className="prose mt-10"
            // eslint-disable-next-line react/no-danger
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
