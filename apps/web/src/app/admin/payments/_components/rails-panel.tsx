import type { ReactNode } from "react";
import { AlertTriangle, Check, Clock, Minus } from "lucide-react";
import type { SellerRail, SellerRailState } from "@sailo/payments";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { cn } from "@sailo/design-system/web/cn";

/**
 * What a buyer is actually offered, rail by rail.
 *
 * The panel exists because "Stripe is connected" and "a Dutch buyer can pay
 * with iDEAL" are separate facts and this screen only ever showed the first.
 * Both ways they come apart are invisible without it:
 *
 *  - Stripe accepts the capability request and then parks the rail pending one
 *    more field. Every Dutch seller had iDEAL off for want of
 *    `individual.id_number` and was never asked for it.
 *  - The rail is live and the shop prices in a currency it does not settle in,
 *    so no buyer is ever shown it. That one is not an error anywhere in
 *    Stripe's model — see `off_currency` in `@sailo/payments/connect/methods`.
 *
 * Rendered from Stripe's own answer on every load rather than from a stored
 * column, because the seller fixing a requirement happens on Stripe's side and
 * the next thing they do is come back here to check.
 */

const TONE: Record<SellerRailState, string> = {
  live: "border-brand-200 bg-brand-50 text-brand-700",
  blocked: "border-amber-200 bg-amber-50 text-amber-700",
  off_currency: "border-ink-200 bg-ink-50 text-ink-500",
  pending: "border-ink-200 bg-ink-50 text-ink-500",
  unavailable: "border-ink-200 bg-ink-50 text-ink-400",
};

const ICON: Record<SellerRailState, typeof Check> = {
  live: Check,
  blocked: AlertTriangle,
  off_currency: Minus,
  pending: Clock,
  unavailable: Minus,
};

export async function RailsPanel({
  rails,
  currency,
  blockedAction,
}: {
  rails: SellerRail[];
  /** The shop's own, which is the presentment currency of every session. */
  currency: string;
  /**
   * The way back to Stripe, rendered only when a rail is waiting on the
   * seller. A node rather than a URL because onboarding starts from a server
   * action — the link is single-use and minted per click, so there is no href
   * to hand down.
   */
  blockedAction?: ReactNode;
}) {
  const { a } = await getAdminT();

  if (rails.length === 0) {
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-3">
        <h4 className="text-xs font-medium text-ink-900">{a.payments.railsTitle}</h4>
        <p className="mt-1 text-xs text-ink-500">{a.payments.railsEmpty}</p>
      </div>
    );
  }

  // Only worth explaining either rule when a rail is actually losing to it. On
  // a shop where nothing is off-currency the sentence is a distraction, and the
  // way back to Stripe is noise on a shop with nothing outstanding.
  const anyOffCurrency = rails.some((rail) => rail.state === "off_currency");
  const anyBlocked = rails.some((rail) => rail.state === "blocked");

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3">
      <h4 className="text-xs font-medium text-ink-900">{a.payments.railsTitle}</h4>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">{a.payments.railsHint}</p>

      <ul className="mt-2.5 space-y-1.5">
        {rails.map((rail) => {
          const Icon = ICON[rail.state];
          return (
            <li key={rail.capability} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-medium",
                  TONE[rail.state],
                )}
              >
                <Icon className="size-3" />
                {rail.label}
              </span>

              {rail.state === "live" ? (
                <span className="text-xs text-ink-500">{a.payments.railLive}</span>
              ) : rail.state === "pending" ? (
                <span className="text-xs text-ink-500">{a.payments.railPending}</span>
              ) : rail.state === "off_currency" ? (
                <span className="text-xs text-ink-500">
                  {interpolate(a.payments.railOffCurrency, {
                    currencies: rail.currencies.map((c) => c.toUpperCase()).join(", "),
                    currency: currency.toUpperCase(),
                  })}
                </span>
              ) : rail.state === "blocked" ? (
                <span className="text-xs text-amber-700">
                  {/*
                    Stripe's own field names, unchanged. They are not pretty,
                    but they are exactly what the seller will be shown on the
                    other side of the link, and translating them into our own
                    words would make the two screens disagree.
                  */}
                  {a.payments.railBlocked}{" "}
                  <code className="font-mono">{rail.currentlyDue.join(", ")}</code>
                </span>
              ) : (
                <span className="text-xs text-ink-400">{a.payments.railUnavailable}</span>
              )}
            </li>
          );
        })}
      </ul>

      {anyBlocked && blockedAction ? (
        <div className="mt-2.5">{blockedAction}</div>
      ) : null}

      {anyOffCurrency ? (
        <p className="mt-2.5 text-xs leading-relaxed text-ink-400">
          {a.payments.railOffCurrencyHint}
        </p>
      ) : null}
    </div>
  );
}
