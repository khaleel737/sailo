import Link from "next/link";
import { headers } from "next/headers";
import { AlertTriangle, ArrowUpRight, CreditCard, Lock } from "lucide-react";
import {
  isStripeAccountCountry,
  normalizeCountry,
  stripeAccountCountriesByName,
} from "@sailo/core/countries";
import type { Shop } from "@sailo/db/schema";
import { connectState } from "@/lib/connect";
import { can, cheapestPlanWith, platformFeeLabel } from "@sailo/core/plans";
import {
  connectStripe,
  disconnectStripe,
  openStripeDashboard,
  refreshStripeAccount,
} from "@/lib/actions/connect";
import { Alert, Badge, Button, Card } from "@sailo/design-system/web";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { cn } from "@/lib/utils";

/**
 * The Stripe rail is configured by connecting an account, not by filling in
 * fields, so it gets its own card rather than the generic method form.
 */
export async function StripeCard({ shop }: { shop: Shop }) {
  const { a, locale } = await getAdminT();
  const entitled = can(shop, "cardRails");
  const state = connectState(shop);
  const needs = cheapestPlanWith("cardRails");

  const live = entitled && state === "active";

  /*
   * The country dropdown's contents and its starting value.
   *
   * Only the countries Stripe will actually open an account in — offering the
   * full ISO list would let a seller pick one and meet a Stripe error instead
   * of an onboarding form. Named and sorted in the seller's own language,
   * because nobody scans a dropdown looking for "DE".
   *
   * The guess comes from the edge's view of where the request came from, which
   * is the same signal `auth.ts` already records for sessions. It is a guess
   * and is labelled as one: a seller on holiday, or behind a VPN, must find it
   * easy to correct — this is the one field on the page that cannot be fixed
   * afterwards.
   */
  const countries = stripeAccountCountriesByName(locale);
  const guess = normalizeCountry((await headers()).get("x-vercel-ip-country"));
  const defaultCountry = shop.stripeCountry ?? (isStripeAccountCountry(guess) ? guess : null);
  const guessed = !shop.stripeCountry && Boolean(defaultCountry);

  return (
    // Tinted the same way a live chat rail is, so "working" looks identical
    // wherever it appears on this page.
    <Card
      className={cn(
        "p-5 transition-colors",
        live && "border-brand-200 bg-brand-50/40",
      )}
    >
      <div className="flex gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl border",
            live
              ? "border-brand-200 bg-white text-brand-700"
              : "border-ink-200 bg-ink-50 text-ink-500",
          )}
        >
          <CreditCard className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-ink-900">{a.payments.cardTitle}</h3>
            {!entitled && needs ? (
              <Badge tone="amber">
                <Lock className="size-3" />
                {needs.name}
              </Badge>
            ) : state === "active" ? (
              <Badge tone="green" dot>
                {a.common.live}
              </Badge>
            ) : state === "verifying" ? (
              <Badge tone="amber" dot>
                {a.payments.stripeVerifying}
              </Badge>
            ) : state === "onboarding" ? (
              <Badge tone="amber" dot>
                {a.payments.finishSetup}
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                {a.payments.notConnected}
              </Badge>
            )}
          </div>
          <p className="mt-1 max-w-lg text-xs leading-relaxed text-ink-500">
            {/* This seller's own rate, not the ladder: they have a plan, so
                naming the range here would make them work out which third of
                it applies to them. The marketing pages, which have no shop,
                are the only place the range belongs. */}
            {interpolate(a.payments.cardBody, { fee: platformFeeLabel(shop) })}
          </p>
        </div>
      </div>

      {!entitled ? (
        <p className="mt-4 rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-600">
          {interpolate(a.payments.cardOnPlan, {
            plan: needs?.name ?? "—",
          })}{" "}
          <Link
            href="/admin/settings/billing"
            className="focus-ring rounded font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
          >
            {a.payments.seePlans}
          </Link>
        </p>
      ) : state === "not_connected" ? (
        <form action={connectStripe} className="mt-4">
          {/*
            Asked here, on the form that creates the account, because Stripe
            fixes an account's country at creation and provides no way to
            change it. Leaving it out does not defer the question — it answers
            it with the platform's own country, which is how every seller
            outside the US was silently onboarded as an American business and
            no local payment method could ever activate.
          */}
          <label
            htmlFor="stripe-country"
            className="block text-sm font-medium text-ink-900"
          >
            {a.payments.businessCountry}
          </label>
          <select
            id="stripe-country"
            name="country"
            defaultValue={defaultCountry ?? ""}
            required
            className="focus-ring mt-1.5 h-10 w-full max-w-xs rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 pointer-coarse:h-11"
          >
            {/* An empty option so a seller with no guess has to choose rather
                than accept whichever country sorts first. */}
            <option value="" disabled>
              —
            </option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 max-w-lg text-xs text-ink-500">
            {a.payments.businessCountryHint}
            {guessed ? ` ${a.payments.businessCountryGuess}` : ""}
          </p>

          <button
            type="submit"
            className="focus-ring press mt-3 inline-flex h-10 items-center gap-2 rounded-xl pointer-coarse:h-11 bg-[#635bff] px-4 text-sm font-medium text-white shadow-xs transition hover:bg-[#5148e8]"
          >
            {a.payments.connectStripe}
            <ArrowUpRight className="size-4 rtl:-scale-x-100" />
          </button>
          <p className="mt-2 text-xs text-ink-400">
            {a.payments.connectHint}
          </p>
        </form>
      ) : (
        <div className="mt-4 space-y-3">
          {state !== "active" ? (
            <Alert tone="warning" icon={<AlertTriangle className="size-4" />}>
              {state === "onboarding"
                ? a.payments.stripeNeedsDetails
                : a.payments.stripeChecking}
            </Alert>
          ) : null}

          <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-ink-200 bg-white p-3 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-xs text-ink-500">{a.payments.account}</dt>
              <dd className="mt-0.5 font-mono text-xs text-ink-700">
                {shop.stripeAccountId}
              </dd>
            </div>
            {shop.stripeAccountCountry ? (
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-xs text-ink-500">{a.payments.country}</dt>
                <dd className="mt-0.5 text-xs text-ink-700">
                  {shop.stripeAccountCountry}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="flex flex-wrap gap-2">
            {state !== "active" ? (
              <form action={connectStripe}>
                <button
                  type="submit"
                  className="focus-ring press inline-flex h-9 pointer-coarse:h-11 items-center gap-1.5 rounded-xl bg-[#635bff] px-3 text-sm font-medium text-white shadow-xs transition hover:bg-[#5148e8]"
                >
                  {a.payments.continueOnStripe}
                  <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
                </button>
              </form>
            ) : (
              <form action={openStripeDashboard}>
                <Button type="submit" variant="secondary" size="sm">
                  {a.payments.payoutsOnStripe}
                  <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
                </Button>
              </form>
            )}

            <form action={refreshStripeAccount}>
              <Button type="submit" variant="secondary" size="sm">
                {a.payments.refreshStatus}
              </Button>
            </form>

            <form action={disconnectStripe}>
              <Button type="submit" variant="ghost" size="sm">
                {a.payments.disconnect}
              </Button>
            </form>
          </div>

          <p className="text-xs text-ink-400">
            {a.payments.disconnectHint}
          </p>
        </div>
      )}
    </Card>
  );
}
