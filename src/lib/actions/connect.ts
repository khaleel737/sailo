"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentMethods, shops } from "@/db/schema";
import { and } from "drizzle-orm";
import { requireShop } from "@/lib/session";
import { can } from "@/lib/plans";
import {
  disconnectedFields,
  loginLink,
  startOnboarding,
  syncAccount,
} from "@/lib/connect";

export type ConnectState = { ok: boolean; error?: string; message?: string };

/** Sends the seller to Stripe to create or finish their account. */
export async function connectStripe() {
  const { shop } = await requireShop();
  if (!can(shop, "cardRails")) {
    throw new Error("Card payments are a Business feature.");
  }

  const url = await startOnboarding(shop);
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
}
