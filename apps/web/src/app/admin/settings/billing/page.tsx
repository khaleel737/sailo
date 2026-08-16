import type { Metadata } from "next";
import { firstRow } from "@sailo/core/invariant";
import { Check, ExternalLink, Sparkles } from "lucide-react";
import { count, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { openBillingPortal, startCheckout } from "@/lib/actions/billing";
import { syncSubscriptionForShop } from "@sailo/billing/sync";
import { PLAN_IDS, PLANS, planFor, platformFeeLabel, productLimit } from "@sailo/core/plans";
import { billingEnabled } from "@sailo/payments";
import { IntervalToggle } from "@/app/admin/settings/billing/_components/interval-toggle";
import { Alert, Badge, Button, Card, Progress } from "@sailo/design-system/web";
import { formatMoney } from "@/lib/utils";
import { interpolate } from "@sailo/i18n";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({
  searchParams,
}: PageProps<"/admin/settings/billing">) {
  const { shop } = await requireShop();
  const { t, a, locale } = await getAdminT();
  const params = await searchParams;

  // Returning from Checkout, the webhook may still be in flight — pull the
  // truth from Stripe so the page is never stale for the seller.
  if (params.checkout === "success" && billingEnabled()) {
    await syncSubscriptionForShop(shop.id);
  }

  const { shop: fresh } = await requireShop();
  const current = planFor(fresh);
  const interval = params.interval === "year" ? "year" : "month";

  const { value: productCount } = firstRow(
    await getDb()
      .select({ value: count() })
      .from(products)
      .where(eq(products.shopId, fresh.id)),
    "value aggregate",
  );

  const limit = productLimit(fresh);
  const atLimit = limit !== null && productCount >= limit;

  return (
    <>
      {params.checkout === "cancelled" ? (
        <Alert tone="info" className="mb-5">
          {a.billing.cancelled}
        </Alert>
      ) : null}

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-ink-500">{a.billing.currentPlan}</h2>
              {fresh.subscriptionStatus === "past_due" ? (
                <Badge tone="red" dot>
                  {a.billing.paymentFailed}
                </Badge>
              ) : fresh.cancelAtPeriodEnd ? (
                <Badge tone="amber" dot>
                  {a.billing.cancelsAtPeriodEnd}
                </Badge>
              ) : (
                <Badge tone="green" dot>
                  {a.billing.active}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">
              {current.name}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {interpolate(a.billing.slotsUsed, {
                used: productCount,
                limit: limit ?? a.common.unlimited.toLowerCase(),
              })}
              {/* Every plan takes card now, so this line always renders — and
                  it used to read "0% fee on card payments" unconditionally,
                  which became a lie for all three tiers the moment the fee
                  ladder shipped. It states this shop's own rate instead. */}
              {` · ${interpolate(a.billing.cardFee, { fee: platformFeeLabel(fresh) })}`}
            </p>
            {fresh.currentPeriodEnd ? (
              <p className="mt-0.5 text-xs text-ink-400">
                {fresh.cancelAtPeriodEnd ? a.billing.accessEnds : a.billing.renews}{" "}
                {fresh.currentPeriodEnd.toLocaleDateString(locale, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            ) : null}
          </div>

          {fresh.stripeCustomerId ? (
            <form action={openBillingPortal}>
              <Button variant="secondary" type="submit">
                {a.billing.manageBilling}
                <ExternalLink className="size-4" />
              </Button>
            </form>
          ) : null}
        </div>

        {/* A bar, not just a sentence: how close the shop is to the ceiling is
            the one number on this page that changes what to do next. */}
        {limit !== null ? (
          <Progress
            value={productCount / limit}
            tone={atLimit ? "amber" : "brand"}
            label={a.billing.productSlots}
            className="mt-4"
          />
        ) : null}

        {atLimit ? (
          <Alert tone="warning" className="mt-4">
            {interpolate(a.billing.atLimit, { plan: current.name })}
          </Alert>
        ) : null}
      </Card>

      {!billingEnabled() ? (
        <Alert tone="warning">
          {a.billing.notConfigured} <code>STRIPE_SECRET_KEY</code>.
        </Alert>
      ) : (
        <>
          <div className="mb-4 flex justify-center">
            <IntervalToggle interval={interval} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {PLAN_IDS.map((id) => {
              const plan = PLANS[id];
              const isCurrent = current.id === id;
              const price =
                interval === "year" ? plan.yearlyCents : plan.monthlyCents;
              const monthly =
                interval === "year"
                  ? Math.round(plan.yearlyCents / 12)
                  : plan.monthlyCents;
              const featured = id === "pro";

              return (
                <Card
                  key={id}
                  className={cn(
                    "relative flex flex-col p-5",
                    featured && "border-brand-600 ring-1 ring-brand-600",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-ink-900">{plan.name}</h3>
                    {featured ? (
                      <Badge tone="brand">
                        <Sparkles className="size-3" />
                        {a.billing.popular}
                      </Badge>
                    ) : null}
                    {isCurrent ? <Badge tone="green">{a.billing.current}</Badge> : null}
                  </div>

                  <p className="mt-1 text-xs leading-relaxed text-ink-500">
                    {plan.tagline}
                  </p>

                  <p className="mt-4">
                    <span className="tabular text-3xl font-semibold text-ink-900">
                      {price === 0 ? a.billing.free : formatMoney(monthly, "USD", locale)}
                    </span>
                    {price > 0 ? (
                      <span className="text-sm text-ink-500">
                        {" "}
                        {a.billing.perMonth}
                      </span>
                    ) : null}
                  </p>
                  {price > 0 && interval === "year" ? (
                    <p className="tabular text-xs text-ink-400">
                      {interpolate(a.billing.billedYearly, {
                        amount: formatMoney(price, "USD", locale),
                      })}
                    </p>
                  ) : null}

                  <ul className="mt-4 flex-1 space-y-2">
                    {plan.highlights.map((key) => (
                      <li
                        key={key}
                        className="flex gap-2 text-sm leading-snug text-ink-700"
                      >
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-brand-600"
                          strokeWidth={3}
                        />
                        {t.highlights[key]}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-5">
                    {isCurrent ? (
                      <Button variant="secondary" className="w-full" disabled>
                        {a.billing.yourPlan}
                      </Button>
                    ) : id === "free" ? (
                      <form action={openBillingPortal}>
                        <Button
                          variant="ghost"
                          type="submit"
                          className="w-full"
                          disabled={!fresh.stripeCustomerId}
                        >
                          {a.billing.downgrade}
                        </Button>
                      </form>
                    ) : (
                      <form action={startCheckout}>
                        <input type="hidden" name="plan" value={id} />
                        <input type="hidden" name="interval" value={interval} />
                        <Button
                          type="submit"
                          variant={featured ? "brand" : "primary"}
                          className="w-full"
                        >
                          {interpolate(
                            current.id === "free"
                              ? a.billing.upgradeTo
                              : a.billing.switchTo,
                            { plan: plan.name },
                          )}
                        </Button>
                      </form>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <p className="mt-4 text-center text-xs text-ink-400">
            {a.billing.cancelAnyTime}
          </p>
        </>
      )}
    </>
  );
}
