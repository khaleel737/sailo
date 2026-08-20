"use client";

import { Globe, TriangleAlert } from "lucide-react";
import { Card } from "@sailo/design-system/web";
import { PlanBadge } from "@/app/admin/_components/locked-feature";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { can } from "@sailo/core/plans";
import { currencyLabel } from "@sailo/core/currency";
import { REGIONAL_CURRENCIES } from "@sailo/core/regional";
import { interpolate } from "@sailo/i18n";
import type { CurrencyGaps } from "@/lib/queries/regional";
import type { Shop } from "@sailo/db/schema";

/**
 * Which currencies this shop quotes besides its own — spec 53.
 *
 * Two states per currency and they are deliberately not the same thing:
 *
 *   **ticked** — the seller wants to sell in it. Stored in
 *   `shops.regional_currencies`.
 *   **live**   — every published product, every variant that overrides a
 *   price, every enabled delivery rate and every active coupon that names an
 *   amount has a price in it. Computed, never stored.
 *
 * A currency that is ticked and not live is offered to **nobody**, and this
 * card is where a seller finds out why. It names the counts rather than saying
 * "not ready", because "add a price to 3 products and 1 delivery rate" is an
 * instruction and "not ready" is a mystery — rule 8, no silent caps, pointed at
 * the seller.
 *
 * Nothing here converts anything. The prices themselves are typed on each
 * product, each delivery rate and each coupon, because the whole point of the
 * feature is that a seller chose the number.
 */
export function CurrenciesCard({
  shop,
  gaps,
}: {
  shop: Shop;
  /** What each ticked currency is still missing. Empty means all of them are live. */
  gaps: CurrencyGaps[];
}) {
  const a = useAdminT();
  const unlocked = can(shop, "regionalPricing");
  const ticked = new Set(shop.regionalCurrencies);
  const gapFor = new Map(gaps.map((g) => [g.currency, g]));

  /*
   * The shop's own is never offered as a choice. It is quoted by `price_cents`
   * on every row already, and a tick beside it would be a second place for the
   * same price to be edited and therefore a second place for it to be wrong.
   */
  const choices = REGIONAL_CURRENCIES.filter((code) => code !== shop.currency);

  return (
    <Card className="space-y-4 p-5">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-900">
            {a.settings.currenciesTitle}
          </h2>
          {unlocked ? null : <PlanBadge feature="regionalPricing" />}
        </div>
        <p className="mt-0.5 text-xs text-ink-500">
          {interpolate(a.settings.currenciesBody, { currency: shop.currency })}
        </p>
      </div>

      <ul className="space-y-2">
        {choices.map((code) => {
          const on = ticked.has(code);
          const gap = gapFor.get(code);
          /*
           * `gap.tiers` counts here too — spec 50. It is the one entry a seller
           * cannot close by typing a number: `event_tiers` has no
           * `currency_prices`, so a shop selling banded tickets cannot quote
           * them in a second currency at all. Leaving it out of this sum would
           * paint the currency green while `liveCurrencies` refuses it, which
           * is the disagreement this card exists to prevent.
           */
          const missing = gap
            ? gap.products + gap.variants + gap.delivery + gap.coupons + gap.tiers
            : 0;

          return (
            <li key={code}>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="regionalCurrencies"
                  value={code}
                  defaultChecked={on}
                  disabled={!unlocked}
                  className="mt-0.5 size-4 shrink-0 rounded border-ink-300"
                />
                <span className="min-w-0">
                  <span className="font-medium text-ink-900">
                    {currencyLabel(code)}
                  </span>
                  {/*
                    Only for a currency the seller has actually ticked. Listing
                    what an unticked currency would need reads as a warning
                    about something they have not asked for.
                  */}
                  {on && missing > 0 ? (
                    <span className="mt-0.5 flex items-start gap-1.5 text-xs text-amber-700">
                      <TriangleAlert className="mt-px size-3.5 shrink-0" />
                      <span>
                        {interpolate(a.settings.currencyIncomplete, {
                          currency: code,
                        })}{" "}
                        {[
                          gap && gap.products > 0
                            ? interpolate(a.settings.currencyGapProducts, {
                                count: String(gap.products),
                              })
                            : null,
                          gap && gap.variants > 0
                            ? interpolate(a.settings.currencyGapVariants, {
                                count: String(gap.variants),
                              })
                            : null,
                          gap && gap.delivery > 0
                            ? interpolate(a.settings.currencyGapDelivery, {
                                count: String(gap.delivery),
                              })
                            : null,
                          gap && gap.coupons > 0
                            ? interpolate(a.settings.currencyGapCoupons, {
                                count: String(gap.coupons),
                              })
                            : null,
                          gap && gap.tiers > 0
                            ? interpolate(a.settings.currencyGapTiers, {
                                count: String(gap.tiers),
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </span>
                  ) : null}
                  {on && missing === 0 ? (
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-700">
                      <Globe className="size-3.5 shrink-0" />
                      {interpolate(a.settings.currencyLive, { currency: code })}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-ink-500">{a.settings.currenciesNoConversion}</p>
    </Card>
  );
}
