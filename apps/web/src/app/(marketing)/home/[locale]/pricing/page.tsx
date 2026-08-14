import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DEFAULT_LOCALE, isLocale } from "@sailo/i18n/config";
import { PREFIXED_LOCALES } from "@/lib/marketing-urls";
import { PricingView, pricingMetadata } from "../../../_components/pricing-view";

/**
 * Pricing in one of the other 34 languages, reached as `/<locale>/pricing` and
 * rewritten here by `src/proxy.ts`. English is served from `/pricing`.
 */
export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: PageProps<"/home/[locale]/pricing">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  return pricingMetadata(locale);
}

export default async function LocalisedPricingPage({
  params,
}: PageProps<"/home/[locale]/pricing">) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) notFound();

  return <PricingView locale={locale} />;
}
