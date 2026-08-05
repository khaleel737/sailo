import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shops } from "@/db/schema";
import { stripe } from "@/lib/stripe";
import { resolveCustomerId } from "@/lib/billing-customer";
import { freePlanFields, subscriptionFields } from "@/lib/billing-map";

/**
 * Pulls live subscription state from Stripe into the shop row.
 *
 * Deliberately does NOT revalidate — it's called during render on the billing
 * page (where the webhook may still be in flight) and Next forbids
 * revalidatePath there. Callers that need cache busting do it themselves.
 */
export async function syncSubscriptionForShop(shopId: string) {
  const db = getDb();
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop?.stripeCustomerId) return;

  /*
   * A stale id here means the row points at a customer this Stripe account
   * cannot see — a test-mode id under live keys, or one deleted from the
   * dashboard. Listing its subscriptions would throw, and this runs during
   * render on the billing page, so it would take the whole page with it.
   * There is nothing to sync from a customer that does not exist.
   */
  const customer = await resolveCustomerId(shop.stripeCustomerId);
  if (!customer) return;

  const subs = await stripe().subscriptions.list({
    customer,
    status: "all",
    limit: 10,
  });

  // The newest non-terminal subscription wins.
  const live = subs.data
    .filter((s) => !["canceled", "incomplete_expired"].includes(s.status))
    .toSorted((a, b) => b.created - a.created)[0];

  await db
    .update(shops)
    .set(
      live
        ? subscriptionFields(live)
        : freePlanFields(),
    )
    .where(eq(shops.id, shopId));
}
