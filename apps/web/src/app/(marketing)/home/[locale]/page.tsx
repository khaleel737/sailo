import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DEFAULT_LOCALE, isLocale } from "@sailo/i18n/config";
import { PREFIXED_LOCALES } from "@/lib/marketing-urls";
import { homeMetadata } from "../../_components/home-metadata";
import { HomeView } from "../../_components/home-view";

/**
 * The landing page in one of the other 34 languages.
 *
 * Reached as `/<locale>`, rewritten onto this route by `src/proxy.ts`. The
 * internal path exists only because `[handle]` owns the root dynamic segment
 * and Next allows one dynamic name per position — the same constraint that
 * put the blog at `/blog/<locale>` internally. Every URL this route emits is
 * the public prefixed one, so the internal shape never leaks.
 *
 * `generateStaticParams` excludes English, which is served from `/`. Including
 * it would build a second copy of the homepage at `/en`, competing with the
 * root for its own terms.
 */
export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: PageProps<"/home/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  /*
   * The proxy only rewrites paths whose first segment is a real locale, so
   * this is unreachable in production. It is here because a direct request to
   * the internal path is not, and a page with no locale must not be indexed
   * under one.
   */
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  return homeMetadata(locale);
}

export default async function LocalisedHomePage({
  params,
}: PageProps<"/home/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) notFound();

  return <HomeView locale={locale} />;
}
