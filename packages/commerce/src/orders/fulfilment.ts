import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { deliveryMethods } from "@sailo/db/schema";
import { isDeliveryConfigured, shipsTo } from "../delivery/delivery";

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
  ).filter((d) => isDeliveryConfigured(d.type, d.config));

  if (available.length === 0) return undefined;

  // Zones are applied before anything is chosen, so neither the fallback nor
  // the requested id can reach past them. An empty `countries` is "anywhere",
  // so a shop that has never touched this narrows to exactly what it had.
  const servable = available.filter((d) => shipsTo(d, country));
  if (servable.length === 0) return "unserviceable" as const;

  if (!requestedId) return servable[0];
  return servable.find((d) => d.id === requestedId) ?? ("unavailable" as const);
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
