"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { revalidateShop } from "@/lib/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { paymentMethods, shops, type Shop } from "@sailo/db/schema";
import { and } from "drizzle-orm";
import { requireShop } from "@/lib/session";
import { can } from "@sailo/core/plans";
import { disconnectedFields, loginLink, startOnboarding, syncAccount } from "@/lib/connect";
import { MissingStripeCountryError } from "@sailo/payments";
import { isStripeAccountCountry } from "@sailo/core/countries";

/**
 * Records where the seller's business is, if they have just said.
 *
 * Folded into the connect flow rather than given its own Save button: the
 * answer is only ever needed at the moment the account is created, and a
 * two-step "choose a country, then press Connect" is a step that exists purely
 * because the data model has two writes in it.
 *
 * Ignored once an account exists. From then on Stripe holds the authoritative
 * country and this column is only a record of what we asked for — letting a
 * later edit through would produce a shop row claiming Germany and an account
 * that is permanently American, which is worse than not offering the field.
 */
async function rememberCountry(shop: Shop, formData?: FormData) {
  if (shop.stripeAccountId) return shop;

  const country = String(formData?.get("country") ?? "");
  if (!isStripeAccountCountry(country) || country === shop.stripeCountry) return shop;

  await getDb()
    .update(shops)
    .set({ stripeCountry: country, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  // The row the caller holds was read before this write, and `startOnboarding`
  // is about to read `stripeCountry` off it.
  return { ...shop, stripeCountry: country };
}

/**
 * Sends the seller to Stripe to create or finish their account.
 *
 * A failure here used to escape as a Next runtime error page — a stack trace
 * over the admin, from pressing a button. Stripe's own messages are written to
 * be read by a human, so the seller gets one back on the page they were on and
 * the full error goes to the server log.
 */
export async function connectStripe(formData?: FormData) {
  const { shop: current } = await requireShop();
  if (!can(current, "cardRails")) {
    throw new Error("Card payments are a Business feature.");
  }

  // The country the seller picked on the form, saved before Stripe is asked
  // for anything — `accounts.create` reads it and can never be told again.
  const shop = await rememberCountry(current, formData);

  let url: string;
  try {
    url = await startOnboarding(shop);
  } catch (error) {
    /*
     * The one failure the seller can actually fix, so it gets its own branch
     * rather than a Stripe error message they cannot act on.
     *
     * It should be unreachable — the button is disabled until a country is
     * chosen — but this is the last gate before an account is created with a
     * country that can never be edited, and "unreachable" is not a guarantee
     * when the caller is a server action anyone can POST to.
     */
    if (error instanceof MissingStripeCountryError) {
      redirect("/admin/payments?stripe=country");
    }
    console.error("[sailo] Stripe Connect onboarding failed:", error);
    const reason =
      error instanceof Error ? error.message : "Stripe did not respond.";
    redirect(
      `/admin/payments?stripe=error&reason=${encodeURIComponent(reason.slice(0, 300))}`,
    );
  }

  redirect(url);
}

/**
 * Re-reads the account from Stripe.
 *
 * Called on return from onboarding and from a button, because Stripe can clear
 * an account for charges minutes or days after the seller finishes — there is
 * no moment we can assume it.
 */
export async function refreshStripeAccount() {
  const { shop } = await requireShop();
  const account = await syncAccount(shop);

  // Charges going live is what makes the rail offerable, so the card method
  // appears the moment that becomes true rather than needing another click.
  if (account?.charges_enabled) {
    const db = getDb();
    const existing = await db.query.paymentMethods.findFirst({
      where: and(
        eq(paymentMethods.shopId, shop.id),
        eq(paymentMethods.type, "card"),
      ),
      columns: { id: true },
    });

    if (existing) {
      await db
        .update(paymentMethods)
        .set({ isEnabled: true, updatedAt: new Date() })
        .where(eq(paymentMethods.id, existing.id));
    } else {
      await db.insert(paymentMethods).values({
        shopId: shop.id,
        type: "card",
        isEnabled: true,
        // First in the list: it's the only rail that completes the sale on the
        // spot, so it's the one most buyers should see first.
        position: 0,
        config: {},
      });
    }
  }

  revalidatePath("/admin/payments");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
}

/** Opens the seller's own Stripe dashboard — payouts, disputes, receipts. */
export async function openStripeDashboard() {
  const { shop } = await requireShop();
  if (!shop.stripeAccountId) redirect("/admin/payments");
  const url = await loginLink(shop.stripeAccountId);
  redirect(url);
}

/**
 * Unlinks the account from this shop.
 *
 * The Stripe account itself is left alone: it may hold the seller's payout
 * history and past charges, and deleting it from here would destroy records
 * they are required to keep. Disabling the rail is what stops new orders.
 */
export async function disconnectStripe() {
  const { shop } = await requireShop();
  const db = getDb();

  await db
    .update(shops)
    .set({ ...disconnectedFields, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  // Only the card rail — the seller's WhatsApp and bank transfer are theirs
  // and have nothing to do with Stripe.
  await db
    .update(paymentMethods)
    .set({ isEnabled: false, updatedAt: new Date() })
    .where(
      and(eq(paymentMethods.shopId, shop.id), eq(paymentMethods.type, "card")),
    );

  revalidatePath("/admin/payments");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
}
