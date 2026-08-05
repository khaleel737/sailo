import type { Metadata } from "next";
import { firstRow } from "@/lib/invariant";
import { Check, ExternalLink, Sparkles } from "lucide-react";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { openBillingPortal, startCheckout } from "@/lib/actions/billing";
import { syncSubscriptionForShop } from "@/lib/billing-sync";
import { PLAN_IDS, PLANS, planFor, productLimit } from "@/lib/plans";
import { billingEnabled } from "@/lib/stripe";
import { IntervalToggle } from "@/components/admin/interval-toggle";
import { Badge, Button, Card } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({
  searchParams,
}: PageProps<"/admin/settings/billing">) {
  const { shop } = await requireShop();
  const params = await searchParams;

  // Returning from Checkout, the webhook may still be in flight — pull the
  // truth from Stripe so the page is never stale for the seller.
  if (params.checkout === "success" && billingEnabled()) {
    await syncSubscriptionForShop(shop.id);
  }

  const { shop: fresh } = await requireShop();
  const current = planFor(fresh);
  const interval = params.interval === "year" ? "year" : "month";

  const { value: productCount } = firstRow(await getDb()
    .select({ value: count() })
    .from(products)
    .where(eq(products.shopId, fresh.id)), "value aggregate");

  const limit = productLimit(fresh);

  return (
    <>
      {params.checkout === "cancelled" ? (
        <p className="mb-5 rounded-2xl border border-ink-200 bg-ink-50 p-4 text-sm text-ink-600">
          Checkout cancelled — nothing was charged.
        </p>
      ) : null}

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-ink-500">Current plan</h2>
              {fresh.subscriptionStatus === "past_due" ? (
                <Badge tone="red">Payment failed</Badge>
              ) : fresh.cancelAtPeriodEnd ? (
                <Badge tone="amber">Cancels at period end</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-2xl font-semibold">{current.name}</p>
            <p className="mt-1 text-sm text-ink-500">
              {productCount} of {limit ?? "unlimited"} products used
              {current.features.cardRails
                ? " · 0% fee on card payments"
                : ""}
            </p>
            {fresh.currentPeriodEnd ? (
              <p className="mt-0.5 text-xs text-ink-400">
                {fresh.cancelAtPeriodEnd ? "Access ends" : "Renews"}{" "}
                {fresh.currentPeriodEnd.toLocaleDateString("en-US", {
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
                Manage billing
                <ExternalLink className="size-4" />
              </Button>
            </form>
          ) : null}
        </div>

        {limit !== null && productCount >= limit ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            You&rsquo;ve used every product slot on {current.name}. Existing
            products keep working — upgrade to add more.
          </p>
        ) : null}
      </Card>

      {!billingEnabled() ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Billing isn&rsquo;t configured — set <code>STRIPE_SECRET_KEY</code> to
          enable upgrades.
        </p>
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

              return (
                <Card
                  key={id}
                  className={`flex flex-col p-5 ${
                    id === "pro" ? "ring-2 ring-ink-900" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{plan.name}</h3>
                    {id === "pro" ? (
                      <Badge tone="blue">
                        <Sparkles className="size-3" />
                        Popular
                      </Badge>
                    ) : null}
                    {isCurrent ? <Badge tone="green">Current</Badge> : null}
                  </div>

                  <p className="mt-1 text-xs leading-relaxed text-ink-500">
                    {plan.tagline}
                  </p>

                  <p className="mt-4">
                    <span className="text-3xl font-semibold tabular-nums">
                      {price === 0 ? "Free" : formatMoney(monthly, "USD")}
                    </span>
                    {price > 0 ? (
                      <span className="text-sm text-ink-500"> /month</span>
                    ) : null}
                  </p>
                  {price > 0 && interval === "year" ? (
                    <p className="text-xs text-ink-400">
                      {formatMoney(price, "USD")} billed yearly
                    </p>
                  ) : null}

                  <ul className="mt-4 flex-1 space-y-1.5">
                    {plan.highlights.map((line) => (
                      <li key={line} className="flex gap-2 text-sm text-ink-700">
                        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                        {line}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-5">
                    {isCurrent ? (
                      <Button variant="secondary" className="w-full" disabled>
                        Your plan
                      </Button>
                    ) : id === "free" ? (
                      <form action={openBillingPortal}>
                        <Button
                          variant="ghost"
                          type="submit"
                          className="w-full"
                          disabled={!fresh.stripeCustomerId}
                        >
                          Downgrade
                        </Button>
                      </form>
                    ) : (
                      <form action={startCheckout}>
                        <input type="hidden" name="plan" value={id} />
                        <input type="hidden" name="interval" value={interval} />
                        <Button type="submit" className="w-full">
                          {current.id === "free" ? "Upgrade" : "Switch"} to{" "}
                          {plan.name}
                        </Button>
                      </form>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <p className="mt-4 text-center text-xs text-ink-400">
            Cancel any time. Downgrading never deletes products — you just
            can&rsquo;t add more until you&rsquo;re under the limit.
          </p>
        </>
      )}
    </>
  );
}
