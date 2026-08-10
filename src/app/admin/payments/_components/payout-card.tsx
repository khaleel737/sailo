import { AlertTriangle, ArrowUpRight, Banknote } from "lucide-react";
import type { Shop } from "@/db/schema";
import { getPayoutOverview } from "@/lib/connect-payouts";
import { openStripeDashboard } from "@/lib/actions/connect";
import { refreshPayouts } from "@/lib/actions/payouts";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { getAdminT, getLocale } from "@/i18n/server";
import { interpolate } from "@/i18n";
import { formatMoney } from "@/lib/utils";

/** Badge tone per Stripe payout status — green is money that arrived. */
const STATUS_TONES = {
  paid: "green",
  pending: "amber",
  in_transit: "blue",
  failed: "red",
  canceled: "neutral",
} as const;

/**
 * The seller's money as Stripe holds it: balance per currency, the last few
 * payouts, and — above everything else — whether Stripe still needs something
 * from them. That warning plus its Express-dashboard link is the whole reason
 * this card exists: "where is my money" is the support ticket, and the answer
 * is almost always a requirement sitting unfinished on Stripe.
 *
 * Renders only for a connected account; the page keeps its existing
 * "connect Stripe" state otherwise. A Stripe outage degrades to "try again"
 * — the seller's rails stay editable regardless.
 */
export async function PayoutCard({ shop }: { shop: Shop }) {
  if (!shop.stripeAccountId) return null;

  const { a } = await getAdminT();
  const locale = await getLocale();
  const overview = await getPayoutOverview(shop);

  const day = (epochSeconds: number) =>
    new Date(epochSeconds * 1000).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const statusLabel = (status: string) =>
    status in a.payoutStatus
      ? a.payoutStatus[status as keyof typeof a.payoutStatus]
      : status;

  return (
    <Card className="mt-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-ink-200 bg-ink-50 text-ink-500">
            <Banknote className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-ink-900">
              {a.payouts.title}
            </h3>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-ink-500">
              {a.payouts.description}
            </p>
          </div>
        </div>
        <form action={refreshPayouts}>
          <Button type="submit" variant="secondary" size="sm">
            {a.payments.refreshStatus}
          </Button>
        </form>
      </div>

      {overview === null ? (
        <Alert
          tone="warning"
          icon={<AlertTriangle className="size-4" />}
          className="mt-4"
        >
          {a.payouts.unavailable}
        </Alert>
      ) : (
        <div className="mt-4 space-y-4">
          {/*
            The requirements banner leads. `currently_due` non-empty or
            payouts disabled is the state behind nearly every "where is my
            money" ticket, and the login link lands the seller directly on
            Stripe's own to-do list.
          */}
          {!overview.payoutsEnabled || overview.requirementsDue.length > 0 ? (
            <Alert
              tone="warning"
              icon={<AlertTriangle className="size-5" />}
              title={
                overview.payoutsEnabled
                  ? a.payouts.requirementsTitle
                  : a.payouts.pausedTitle
              }
            >
              <p>
                {overview.payoutsEnabled
                  ? a.payouts.requirementsBody
                  : a.payouts.pausedBody}
              </p>
              <form action={openStripeDashboard} className="mt-2">
                <button
                  type="submit"
                  className="focus-ring press inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#635bff] px-3 text-sm font-medium text-white shadow-xs transition hover:bg-[#5148e8] pointer-coarse:h-11"
                >
                  {a.payouts.finishOnStripe}
                  <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
                </button>
              </form>
            </Alert>
          ) : null}

          {overview.balances.length > 0 ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              {/*
                One row per currency, never summed across them — a shop
                refunded once in another currency simply has two rows.
              */}
              {overview.balances.map((row) => (
                <div
                  key={row.currency}
                  className="rounded-xl border border-ink-200 bg-white p-3"
                >
                  <dt className="text-xs text-ink-500">
                    {a.payouts.available}
                    {overview.balances.length > 1 ? ` · ${row.currency}` : ""}
                  </dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                    {formatMoney(row.availableCents, row.currency, locale)}
                  </dd>
                  <dd className="mt-1 text-xs text-ink-500">
                    {a.payouts.pending}{" "}
                    <span className="font-medium tabular-nums text-ink-700">
                      {formatMoney(row.pendingCents, row.currency, locale)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
              {a.payouts.recent}
            </h4>
            {overview.payouts.length === 0 ? (
              <p className="text-xs leading-relaxed text-ink-400">
                {a.payouts.noneYet}
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {overview.payouts.map((payout) => (
                  <li
                    key={payout.id}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium tabular-nums">
                        {formatMoney(payout.amountCents, payout.currency, locale)}
                      </p>
                      <p className="text-xs text-ink-500">
                        {day(payout.created)}
                        {payout.arrivalDate && payout.status !== "paid"
                          ? ` · ${interpolate(a.payouts.arrives, {
                              date: day(payout.arrivalDate),
                            })}`
                          : ""}
                      </p>
                    </div>
                    <Badge
                      tone={
                        STATUS_TONES[
                          payout.status as keyof typeof STATUS_TONES
                        ] ?? "neutral"
                      }
                      dot
                    >
                      {statusLabel(payout.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
