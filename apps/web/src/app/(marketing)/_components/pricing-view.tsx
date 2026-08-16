import type { Metadata } from "next";
import { getDictionary, interpolate } from "@sailo/i18n";
import { LOCALES, type Locale } from "@sailo/i18n/config";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { PLATFORM_FEE_RANGE_LABEL } from "@sailo/core/plans";
import { Container, Display, Lede, Section } from "@/components/marketing/kit";
import { faqJsonLd } from "@/lib/seo";
import { marketingUrl, pricingLanguages, pricingPath } from "@/lib/marketing-urls";
import { PricingSection } from "./pricing-section";

/**
 * Pricing, in one named language.
 *
 * Split out of the route for the same reason the landing page was — see
 * `home-view.tsx`. A pricing page is one of the few on a small site that
 * reliably earns search traffic *and* converts it, because the person typing
 * "sailo pricing" has already decided to compare; having it exist in exactly
 * one indexable language was the more expensive half of that bug.
 */

/**
 * The three questions that are actually about money. The rest of the FAQ
 * belongs on the homepage — repeating all six here would give two pages the
 * same answers and let the crawler pick which one to rank.
 */
function moneyFaqs(m: ReturnType<typeof getMarketingDictionary>) {
  return [
    { q: m.faq.q3, a: interpolate(m.faq.a3, { fee: PLATFORM_FEE_RANGE_LABEL }) },
    { q: m.faq.q2, a: m.faq.a2 },
    { q: m.faq.q1, a: m.faq.a1 },
  ];
}

/**
 * "Pricing · Sailo" rather than a keyword-stuffed sentence. A pricing page is
 * searched by name — "sailo pricing", "sailo cost" — so the plain noun plus the
 * brand is what matches the query, and the description is where the number that
 * decides it goes.
 */
export function pricingMetadata(locale: Locale): Metadata {
  const m = getMarketingDictionary(locale);
  const title = m.pricing.eyebrow;
  const description = interpolate(m.pricing.body, { fee: PLATFORM_FEE_RANGE_LABEL });
  const path = pricingPath(locale);

  return {
    title,
    description,
    alternates: { canonical: path, languages: pricingLanguages() },
    openGraph: {
      title: `${title} · Sailo`,
      description,
      url: marketingUrl(path),
      type: "website",
      locale,
      alternateLocale: LOCALES.map(({ code }) => code).filter((c) => c !== locale),
    },
  };
}

export function PricingView({ locale }: { locale: Locale }) {
  const t = getDictionary(locale);
  const m = getMarketingDictionary(locale);
  const faqs = moneyFaqs(m);

  return (
    <>
      {/* The same structured data the homepage emits, scoped to these three. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(faqs)) }}
      />

      <Section>
        <Container>
          <Display>{m.pricing.title}</Display>
          <Lede>{interpolate(m.pricing.body, { fee: PLATFORM_FEE_RANGE_LABEL })}</Lede>
        </Container>
      </Section>

      <PricingSection t={t} m={m} locale={locale} />

      <Section id="faq" tone="sunk">
        <Container>
          <h2 className="display text-[clamp(1.75rem,3.4vw,2.75rem)] text-[var(--ink)]">
            {m.faq.title}
          </h2>
          <dl className="mt-8 space-y-6">
            {faqs.map((faq) => (
              <div key={faq.q}>
                <dt className="text-[var(--ink)] text-lg font-semibold">{faq.q}</dt>
                <dd className="text-[var(--mute-500)] mt-2 max-w-prose leading-relaxed">
                  {faq.a}
                </dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>
    </>
  );
}
