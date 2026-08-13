"use server";

import { redirect } from "next/navigation";
import { requireShop } from "@/lib/session";
import { stripe } from "@sailo/payments";
import { appUrl } from "@/lib/app-url";
import { ensureCustomerId, resolveCustomerId } from "@/lib/billing-customer";
import { isPlanId } from "@/lib/plans";
import {
  checkoutSessionParams,
  priceEnvKey,
  priceMismatch,
} from "@/lib/billing-checkout";

/**
 * Sends the seller to Stripe Checkout. The subscription is only applied when
 * the webhook confirms it — the success redirect is a UI convenience, never
 * the source of truth.
 */
export async function startCheckout(formData: FormData) {
  const { shop } = await requireShop();

  const plan = String(formData.get("plan") ?? "");
  const interval = String(formData.get("interval") ?? "month");
  if (!isPlanId(plan) || plan === "free") return;
  if (interval !== "month" && interval !== "year") return;

  const price = process.env[priceEnvKey(plan, interval)];
  if (!price) throw new Error(`No Stripe price configured for ${plan}/${interval}`);

  // Refuse to send anyone to a checkout that charges something other than what
  // the pricing table showed them.
  const reason = priceMismatch(plan, interval, await stripe().prices.retrieve(price));
  if (reason) throw new Error(`Stripe price ${price} ${reason}`);

  const customer = await ensureCustomerId(shop.id);
  const session = await stripe().checkout.sessions.create(
    checkoutSessionParams({ shopId: shop.id, plan, price, customer }),
  );

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  redirect(session.url);
}

/** Stripe-hosted portal for changing plan, card or cancelling. */
export async function openBillingPortal() {
  const { shop } = await requireShop();
  if (!shop.stripeCustomerId) redirect("/admin/settings/billing");

  /*
   * Resolve rather than trust. Unlike checkout there is nothing to create
   * here: a customer Stripe has never heard of has no invoices, cards or
   * subscription to manage, so the honest destination is the billing page.
   */
  const customer = await resolveCustomerId(shop.stripeCustomerId);
  if (!customer) redirect("/admin/settings/billing");

  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${appUrl()}/admin/settings/billing`,
  });

  redirect(session.url);
}
