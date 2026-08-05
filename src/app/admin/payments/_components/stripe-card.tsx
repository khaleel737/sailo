import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CreditCard, Lock } from "lucide-react";
import type { Shop } from "@/db/schema";
import { connectState } from "@/lib/connect";
import { can, cheapestPlanWith } from "@/lib/plans";
import {
  connectStripe,
  disconnectStripe,
  openStripeDashboard,
  refreshStripeAccount,
} from "@/lib/actions/connect";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The Stripe rail is configured by connecting an account, not by filling in
 * fields, so it gets its own card rather than the generic method form.
 */
export function StripeCard({ shop }: { shop: Shop }) {
  const entitled = can(shop, "cardRails");
  const state = connectState(shop);
  const needs = cheapestPlanWith("cardRails");

  const live = entitled && state === "active";

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
            <h3 className="text-sm font-medium text-ink-900">Card payments</h3>
            {!entitled && needs ? (
              <Badge tone="amber">
                <Lock className="size-3" />
                {needs.name}
              </Badge>
            ) : state === "active" ? (
              <Badge tone="green" dot>
                Live
              </Badge>
            ) : state === "verifying" ? (
              <Badge tone="amber" dot>
                Stripe is verifying
              </Badge>
            ) : state === "onboarding" ? (
              <Badge tone="amber" dot>
                Finish setup
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                Not connected
              </Badge>
            )}
          </div>
          <p className="mt-1 max-w-lg text-xs leading-relaxed text-ink-500">
            Buyers pay by card, Apple Pay or Google Pay without leaving the
            checkout. The money goes straight into your own Stripe account —
            Sailo never holds it and takes no cut of your sales.
          </p>
        </div>
      </div>

      {!entitled ? (
        <p className="mt-4 rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-600">
          Card payments are part of {needs?.name ?? "a paid plan"}.{" "}
          <Link
            href="/admin/settings/billing"
            className="focus-ring rounded font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
          >
            See plans
          </Link>
        </p>
      ) : state === "not_connected" ? (
        <form action={connectStripe} className="mt-4">
          <button
            type="submit"
            className="focus-ring press inline-flex h-10 items-center gap-2 rounded-xl bg-[#635bff] px-4 text-sm font-medium text-white shadow-xs transition hover:bg-[#5148e8]"
          >
            Connect Stripe
            <ArrowUpRight className="size-4 rtl:-scale-x-100" />
          </button>
          <p className="mt-2 text-xs text-ink-400">
            Opens Stripe. You&rsquo;ll need your bank details and an ID —
            Sailo never sees either.
          </p>
        </form>
      ) : (
        <div className="mt-4 space-y-3">
          {state !== "active" ? (
            <Alert tone="warning" icon={<AlertTriangle className="size-4" />}>
              {state === "onboarding"
                ? "Stripe still needs some details before you can take payments."
                : "Stripe has your details and is checking them. This is usually quick, and the card option turns on by itself."}
            </Alert>
          ) : null}

          <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-ink-200 bg-white p-3 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-xs text-ink-500">Account</dt>
              <dd className="mt-0.5 font-mono text-xs text-ink-700">
                {shop.stripeAccountId}
              </dd>
            </div>
            {shop.stripeAccountCountry ? (
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-xs text-ink-500">Country</dt>
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
                  className="focus-ring press inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#635bff] px-3 text-sm font-medium text-white shadow-xs transition hover:bg-[#5148e8]"
                >
                  Continue on Stripe
                  <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
                </button>
              </form>
            ) : (
              <form action={openStripeDashboard}>
                <Button type="submit" variant="secondary" size="sm">
                  Payouts on Stripe
                  <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
                </Button>
              </form>
            )}

            <form action={refreshStripeAccount}>
              <Button type="submit" variant="secondary" size="sm">
                Refresh status
              </Button>
            </form>

            <form action={disconnectStripe}>
              <Button type="submit" variant="ghost" size="sm">
                Disconnect
              </Button>
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
