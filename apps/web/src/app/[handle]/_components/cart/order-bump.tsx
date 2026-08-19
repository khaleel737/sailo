"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Plus } from "lucide-react";
import { formatMoney } from "@sailo/core/currency";
import { bumpsForBasket, type BumpOffer } from "@/lib/actions/offers";
import type { Dictionary } from "@sailo/i18n";

/**
 * "Add X for £Y" — spec 08, above the pay button.
 *
 * IN THE CART, WHERE A CROSS-SELL IS NOT
 *
 * The two placements are deliberately different. A bump is one tap on something
 * small that goes with what is already in the basket, and it does not add a
 * step: the buyer reads it on the way past. A cross-sell is a whole second
 * decision and goes *after* payment, because Baymard found 66% of shoppers made
 * to pass one before completing a transaction reported extreme frustration.
 *
 * IT ADDS A NORMAL LINE, AND THAT IS THE WHOLE SECURITY STORY
 *
 * Ticking it adds an ordinary basket line, which goes through `resolveLines`,
 * `previewOrder` and `createOrderIntent` exactly like every other line. The
 * price on this tile comes from the server and is re-read on the server; the
 * *attribution* is decided on the server too, by `attributeBumps`, from the
 * offers the shop actually has — a client flag saying "this line was a bump"
 * would be a client telling us its own conversion rate.
 *
 * So the only thing a forged interaction here can do is put a purchasable
 * product in a basket, which was always legal.
 */
export function OrderBump({
  shopId,
  productIds,
  onAdd,
  currency,
  locale,
  t,
}: {
  shopId: string;
  /** What is already in the basket, so nothing is offered that is in it. */
  productIds: string[];
  /** Adds the bump's product as an ordinary line. */
  onAdd: (bump: BumpOffer) => void;
  currency: string;
  locale?: string;
  t: Dictionary;
}) {
  const [bump, setBump] = useState<BumpOffer | null>(null);
  const [added, setAdded] = useState(false);

  const key = productIds.join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await bumpsForBasket({ shopId, productIds });
        // One at a time, and only one. A stack of bumps above a pay button is
        // the friction the placement exists to avoid; the seller's `position`
        // decides which.
        if (!cancelled) setBump(found[0] ?? null);
      } catch {
        // Silence: the basket is the thing that matters and a failed offer
        // lookup must not put an error above somebody's pay button.
        if (!cancelled) setBump(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, key]);

  if (!bump || added) return null;

  return (
    <button
      type="button"
      onClick={() => {
        setAdded(true);
        onAdd(bump);
      }}
      className="surface-elevated flex w-full items-center gap-3 rounded-xl border border-dashed border-black/15 p-3 text-start transition hover:opacity-80"
    >
      {bump.imageUrl ? (
        <Image
          src={bump.imageUrl}
          alt=""
          width={44}
          height={44}
          className="size-11 shrink-0 rounded-lg object-cover"
        />
      ) : null}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{bump.title}</span>
        {bump.body ? (
          <span className="text-muted block truncate text-xs">{bump.body}</span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-2 text-sm font-semibold tabular-nums">
        {formatMoney(bump.priceCents, currency, locale)}
        {bump.compareAtCents !== null ? (
          <span className="text-muted text-xs font-normal line-through">
            {formatMoney(bump.compareAtCents, currency, locale)}
          </span>
        ) : null}
        <Plus className="size-4" aria-hidden />
        <span className="sr-only">{bump.buttonLabel ?? t.offers.addIt}</span>
      </span>
    </button>
  );
}
