import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { stripe } from "@/lib/stripe";

/* ===========================================================================
   The shop's Stripe customer

   `shops.stripeCustomerId` is a cache of something that lives in Stripe, and
   it can go stale in ways that are nobody's fault:

     - the id was minted against test keys and the deployment now runs live
       ones, or the other way round. Test and live are separate namespaces, so
       a perfectly well-formed `cus_…` from one simply does not exist in the
       other;
     - somebody deleted the customer in the Stripe dashboard;
     - the row was restored from a backup taken against a different account.

   Handing a stale id to Stripe fails with `resource_missing`, and every path
   that did so used to surface as a 500 on the upgrade button — which is what
   "upgrade does nothing" looked like from the outside.

   So: never trust the stored id without asking. `resource_missing` is the only
   error treated as stale; an auth failure or a network blip has to propagate,
   because minting a second customer for a shop that already has a good one
   would orphan its subscription.
=========================================================================== */

/** True only for Stripe's "this object does not exist" response. */
function isMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "resource_missing"
  );
}

/**
 * The stored id, if Stripe still has an undeleted customer under it.
 *
 * Returns null when the id is stale — the caller decides whether that means
 * "make a new one" or "there is nothing to read here".
 */
export async function resolveCustomerId(id: string): Promise<string | null> {
  try {
    const customer = await stripe().customers.retrieve(id);
    // A deleted customer still retrieves, as a stub with `deleted: true`.
    return customer.deleted ? null : customer.id;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * A customer id that is known to exist right now.
 *
 * Creates one on first upgrade, and replaces the stored id if it no longer
 * resolves. Writing the new id back is what stops the next attempt paying the
 * same round trip.
 */
export async function ensureCustomerId(shopId: string): Promise<string> {
  const db = getDb();
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop) throw new Error("Shop not found");

  if (shop.stripeCustomerId) {
    const resolved = await resolveCustomerId(shop.stripeCustomerId);
    if (resolved) return resolved;
  }

  const customer = await stripe().customers.create({
    name: shop.name,
    email: shop.contactEmail ?? undefined,
    // Lets the webhook find the shop even if client_reference_id is missing.
    metadata: { shopId: shop.id, handle: shop.handle },
  });

  await db
    .update(shops)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  return customer.id;
}
