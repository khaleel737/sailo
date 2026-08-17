import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Gift, Link2, Share2, Wallet } from "lucide-react";
import { getShopByHandle } from "@/lib/queries";
import { AffiliateSignupForm } from "@/app/[handle]/affiliate/_components/affiliate-signup-form";
import { formatPercent } from "@sailo/core/pricing";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { PoweredBy } from "@/components/shared/powered-by";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { isShopLive } from "@sailo/core/visibility";
import { shopThemeVars } from "@sailo/design-system/web/cn";
import { can } from "@sailo/core/plans";

export async function generateMetadata({
  params,
}: PageProps<"/[handle]/affiliate">): Promise<Metadata> {
  const { handle } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop) return { title: "Not found" };

  return {
    title: `Refer & earn · ${shop.name}`,
    description: `Earn ${formatPercent(shop.affiliateDefaultBp)}% by sharing ${shop.name}.`,
  };
}

export default async function AffiliatePage({
  params,
}: PageProps<"/[handle]/affiliate">) {
  const { handle } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop || !isShopLive(shop)) notFound();
  if (!shop.affiliatesEnabled || !can(shop, "affiliates")) notFound();

  const percent = formatPercent(shop.affiliateDefaultBp);
  const { locale, t, dir } = await getShopT(shop.locale);

  const STEPS = [
    {
      icon: Link2,
      title: t.affiliate.step1,
      body: shop.affiliatePublicSignup
        ? t.affiliate.step1Signup
        : t.affiliate.step1Buyer,
    },
    {
      icon: Share2,
      title: t.affiliate.step2,
      body: t.affiliate.step2Body,
    },
    {
      icon: Wallet,
      title: interpolate(t.affiliate.step3, { percent }),
      body: interpolate(t.affiliate.step3Body, { percent }),
    },
  ];

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[680px] px-4 pb-20 pt-8">
        <Link
          href={`/${shop.handle}`}
          className="text-muted mb-8 inline-flex items-center gap-1.5 text-sm transition pointer-coarse:min-h-11 hover:opacity-70"
        >
          <ArrowLeft className="size-4" />
          {shop.name}
        </Link>

        <header className="text-center">
          <span className="accent-bg mx-auto flex size-14 items-center justify-center rounded-full">
            <Gift className="size-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            {interpolate(t.affiliate.title, { percent, shop: shop.name })}
          </h1>
          <p className="text-muted mx-auto mt-2 max-w-md text-sm leading-relaxed">
            {t.affiliate.intro}
          </p>
        </header>

        <ol className="mt-10 space-y-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="surface-card flex gap-4 rounded-2xl p-4">
              <span className="surface-elevated flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <step.icon className="size-4 shrink-0 opacity-60" />
                  {step.title}
                </p>
                <p className="text-muted mt-1 text-sm leading-relaxed">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {shop.affiliatePublicSignup ? (
          <div className="mt-8">
            <h2 className="mb-3 text-sm font-semibold">
              {t.affiliate.applyTitle}
            </h2>
            <AffiliateSignupForm shopId={shop.id} t={t} />
          </div>
        ) : (
          <p className="surface-card mt-8 rounded-2xl p-4 text-center text-sm">
            {t.affiliate.inviteOnly}
          </p>
        )}

        {shop.affiliateTerms ? (
          <div className="mt-8">
            <h2 className="mb-2 text-sm font-semibold">{t.affiliate.terms}</h2>
            <p className="text-muted whitespace-pre-wrap text-sm leading-relaxed">
              {shop.affiliateTerms}
            </p>
          </div>
        ) : null}

        <footer className="mt-12 flex flex-col items-center gap-3 text-center">
          {/* Someone who already has a link comes here looking for numbers. */}
          <Link
            href="/partner"
            className="text-muted text-xs underline underline-offset-2 transition pointer-coarse:-my-3.5 pointer-coarse:inline-block pointer-coarse:py-3.5 hover:opacity-70"
          >
            {t.partner.signInTitle}
          </Link>
          {/*
            Renders nothing under today's plans, and that is correct rather
            than dead: this page is gated on `affiliates`, which only Business
            has, and Business also has `removeBadge`. The two are exactly
            anti-correlated, so no shop can both reach this page and carry the
            badge. Kept because the gate belongs to the plan matrix, not to
            this file — the day a plan offers affiliates without removing the
            badge, this page brands itself like every other.
          */}
          <PoweredBy shop={shop} t={t} />
          <LanguageSwitcher current={locale} label={t.common.language} />
        </footer>
      </div>
    </div>
  );
}
