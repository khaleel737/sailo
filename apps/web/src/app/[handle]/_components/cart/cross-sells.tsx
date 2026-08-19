"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { formatMoney } from "@sailo/core/currency";
import {
  crossSellsForOrder,
  skipCrossSell,
  takeCrossSell,
  type ThankYouOffer,
} from "@/lib/actions/offers";
import type { Dictionary } from "@sailo/i18n";

/**
 * What the buyer is offered *after* they have paid — spec 36.
 *
 * AFTER THE RECEIPT, AND THAT IS THE WHOLE DESIGN
 *
 * Easytools' own argument, adopted verbatim because it is right: Baymard found
 * 66% of shoppers made to pass a cross-sell before completing a transaction
 * reported extreme frustration. So the confirmation, the files and the invoice
 * are on screen first, and these load into the space underneath them.
 *
 * Loaded in an effect rather than rendered by the server, and that is the same
 * decision in a different key: the receipt must not wait on an offer query, and
 * a failure here has to leave a buyer looking at their order rather than at a
 * blank page. Nothing below can throw into the confirmation's tree.
 *
 * TAKING ONE GOES TO A REAL CHECKOUT
 *
 * There is no one-click charge, because Sailo stores no card on file — see
 * `lib/actions/offers.ts` for the whole of that argument. What the button does
 * is what spec 36 names as the honest default and the fallback for everything:
 * an ordinary product page, an ordinary checkout, a new separately-numbered
 * order, priced by the server exactly as the first one was.
 */
export function CrossSells({
  shopId,
  orderId,
  t,
  locale,
}: {
  shopId: string;
  orderId: string;
  t: Dictionary;
  locale?: string;
}) {
  const [offers, setOffers] = useState<ThankYouOffer[] | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await crossSellsForOrder({ shopId, orderId });
        if (!cancelled) setOffers(found);
      } catch {
        /*
         * Silence, deliberately. The buyer is looking at a receipt they have
         * already paid for; an error message about an *offer* they never asked
         * to see would read as something having gone wrong with their order.
         */
        if (!cancelled) setOffers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId, orderId]);

  const live = (offers ?? []).filter((offer) => !dismissed.includes(offer.id));
  // Nothing while it loads, and nothing when there is nothing: an empty heading
  // under a receipt is a promise of something that never arrives.
  if (live.length === 0) return null;

  return (
    <section className="mt-6 space-y-3 border-t border-black/10 pt-5">
      <h3 className="text-sm font-semibold">{t.offers.alsoLike}</h3>

      {live.map((offer) => (
        <div
          key={offer.id}
          className="surface-elevated flex items-center gap-3 rounded-xl p-3"
        >
          {offer.imageUrl ? (
            <Image
              src={offer.imageUrl}
              alt=""
              width={56}
              height={56}
              className="size-14 shrink-0 rounded-lg object-cover"
            />
          ) : null}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{offer.title}</p>
            {offer.body ? (
              <p className="text-muted line-clamp-2 text-xs">{offer.body}</p>
            ) : null}
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {formatMoney(offer.priceCents, offer.currency, locale)}
              {/* Struck through only where the offer genuinely undercuts the
                  list price — an offer priced above it would otherwise
                  advertise a saving that is a surcharge. */}
              {offer.compareAtCents !== null ? (
                <span className="text-muted ml-1.5 text-xs font-normal line-through">
                  {formatMoney(offer.compareAtCents, offer.currency, locale)}
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await takeCrossSell({
                    shopId,
                    orderId,
                    offerId: offer.id,
                  });
                  if (result.ok) {
                    window.location.href = result.url;
                    return;
                  }
                  /*
                   * Anything but a redirect takes the offer off the page rather
                   * than explaining itself. Expired, already taken, withdrawn —
                   * the buyer has their order either way, and an error box under
                   * a receipt reads as a problem with the thing they paid for.
                   */
                  setDismissed((was) => [...was, offer.id]);
                });
              }}
              className="accent-bg rounded-lg px-3 py-2 text-xs font-semibold transition hover:opacity-90 disabled:opacity-50"
            >
              {offer.buttonLabel ?? t.offers.addIt}
            </button>
            <button
              type="button"
              onClick={() => {
                setDismissed((was) => [...was, offer.id]);
                // A skip is data; silence is not. Never awaited — the offer is
                // already gone from the page by the time this lands.
                void skipCrossSell({ shopId, orderId, offerId: offer.id });
              }}
              className="text-muted rounded-lg px-3 py-1 text-xs transition hover:opacity-70"
            >
              {t.offers.noThanks}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
