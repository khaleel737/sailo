import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CreditCard,
  Loader2,
  Lock,
} from "lucide-react";
import type { Shop } from "@/db/schema";
import { connectState } from "@/lib/connect";
import { can, cheapestPlanWith } from "@/lib/plans";
import {
  connectStripe,
  disconnectStripe,
  openStripeDashboard,
  refreshStripeAccount,
} from "@/lib/actions/connect";
import { Badge, Card } from "@/components/ui";

/**
 * The Stripe rail is configured by connecting an account, not by filling in
 * fields, so it gets its own card rather than the generic method form.
 */
export function StripeCard({ shop }: { shop: Shop }) {
  const entitled = can(shop, "cardRails");
  const state = connectState(shop);
  const needs = cheapestPlanWith("cardRails");

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#635bff]/10 text-[#635bff]">
            <CreditCard className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Card payments</h3>
              {!entitled && needs ? (
                <Badge tone="amber">
                  <Lock className="mr-1 size-3" />
                  {needs.name}
                </Badge>
              ) : state === "active" ? (
                <Badge tone="green">
                  <Check className="mr-1 size-3" />
                  Live
                </Badge>
              ) : state === "verifying" ? (
                <Badge tone="amber">
                  <Loader2 className="mr-1 size-3" />
                  Stripe is verifying
                </Badge>
              ) : state === "onboarding" ? (
                <Badge tone="amber">Finish setup</Badge>
              ) : null}
            </div>
            <p className="mt-1 max-w-lg text-sm text-ink-500">
              Buyers pay by card, Apple Pay or Google Pay without leaving the
              checkout. The money goes straight into your own Stripe account —
              Sailo never holds it and takes no cut of your sales.
            </p>
          </div>
        </div>
      </div>

      {!entitled ? (
        <p className="mt-4 rounded-xl bg-ink-50 px-3 py-2.5 text-sm text-ink-600">
          Card payments are part of {needs?.name ?? "a paid plan"}.{" "}
          <Link
            href="/admin/settings/billing"
            className="font-medium text-ink-900 underline underline-offset-4"
          >
            See plans
          </Link>
        </p>
      ) : state === "not_connected" ? (
        <form action={connectStripe} className="mt-4">
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#635bff] px-4 text-sm font-medium text-white transition hover:bg-[#5148e8]"
          >
            Connect Stripe
            <ArrowUpRight className="size-4" />
          </button>
          <p className="mt-2 text-xs text-ink-400">
            Opens Stripe. You&rsquo;ll need your bank details and an ID —
            Sailo never sees either.
          </p>
        </form>
      ) : (
        <div className="mt-4 space-y-3">
          {state !== "active" ? (
            <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-900">
                {state === "onboarding"
                  ? "Stripe still needs some details before you can take payments."
                  : "Stripe has your details and is checking them. This is usually quick, and the card option turns on by itself."}
              </p>
            </div>
          ) : null}

          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-ink-500">Account</dt>
              <dd className="font-mono text-xs text-ink-700">
                {shop.stripeAccountId}
              </dd>
            </div>
            {shop.stripeAccountCountry ? (
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-ink-500">Country</dt>
                <dd className="text-ink-700">{shop.stripeAccountCountry}</dd>
              </div>
            ) : null}
          </dl>

          <div className="flex flex-wrap gap-2">
            {state !== "active" ? (
              <form action={connectStripe}>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#635bff] px-3 text-sm font-medium text-white transition hover:bg-[#5148e8]"
                >
                  Continue on Stripe
                  <ArrowUpRight className="size-3.5" />
                </button>
              </form>
            ) : (
              <form action={openStripeDashboard}>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 px-3 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
                >
                  Payouts on Stripe
                  <ArrowUpRight className="size-3.5" />
                </button>
              </form>
            )}

            <form action={refreshStripeAccount}>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-lg border border-ink-200 px-3 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
              >
                Refresh status
              </button>
            </form>

            <form action={disconnectStripe}>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
              >
                Disconnect
              </button>
            </form>
          </div>

          <p className="text-xs text-ink-400">
            Disconnecting stops new card orders. Your Stripe account, its
            payouts and its records stay exactly where they are.
          </p>
        </div>
      )}
    </Card>
  );
}
