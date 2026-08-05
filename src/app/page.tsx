import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { getSession } from "@/lib/session";
import { getT } from "@/i18n/server";
import { getMarketingDictionary } from "@/i18n/marketing";
import { interpolate } from "@/i18n";
import { LOCALES } from "@/i18n/config";
import { PLANS } from "@/lib/plans";
import { formatMoney } from "@/lib/utils";
import { DEMOS, HERO_DEMO, RTL_DEMO, phoneShotUrl, rtlShotUrl } from "@/lib/demos";
import { SailoLogo } from "@/components/brand";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { SiteNav } from "@/components/marketing/site-nav";
import { BioCard } from "@/components/marketing/bio-card";
import { PhoneFrame } from "@/components/marketing/frames";
import { DemoGallery } from "@/components/marketing/demo-gallery";
import { ShopMarquee } from "@/components/marketing/shop-marquee";
import { Versus } from "@/components/marketing/versus";
import { Counter, MotionProvider, Stagger } from "@/components/marketing/motion";
import {
  Chip,
  Container,
  Cta,
  Display,
  Lede,
  Section,
  SectionHead,
} from "@/components/marketing/kit";
import { APP_URL, faqJsonLd, softwareJsonLd } from "@/lib/seo";

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
  if (await getSession()) redirect("/admin");

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
    { q: m.faq.q3, a: m.faq.a3 },
    { q: m.faq.q4, a: m.faq.a4 },
    { q: m.faq.q5, a: m.faq.a5 },
    { q: m.faq.q6, a: m.faq.a6 },
  ];

  const stats = [
    { to: 21, suffix: "", label: m.stats.s1 },
    { to: 0, suffix: "%", label: m.stats.s2 },
    { to: 60, suffix: "s", label: m.stats.s3 },
  ];

  const plans = [
    { plan: PLANS.free, tagline: m.pricing.freeTagline, carry: null },
    { plan: PLANS.pro, tagline: m.pricing.proTagline, carry: m.pricing.everythingFree },
    {
      plan: PLANS.business,
      tagline: m.pricing.bizTagline,
      carry: m.pricing.everythingPro,
    },
  ];

  return (
    <MotionProvider>
    <div className="brand-surface flex min-h-screen flex-col">
      {/* Search engines read this; it is the same copy the page shows, so the
          two can never disagree. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([softwareJsonLd(m), faqJsonLd(faqs)]),
        }}
      />

      <a
        href="#main"
        className="focus-line sr-only focus:not-sr-only focus:absolute focus:start-5 focus:top-5 focus:z-50 focus:rounded-[var(--r-pill)] focus:bg-[var(--ink)] focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-[var(--paper)]"
      >
        {m.nav.skip}
      </a>

      <SiteNav t={m} locale={locale} languageLabel={t.common.language} />

      <main id="main" className="flex-1">
        {/* ---------------------------------------------------------------
            Hero. Asymmetric split: the claim on one side, the proof on the
            other. Four text elements, no more.
        --------------------------------------------------------------- */}
        <section className="relative overflow-hidden">
          <Container className="grid items-center gap-16 pb-20 pt-16 sm:pb-28 lg:grid-cols-[1.08fr_auto] lg:gap-14 lg:pb-32 lg:pt-24">
            <div className="text-center lg:text-start">
              <Stagger>
                <p className="inline-flex items-center gap-2.5 rounded-[var(--r-pill)] border border-[var(--mute-200)] px-3.5 py-1.5 text-[0.75rem] text-[var(--mute-500)]">
                  {/* The one live indicator on the page, and it means what it
                      says: the beta is open right now. */}
                  <span className="size-1.5 rounded-full bg-[var(--signal)]" />
                  {m.hero.badge}
                </p>
              </Stagger>

              <Stagger delay={0.08}>
                <Display as="h1" size="lg" className="mt-7">
                  {headline.before}
                  {headline.marked ? (
                    <span className="underline decoration-[var(--mute-300)] decoration-[0.06em] underline-offset-[0.14em]">
                      {m.hero.titleHighlight}
                    </span>
                  ) : null}
                  {headline.after}
                </Display>
              </Stagger>

              <Stagger delay={0.16}>
                <Lede className="mx-auto mt-7 max-w-[34rem] lg:mx-0">
                  {m.hero.body}
                </Lede>
              </Stagger>

              <Stagger delay={0.24}>
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
              </Stagger>
            </div>

            {/* The argument in one picture: a bio with a link in it, and the
                shop that link opens. Both are real. The phone is a screenshot
                of /forno taken by `npm run shots`. */}
            <Stagger
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

              <PhoneFrame
                src={heroShot}
                alt={HERO_DEMO.name}
                priority
                className="w-56 shrink-0 sm:w-64 lg:mt-16 lg:w-[13.5rem] xl:w-[15rem]"
                sizes="(min-width: 1280px) 240px, (min-width: 1024px) 216px, 256px"
              />
            </Stagger>
          </Container>
        </section>

        <ShopMarquee label={m.proof.title} />

        {/* ---------------------------------------------------------------
            Where Sailo sits against the tools this audience already knows
        --------------------------------------------------------------- */}
        <Section id="compare">
          <SectionHead title={m.versus.title} body={m.versus.body} />
          <div className="reveal">
            <Versus t={m} />
          </div>
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
            Live shops
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

        {/* ---------------------------------------------------------------
            Pricing
        --------------------------------------------------------------- */}
        <Section id="pricing">
          <SectionHead
            eyebrow={m.pricing.eyebrow}
            title={m.pricing.title}
            body={m.pricing.body}
          />

          <div className="mt-16 grid gap-px overflow-hidden rounded-[var(--r-card)] bg-[var(--mute-200)] lg:grid-cols-3">
            {plans.map(({ plan, tagline, carry }) => {
              const featured = plan.id === "business";
              return (
                <div
                  key={plan.id}
                  className={
                    featured
                      ? "reveal flex flex-col bg-[var(--ink)] p-8 text-[var(--paper)] lg:p-10"
                      : "reveal flex flex-col bg-[var(--paper)] p-8 lg:p-10"
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3
                      className={
                        featured
                          ? "text-[1.0625rem] font-medium text-[var(--paper)]"
                          : "text-[1.0625rem] font-medium text-[var(--ink)]"
                      }
                    >
                      {plan.name}
                    </h3>
                    {featured ? (
                      <span className="rounded-[var(--r-pill)] border border-white/20 px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--on-ink-soft)]">
                        {t.billing.bestValue}
                      </span>
                    ) : null}
                  </div>

                  <p
                    className={
                      featured
                        ? "mt-3 min-h-12 text-[0.9375rem] leading-relaxed text-[var(--on-ink-mute)]"
                        : "mt-3 min-h-12 text-[0.9375rem] leading-relaxed text-[var(--mute-500)]"
                    }
                  >
                    {tagline}
                  </p>

                  <p className="mt-9 flex items-baseline gap-2">
                    <span
                      className={
                        featured
                          ? "display tabular text-[3rem] text-[var(--paper)]"
                          : "display tabular text-[3rem] text-[var(--ink)]"
                      }
                    >
                      {plan.monthlyCents === 0
                        ? t.common.free
                        : formatMoney(plan.monthlyCents, "USD")}
                    </span>
                    {plan.monthlyCents > 0 ? (
                      <span
                        className={
                          featured
                            ? "text-[0.875rem] text-[var(--on-ink-mute)]"
                            : "text-[0.875rem] text-[var(--mute-400)]"
                        }
                      >
                        {t.billing.perMonth}
                      </span>
                    ) : null}
                  </p>
                  <p
                    className={
                      featured
                        ? "tabular mt-2 min-h-5 text-[0.8125rem] text-[var(--on-ink-mute)]"
                        : "tabular mt-2 min-h-5 text-[0.8125rem] text-[var(--mute-400)]"
                    }
                  >
                    {plan.yearlyCents > 0
                      ? interpolate(t.billing.billedYearly, {
                          amount: formatMoney(plan.yearlyCents, "USD"),
                        })
                      : ""}
                  </p>

                  <Cta
                    href="/signup"
                    tone={featured ? "invert" : "outline"}
                    size="md"
                    className="mt-9 w-full"
                  >
                    {plan.id === "free"
                      ? m.pricing.start
                      : interpolate(m.pricing.choose, { plan: plan.name })}
                  </Cta>

                  {carry ? (
                    <p
                      className={
                        featured
                          ? "mt-9 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[var(--on-ink-mute)]"
                          : "mt-9 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[var(--mute-400)]"
                      }
                    >
                      {carry}
                    </p>
                  ) : null}
                  <ul className={carry ? "mt-5 space-y-3.5" : "mt-9 space-y-3.5"}>
                    {plan.highlights.map((key) => (
                      <li
                        key={key}
                        className={
                          featured
                            ? "flex gap-3 text-[0.875rem] leading-snug text-[var(--on-ink-soft)]"
                            : "flex gap-3 text-[0.875rem] leading-snug text-[var(--mute-600)]"
                        }
                      >
                        <Check
                          className="mt-px size-4 shrink-0 opacity-45"
                          strokeWidth={2.5}
                        />
                        {t.highlights[key]}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <p className="mt-10 text-center text-[0.8125rem] text-[var(--mute-400)]">
            {t.billing.cancelAnyTime}
          </p>
        </Section>

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
      </main>

      <footer className="border-t border-[var(--mute-200)] py-16">
        <Container>
          <div className="grid gap-12 sm:grid-cols-[1fr_auto] sm:items-start">
            <div>
              <SailoLogo className="h-5 w-auto text-[var(--mute-400)]" />
              <p className="mt-5 max-w-xs text-[0.875rem] leading-relaxed text-[var(--mute-500)]">
                {m.footer.tagline}
              </p>
              <div className="mt-6">
                <LanguageSwitcher
                  current={locale}
                  align="start"
                  label={t.common.language}
                  size="md"
                />
              </div>
            </div>

            <div className="grid gap-10 sm:grid-cols-2 sm:gap-16">
              <nav aria-label={m.footer.liveShops}>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-[var(--mute-400)]">
                  {m.footer.liveShops}
                </p>
                <ul className="mt-5 grid gap-3">
                  {DEMOS.map((demo) => (
                    <li key={demo.handle}>
                      <Link
                        href={`/${demo.handle}`}
                        className="focus-line group inline-flex min-h-11 items-center gap-1.5 text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
                      >
                        {demo.name}
                        <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>

              {/* Its own column, not a line of small print at the very bottom.
                  A buyer deciding whether to trust a shop, and a payment
                  provider reviewing the platform, both look for these first. */}
              <nav aria-label={m.footer.legal}>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-[var(--mute-400)]">
                  {m.footer.legal}
                </p>
                <ul className="mt-5 grid gap-3">
                  {[
                    { href: "/privacy", label: m.footer.privacy },
                    { href: "/terms", label: m.footer.terms },
                    { href: "/refunds", label: m.footer.refunds },
                  ].map((doc) => (
                    <li key={doc.href}>
                      <Link
                        href={doc.href}
                        className="focus-line inline-flex min-h-11 items-center text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
                      >
                        {doc.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>

          <div className="mt-14 flex flex-wrap items-center justify-between gap-5 border-t border-[var(--mute-200)] pt-8 text-[0.8125rem] text-[var(--mute-400)]">
            <span className="tabular">
              © {new Date().getFullYear()} Sailo. {m.footer.rights}
            </span>
            <div className="flex items-center gap-7">
              <Link href="/login" className="focus-line inline-flex min-h-11 items-center transition-colors hover:text-[var(--ink)]">
                {m.nav.signIn}
              </Link>
              <Link href="/signup" className="focus-line inline-flex min-h-11 items-center transition-colors hover:text-[var(--ink)]">
                {m.nav.createShop}
              </Link>
              <span dir="ltr">{new URL(APP_URL).host}</span>
            </div>
          </div>
        </Container>
      </footer>
    </div>
    </MotionProvider>
  );
}
