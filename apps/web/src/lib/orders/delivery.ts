import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { deliveryMethods } from "@/db/schema";
import { isDeliveryConfigured } from "@/lib/delivery";

/**
 * Picks the delivery method for an order.
 *
 * A requested id has to belong to this shop and be usable; anything else falls
 * back to the shop's first option rather than failing the order, because a
 * stale id from a cached page is the buyer's fault least of all.
 */

export async function resolveDelivery(
  shopId: string,
  needed: boolean,
  requestedId: string | undefined,
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
  if (!requestedId) return available[0];
  return available.find((d) => d.id === requestedId) ?? ("unavailable" as const);
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
