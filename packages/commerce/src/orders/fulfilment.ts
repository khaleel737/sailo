import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { deliveryMethods } from "@sailo/db/schema";
import { isDeliveryConfigured, shipsTo } from "../delivery/delivery";
import { deliveryAtCurrency } from "@sailo/core/regional";
import { weightedRate } from "@sailo/core/weight";

/**
 * Picks the delivery method for an order.
 *
 * A requested id has to belong to this shop and be usable; anything else falls
 * back to the shop's first option rather than failing the order, because a
 * stale id from a cached page is the buyer's fault least of all.
 *
 * The three ways this answers "no delivery" are three different facts and must
 * not be collapsed:
 *
 *   `undefined`       Nothing to price. Either the basket doesn't travel, or
 *                     the shop has configured no delivery options at all —
 *                     which is a shop that takes physical orders with no
 *                     delivery choice and no fee, and has always worked. A
 *                     zone must never turn that into a refusal.
 *
 *   `"unavailable"`   The rate the buyer asked for is not one this shop can
 *                     use. A stale id from a cached page.
 *
 *   `"unserviceable"` The shop has rates and none of them reaches this
 *                     country. The one refusal zones add — and the reason the
 *                     country has to be passed in rather than checked by the
 *                     caller afterwards: the `available[0]` fallback below
 *                     would otherwise quietly post an order to a country the
 *                     seller had just excluded.
 */

export async function resolveDelivery(
  shopId: string,
  needed: boolean,
  requestedId: string | undefined,
  /** Where it's going. Unset only narrows to rates that reach everywhere. */
  country?: string | null,
  /**
   * What the order is priced in, and the shop's own — spec 53.
   *
   * A rate with no price in the order's currency is not a rate this order can
   * use: the fee would be a number in a different currency added to a total in
   * this one. Dropped here, beside the zone filter, because both answer the
   * same question — whether this rate can carry this order — and answering
   * them in two places is how one of them gets forgotten.
   */
  money?: { currency: string; shopCurrency: string },
  /**
   * What the basket weighs, in grams — spec 51.
   *
   * Zero for a caller that has not worked it out, which is every caller that
   * predates weight bands and every basket of downloads. A `flat` rate ignores
   * it entirely, so a shop that has configured no bands is unaffected however
   * this is called.
   */
  weightGrams = 0,
) {
  if (!needed) return undefined;
  const db = getDb();

  const available = (
    await db.query.deliveryMethods.findMany({
      where: and(
        eq(deliveryMethods.shopId, shopId),
        eq(deliveryMethods.isEnabled, true),
      ),
      orderBy: [asc(deliveryMethods.position)],
    })
  )
    .filter((d) => isDeliveryConfigured(d.type, d.config))
    .map((d) =>
      money ? deliveryAtCurrency(d, money.currency, money.shopCurrency) : d,
    )
    .filter((d) => d !== null);

  if (available.length === 0) return undefined;

  // Zones are applied before anything is chosen, so neither the fallback nor
  // the requested id can reach past them. An empty `countries` is "anywhere",
  // so a shop that has never touched this narrows to exactly what it had.
  const servable = available.filter((d) => shipsTo(d, country));
  if (servable.length === 0) return "unserviceable" as const;

  /*
   * And the weight table, applied in exactly the same place and for exactly the
   * same reason as the zone above it — spec 51.
   *
   * A rate whose bands stop at 2 kg cannot carry a 5 kg parcel, so it is not
   * one of this order's options. Filtering here rather than at the caller is
   * what stops the `servable[0]` fallback quietly picking a rate that would
   * then be priced at zero, which is the shape the zone filter's own note warns
   * about: a fallback that reaches past a rule is a rule that is not enforced.
   *
   * `"too_heavy"` only when *every* rate is refused. A shop offering a light
   * rate and a heavy one should simply stop offering the light one.
   */
  const liftable = servable.filter(
    (d) => weightedRate(d, weightGrams).ok,
  );
  if (liftable.length === 0) return "too_heavy" as const;

  if (!requestedId) return liftable[0];
  return liftable.find((d) => d.id === requestedId) ?? ("unavailable" as const);
}

/** The earliest of several deadlines, ignoring the ones that never expire. */
export function soonest(dates: (Date | null)[]): Date | null {
  const real = dates.filter((d): d is Date => d !== null);
  if (real.length === 0) return null;
  return real.reduce((min, d) => (d < min ? d : min));
}

/** The tightest of several caps, ignoring the ones that are uncapped. */
export function smallest(limits: (number | null)[]): number | null {
  const real = limits.filter((n): n is number => n !== null);
  if (real.length === 0) return null;
  return Math.min(...real);
}

/**
 * Reads the booking picker's local datetime. Anything earlier than the notice
 * the seller asked for is rejected rather than quietly rounded up — a buyer
 * who picked 9am tomorrow should be told it's too soon, not booked for Friday.
 */
