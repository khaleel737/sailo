import type { Metadata } from "next";
import { interpolate } from "@sailo/i18n";
import { getT } from "@/i18n/server";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { PLATFORM_FEE_RANGE_LABEL } from "@/lib/plans";
import { Container, Display, Lede, Section } from "@/components/marketing/kit";
import { faqJsonLd } from "@/lib/seo";
import { PricingSection } from "../_components/pricing-section";

/*
 * Same reason the landing page carries it: the copy is chosen by a cookie, so
 * this cannot prerender until the locale moves into the URL.
 */
export const instant = false;

/**
 * Pricing, on its own URL.
 *
 * It existed only as a section of the homepage, which meant "sailo pricing" —
 * and every "what does X cost" search — had nowhere to land but an anchor. A
 * pricing page is one of the few pages on a small site that reliably earns
 * search traffic *and* converts it, because the person typing it has already
 * decided to compare.
 *
 * `pricing` is in `RESERVED_HANDLES`, so this static segment cannot shadow a
 * seller's shop. Adding any new top-level route without checking that list
 * first is how a seller's storefront silently stops rendering.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getT();
  const m = getMarketingDictionary(locale);

  /*
   * "Pricing · Sailo" rather than a keyword-stuffed sentence. A pricing page
   * is searched by name — "sailo pricing", "sailo cost" — so the plain noun
   * plus the brand is what matches the query, and the description is where the
   * number that decides it goes.
   */
  const title = m.pricing.eyebrow;
  const description = interpolate(m.pricing.body, { fee: PLATFORM_FEE_RANGE_LABEL });

  return {
    title,
    description,
    alternates: { canonical: "/pricing" },
    openGraph: {
      title: `${title} · Sailo`,
      description,
      url: "/pricing",
      type: "website",
    },
  };
}

export default async function PricingPage() {
  const { locale, t } = await getT();
  const m = getMarketingDictionary(locale);

  /*
   * The three questions that are actually about money. The rest of the FAQ
   * belongs on the homepage — repeating all six here would give two pages the
   * same answers and let the crawler pick which one to rank.
   */
  const faqs = [
    { q: m.faq.q3, a: interpolate(m.faq.a3, { fee: PLATFORM_FEE_RANGE_LABEL }) },
    { q: m.faq.q2, a: m.faq.a2 },
    { q: m.faq.q1, a: m.faq.a1 },
  ];

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
