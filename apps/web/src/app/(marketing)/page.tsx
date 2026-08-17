import { interpolate } from "@sailo/i18n";
import { PLATFORM_FEE_RANGE_LABEL } from "@sailo/core/plans";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getT } from "@/i18n/server";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { LOCALES } from "@sailo/i18n/config";
import { HERO_DEMO, RTL_DEMO, phoneShotUrl, rtlShotUrl } from "@sailo/marketing/demos";
import { BioCard } from "@/components/marketing/bio-card";
import { PhoneFrame } from "@/components/marketing/frames";
import { DemoGallery } from "@/components/marketing/demo-gallery";
import { ShopMarquee } from "@/components/marketing/shop-marquee";
import { ComparePanels } from "@/components/marketing/compare-panels";
import { Counter, MotionProvider } from "@/components/marketing/motion";
import {
  Chip,
  Container,
  Cta,
  Display,
  Lede,
  Rise,
  Section,
  SectionHead,
} from "@/components/marketing/kit";
import { faqJsonLd, softwareJsonLd } from "@/lib/seo";
import { PricingSection } from "./_components/pricing-section";

/*
 * The landing page's copy is chosen by a cookie, so it cannot prerender until
 * the locale moves into the URL. Marked here rather than on the layout, which
 * also wraps 446 blog pages whose language is already in their path.
 */
export const instant = false;


/**
 * The homepage is the one page whose canonical is "/" — it used to be declared
 * on the root layout, where every other route inherited it.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};


/**
 * Splits a headline on its `{highlight}` placeholder. A placeholder rather than
 * three separate strings, because word order moves between languages and the
 * emphasised phrase does not sit in the same place twice.
 */
function splitHighlight(title: string) {
  const [before = "", after = ""] = title.split("{highlight}");
  return { before, after, marked: title.includes("{highlight}") };
}

