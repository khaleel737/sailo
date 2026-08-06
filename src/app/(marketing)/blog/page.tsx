import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getArticles } from "@/lib/blog";
import { getLocale } from "@/i18n/server";
import { directionOf } from "@/i18n/config";
import { getMarketingDictionary } from "@/i18n/marketing";
import { Container } from "@/components/marketing/kit";
import { absolute } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "How to sell from a link in your bio: photographs, pricing, delivery and the small decisions that turn a follower into an order.",
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    title: "Sailo Blog",
    description:
      "How to sell from a link in your bio: photographs, pricing, delivery and the small decisions that turn a follower into an order.",
    url: absolute("/blog"),
  },
};

/**
 * The index. Newest first, the most recent post given the full width.
 *
 * Read almost entirely on phones — the audience is the same people who sell
 * from one — so the grid starts as a single column and only splits at `sm`.
 */
export default async function BlogIndex() {
  const locale = await getLocale();
  const articles = await getArticles(locale);
  const m = getMarketingDictionary(locale);
  const [lead, ...rest] = articles;

  const formatted = (date: string) =>
    new Date(date).toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  return (
    <>
      <Container className="py-16 sm:py-24">
        <header className="max-w-2xl">
          <h1 className="display text-[clamp(2.25rem,6vw,3.5rem)] text-[var(--ink)]">
            {m.blog.title}
          </h1>
          <p className="mt-4 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
            {m.blog.intro}
          </p>
        </header>

        {articles.length === 0 ? (
          <p className="mt-16 text-[var(--mute-500)]">{m.blog.empty}</p>
        ) : (
          <div className="mt-14 space-y-12">
            {lead ? (
              <Link
                href={`/blog/${lead.slug}`}
                className="focus-line group block overflow-hidden rounded-[var(--r-card)] border border-[var(--mute-200)] transition-colors hover:border-[var(--mute-300)]"
              >
                {lead.cover ? (
                  <div className="relative aspect-[1200/630] w-full overflow-hidden bg-[var(--paper-sunk)]">
                    <Image
                      src={lead.cover}
                      alt={lead.coverAlt}
                      fill
                      // The lead image is the largest thing above the fold on
                      // this page, so it is the LCP element on most visits.
                      priority
                      sizes="(min-width: 1024px) 60rem, 100vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                  </div>
                ) : null}
                <div className="p-6 sm:p-8">
                  <p className="text-[0.8125rem] text-[var(--mute-400)]">
                    <time dateTime={lead.date}>{formatted(lead.date)}</time>
                    <span aria-hidden> · </span>
                    {lead.readingMinutes} {m.blog.minuteRead}
                  </p>
                  {/* The post's own language, not the visitor's — see the
                      note on the article page. Declared rather than sniffed:
                      the copy on disk knows which language it is in, so `auto`
                      would only be guessing at something already known. */}
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
                {rest.map((article) => (
                  <li key={article.slug}>
                    <Link
                      href={`/blog/${article.slug}`}
                      className="focus-line group block h-full overflow-hidden rounded-[var(--r-card)] border border-[var(--mute-200)] transition-colors hover:border-[var(--mute-300)]"
                    >
                      {article.cover ? (
                        <div className="relative aspect-[1200/630] w-full overflow-hidden bg-[var(--paper-sunk)]">
                          <Image
                            src={article.cover}
                            alt={article.coverAlt}
                            fill
                            sizes="(min-width: 640px) 28rem, 100vw"
                            className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                          />
                        </div>
                      ) : null}
                      <div className="p-5">
                        <p className="text-[0.8125rem] text-[var(--mute-400)]">
                          <time dateTime={article.date}>{formatted(article.date)}</time>
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
        )}
      </Container>
    </>
  );
}
