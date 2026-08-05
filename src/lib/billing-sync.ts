import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shops } from "@/db/schema";
import { stripe } from "@/lib/stripe";
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

  const subs = await stripe().subscriptions.list({
    customer: shop.stripeCustomerId,
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