export default async function HomePage() {
  /*
   * The signed-in redirect is not here any more — it is in `src/proxy.ts`.
   *
   * It has to run before anything is sent. This page sits behind
   * `loading.tsx`, so Next streams the shell and answers 200 the moment
   * rendering starts; a `redirect()` from here therefore arrived after the
   * seller had already seen the splash and then the header and footer wrapped
   * around an empty page. The proxy answers with a real 307 and none of that
   * is ever painted.
   */

  const { locale, t, dir } = await getT();
  const m = getMarketingDictionary(locale);
  const headline = splitHighlight(m.hero.title);

  /*
   * An Arabic visitor reading "your shop reads properly in Arabic" beside a
   * screenshot of an English shop is being asked to take it on trust. The same
   * page was captured in both directions, so show the one that matches.
   */
  const heroShot =
    dir === "rtl" ? rtlShotUrl(RTL_DEMO.handle) : phoneShotUrl(HERO_DEMO.handle);

  const rails = [
    "WhatsApp",
    "Telegram",
    t.rails.instagramName,
    t.rails.cardName,
    t.rails.bankName,
    t.rails.codName,
    t.rails.emailName,
    t.rails.phoneName,
  ];

  const steps = [
    { title: m.steps.s1t, body: m.steps.s1b },
    { title: m.steps.s2t, body: m.steps.s2b },
    { title: m.steps.s3t, body: m.steps.s3b },
  ];

  const faqs = [
    { q: m.faq.q1, a: m.faq.a1 },
    { q: m.faq.q2, a: m.faq.a2 },
    { q: m.faq.q3, a: interpolate(m.faq.a3, { fee: PLATFORM_FEE_RANGE_LABEL }) },
    { q: m.faq.q4, a: m.faq.a4 },
    { q: m.faq.q5, a: m.faq.a5 },
    { q: m.faq.q6, a: m.faq.a6 },
  ];

  const stats = [
    /*
       Counted, not typed. This said 21 while every sentence on the page said
       35 — the number was written down when there were 21 locales and never
       moved again. `LOCALES` is the same list the language switcher renders,
       so adding a dictionary now updates the claim by itself.
    */
    { to: LOCALES.length, suffix: "", label: m.stats.s1 },
    { to: 0, suffix: "%", label: m.stats.s2 },
    { to: 60, suffix: "s", label: m.stats.s3 },
  ];

  return (
    <MotionProvider>
    <>
      {/* Search engines read this; it is the same copy the page shows, so the
          two can never disagree. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([softwareJsonLd(m), faqJsonLd(faqs)]),
        }}
      />

        {/* ---------------------------------------------------------------
            Hero. Asymmetric split: the claim on one side, the proof on the
            other. Four text elements, no more.
        --------------------------------------------------------------- */}
        <section className="relative overflow-hidden">
          <Container className="grid items-center gap-16 pb-20 pt-16 sm:pb-28 lg:grid-cols-[1.08fr_auto] lg:gap-14 lg:pb-32 lg:pt-24">
            <div className="text-center lg:text-start">
              <Rise>
                <p className="inline-flex items-center gap-2.5 rounded-[var(--r-pill)] border border-[var(--mute-200)] px-3.5 py-1.5 text-[0.75rem] text-[var(--mute-500)]">
                  {/*
                    The one live indicator on the page, and it still means what
                    it says — only the claim has moved. It used to mark an open
                    beta; it now marks an open door. The free plan is a real
                    tier in `plans.ts` at zero a month, not a countdown, which
                    is why the badge no longer implies one.
                  */}
                  <span className="size-1.5 rounded-full bg-[var(--signal)]" />
                  {m.hero.badge}
                </p>
              </Rise>

              <Rise delay={0.08}>
                <Display as="h1" size="lg" className="mt-7">
                  {headline.before}
                  {headline.marked ? (
                    <span className="underline decoration-[var(--mute-300)] decoration-[0.06em] underline-offset-[0.14em]">
                      {m.hero.titleHighlight}
                    </span>
                  ) : null}
                  {headline.after}
                </Display>
              </Rise>

              <Rise delay={0.16}>
                <Lede className="mx-auto mt-7 max-w-[34rem] lg:mx-0">
                  {m.hero.body}
                </Lede>
              </Rise>

              <Rise delay={0.24}>
                <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
                  <Cta href="/signup" magnetic className="group w-full sm:w-auto">
                    {m.hero.ctaPrimary}
                    <ArrowRight className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
                  </Cta>
                  <a
                    href="#demos"
                    className="focus-line push inline-flex h-14 w-full items-center justify-center rounded-[var(--r-pill)] border border-[var(--mute-200)] px-8 text-[0.9375rem] font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)] sm:w-auto"
                  >
                    {m.hero.ctaSecondary}
                  </a>
                </div>
              </Rise>
            </div>

            {/* The argument in one picture: a bio with a link in it, and the
                shop that link opens. Both are real. The phone is a screenshot
                of /forno taken by `npm run shots`. */}
            <Rise
              delay={0.12}
              className="mx-auto flex w-full max-w-sm flex-col items-center gap-8 lg:mx-0 lg:max-w-none lg:flex-row lg:items-start lg:gap-6"
            >
              <div className="w-full shrink-0 lg:mt-4 lg:w-[15.5rem] xl:w-[17rem]">
                <BioCard
                  handle={HERO_DEMO.instagram}
                  name={HERO_DEMO.name}
                  initials="FN"
                  accent={HERO_DEMO.accent}
                  linkLabel={`sailo.store/${HERO_DEMO.handle}`}
                  t={m}
                />
                <p className="mt-5 flex items-center justify-center gap-2.5 text-[0.8125rem] text-[var(--mute-400)] lg:justify-start">
                  <ArrowRight className="size-4 shrink-0 rtl:rotate-180" />
                  {m.hero.tapCaption}
                </p>
              </div>

              {/*
                `sizes` mirrors the width classes above it, breakpoint for
                breakpoint. It used to claim 256px on every screen under
                1024px while the frame is `w-56` — 224px — below `sm`, and an
                overstated `sizes` is not a rounding error: it picks the next
                candidate up out of the srcset, so the phone that can least
                afford it downloaded the widest file.
              */}
              <PhoneFrame
                src={heroShot}
                alt={HERO_DEMO.name}
                priority
                className="w-56 shrink-0 sm:w-64 lg:mt-16 lg:w-[13.5rem] xl:w-[15rem]"
                sizes="(min-width: 1280px) 240px, (min-width: 1024px) 216px, (min-width: 640px) 256px, 224px"
              />
            </Rise>
          </Container>
        </section>

        <ShopMarquee label={m.proof.title} />

        {/* ---------------------------------------------------------------
            Live shops.

            This sits directly under the hero, ahead of any argument, because
            five real pages are more persuasive than a paragraph claiming they
            exist — and a visitor who bounces before scrolling should still
            have seen the product working.
        --------------------------------------------------------------- */}
        <Section id="demos" tone="ink">
          <SectionHead
            eyebrow={m.demos.eyebrow}
            title={m.demos.title}
            body={m.demos.body}
            tone="paper"
          />
          <div className="mt-16">
            <DemoGallery t={m} />
          </div>
        </Section>

        {/* ---------------------------------------------------------------
            The two kinds of page, shown side by side. No competitor is named:
            see the note in `compare-panels.tsx`.
        --------------------------------------------------------------- */}
        <Section id="compare">
          <SectionHead
            eyebrow={m.compare.eyebrow}
            title={m.compare.title}
            body={m.compare.body}
          />
          <ComparePanels t={m} />
        </Section>

        {/* ---------------------------------------------------------------
            How it works. Three rules and three paragraphs, no cards: the
            content is prose and boxing prose is what makes a page look like a
            component library on a background.
        --------------------------------------------------------------- */}
        <Section tone="sunk">
          <SectionHead title={m.steps.title} body={m.steps.body} align="start" />

          <ol className="mt-16 grid gap-px overflow-hidden rounded-[var(--r-card)] bg-[var(--mute-200)] md:grid-cols-3">
            {steps.map((step, i) => (
              <li key={step.title} className="reveal bg-[var(--paper-sunk)] p-8 lg:p-10">
                <span className="tabular text-[0.8125rem] text-[var(--mute-400)]">
                  0{i + 1}
                </span>
                <h3 className="display-sm mt-6 text-[1.375rem] text-[var(--ink)]">
                  {step.title}
                </h3>
                <p className="mt-4 leading-relaxed text-[var(--mute-500)]">{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ---------------------------------------------------------------
            Features. A bento with exactly six cells, sized by how much each
            claim has to carry.
        --------------------------------------------------------------- */}
        <Section id="features">
          <SectionHead
            eyebrow={m.features.eyebrow}
            title={m.features.title}
            body={m.features.body}
          />

          <div className="mt-16 grid gap-px overflow-hidden rounded-[var(--r-card)] bg-[var(--mute-200)] lg:grid-cols-3">
            <div className="reveal bg-[var(--ink)] p-8 text-[var(--paper)] lg:col-span-2 lg:p-12">
              <h3 className="display-sm text-[clamp(1.5rem,2.6vw,2rem)] text-[var(--paper)]">
                {m.features.f5t}
              </h3>
              <p className="mt-5 max-w-xl leading-relaxed text-[var(--on-ink-soft)]">
                {m.features.f5b}
              </p>
              <ul className="mt-9 flex flex-wrap gap-2">
                {rails.slice(0, 5).map((rail) => (
                  <li key={rail}>
                    <Chip tone="paper">{rail}</Chip>
                  </li>
                ))}
              </ul>
            </div>

            {/* Four ordinary tiles fill row one's remaining column and all of
                row two. The count is deliberate: a bento with a hole in it is
                a planning error, not a style. */}
            {[
              { title: m.features.f1t, body: m.features.f1b },
              { title: m.features.f2t, body: m.features.f2b },
              { title: m.features.f3t, body: m.features.f3b },
              { title: m.features.f4t, body: m.features.f4b },
            ].map((feature) => (
              <div key={feature.title} className="reveal bg-[var(--paper)] p-8 lg:p-10">
                <h3 className="display-sm text-[1.125rem] text-[var(--ink)]">
                  {feature.title}
                </h3>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--mute-500)]">
                  {feature.body}
                </p>
              </div>
            ))}

            {/* Analytics closes the grid on a full-width tile. Its proof is a
                list of nouns rather than a paragraph, so it reads across. */}
            <div className="reveal bg-[var(--paper)] p-8 lg:col-span-3 lg:p-10">
              <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-16">
                <div>
                  <h3 className="display-sm text-[1.125rem] text-[var(--ink)]">
                    {m.features.f6t}
                  </h3>
                  <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-[var(--mute-500)]">
                    {m.features.f6b}
                  </p>
                </div>
                <ul className="flex flex-wrap gap-2 lg:justify-end">
                  {[t.nav.overview, t.nav.orders, t.nav.clients, t.nav.reviews].map(
                    (label) => (
                      <li key={label}>
                        <Chip>{label}</Chip>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------
            Twenty-one languages, and the screenshot that proves it
        --------------------------------------------------------------- */}
        <Section tone="sunk">
          <div className="grid items-center gap-16 lg:grid-cols-[1fr_auto] lg:gap-24">
            <div>
              <SectionHead
                title={m.languages.title}
                body={m.languages.body}
                align="start"
              />

              <ul className="reveal mt-10 flex flex-wrap gap-2">
                {LOCALES.map((item) => (
                  <li
                    key={item.code}
                    // Each name in its own script's direction, so Arabic reads
                    // right-to-left inside an otherwise left-to-right list.
                    dir={item.dir}
                    lang={item.code}
                    className="rounded-[var(--r-pill)] border border-[var(--mute-200)] px-3.5 py-2 text-[0.8125rem] text-[var(--mute-600)]"
                  >
                    {item.native}
                  </li>
                ))}
              </ul>
            </div>

            <div className="reveal mx-auto flex max-w-xs flex-col items-center gap-6 lg:mx-0">
              <PhoneFrame
                src={rtlShotUrl(RTL_DEMO.handle)}
                alt={m.languages.rtl}
                className="w-52 sm:w-56"
                sizes="(min-width: 640px) 224px, 208px"
              />
              <div className="text-center">
                <p className="font-medium text-[var(--ink)]">{m.languages.rtl}</p>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--mute-400)]">
                  {m.languages.rtlNote}
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------
            The three numbers that decide it
        --------------------------------------------------------------- */}
        <Section tone="ink" className="py-20 sm:py-24 lg:py-28">
          <dl className="grid gap-14 sm:grid-cols-3 sm:gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <Counter
                    to={stat.to}
                    suffix={stat.suffix}
                    className="display tabular block text-[clamp(3.25rem,8vw,5rem)] text-[var(--paper)]"
                  />
                  <span className="mx-auto mt-5 block max-w-[15rem] text-pretty text-[0.875rem] leading-relaxed text-[var(--on-ink-mute)]">
                    {stat.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <PricingSection t={t} m={m} locale={locale} />

        {/* ---------------------------------------------------------------
            Questions
        --------------------------------------------------------------- */}
        <Section id="faq" tone="sunk">
          <div className="grid gap-14 lg:grid-cols-[20rem_1fr] lg:gap-24">
            <div>
              <p className="mb-5 text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-[var(--mute-400)]">
                {m.faq.eyebrow}
              </p>
              <Display>{m.faq.title}</Display>
            </div>

            <div className="border-t border-[var(--mute-200)]">
              {faqs.map((faq, i) => (
                <details
                  key={faq.q}
                  // The first one is open, so the pattern is obvious without
                  // anyone having to click to discover it.
                  open={i === 0}
                  className="group border-b border-[var(--mute-200)]"
                >
                  <summary className="focus-line flex cursor-pointer list-none items-center justify-between gap-8 py-7 text-start text-[1.0625rem] text-[var(--ink)] [&::-webkit-details-marker]:hidden">
                    {faq.q}
                    <span
                      aria-hidden
                      className="relative size-4 shrink-0 text-[var(--mute-400)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-open:rotate-45"
                    >
                      <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-current" />
                      <span className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-current" />
                    </span>
                  </summary>
                  <p className="pb-8 pe-12 leading-relaxed text-[var(--mute-500)]">
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------
            Closing argument
        --------------------------------------------------------------- */}
        <Section tone="ink" className="py-28 sm:py-36 lg:py-44">
          <div className="mx-auto max-w-3xl text-center">
            <Display as="h2" size="lg" tone="paper">
              {m.cta.title}
            </Display>
            <Lede tone="paper" className="mx-auto mt-7 max-w-xl">
              {m.cta.body}
            </Lede>
            <div className="mt-11 flex justify-center">
              <Cta href="/signup" tone="invert" magnetic className="group">
                {m.cta.button}
                <ArrowRight className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
              </Cta>
            </div>
            <p className="mt-6 text-[0.8125rem] text-[var(--on-ink-mute)]">{m.cta.note}</p>
          </div>
        </Section>
    </>
    </MotionProvider>
  );
}
