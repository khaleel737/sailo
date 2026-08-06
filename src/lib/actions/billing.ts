"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireShop } from "@/lib/session";
import { appUrl, stripe } from "@/lib/stripe";
import { ensureCustomerId, resolveCustomerId } from "@/lib/billing-customer";
import { isPlanId, PLANS } from "@/lib/plans";
import { syncSubscriptionForShop } from "@/lib/billing-sync";

function priceIdFor(plan: string, interval: string) {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}LY`;
  return process.env[key];
}

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

  const price = priceIdFor(plan, interval);
  if (!price) throw new Error(`No Stripe price configured for ${plan}/${interval}`);

  // The pricing table reads `plans.ts`; the charge comes from a Stripe price id
  // in the environment. Nothing links the two, so they can drift — Business
  // once advertised $19.99 while Stripe was set up to charge $29.99. Refuse to
  // send anyone to a checkout that doesn't match what they were shown.
  const definition = PLANS[plan];
  const expected =
    interval === "year" ? definition.yearlyCents : definition.monthlyCents;
  const stripePrice = await stripe().prices.retrieve(price);

  if (
    !stripePrice.active ||
    stripePrice.currency !== "usd" ||
    stripePrice.unit_amount !== expected ||
    stripePrice.recurring?.interval !== interval
  ) {
    throw new Error(
      `Stripe price ${price} does not match the advertised ${definition.name} ` +
        `${interval}ly plan (expected $${(expected / 100).toFixed(2)} USD, got ` +
        `$${((stripePrice.unit_amount ?? 0) / 100).toFixed(2)} ` +
        `${stripePrice.currency.toUpperCase()}/${stripePrice.recurring?.interval ?? "one-off"}` +
        `${stripePrice.active ? "" : ", archived"}). Run scripts/stripe-setup.ts.`,
    );
  }

  const customer = await ensureCustomerId(shop.id);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: shop.id,
    subscription_data: { metadata: { shopId: shop.id, plan } },
    metadata: { shopId: shop.id, plan },
    allow_promotion_codes: true,
    /*
     * Adaptive Pricing would convert $19.99 into the seller's local currency at
     * checkout. The plan table quotes USD and nothing localises it, so a German
     * seller would read "$19.99" here and "€18.04" there. Turn it back on the
     * day plan prices are localised too.
     *
     * `managed_payments` is not a second opinion about the same thing — it is
     * what makes the line above legal. Managed Payments is Stripe's merchant of
     * record product and it is ON by default on newer accounts, including the
     * live one this deploys against. While it is on, Stripe rejects
     * `adaptive_pricing[enabled]=false` outright, so every upgrade 400'd with
     * "adaptive_pricing[enabled] must be `true` when Managed Payments is
     * enabled". Opting this session out of Managed Payments is the escape
     * hatch Stripe's own error names, and it keeps prices in the currency the
     * pricing table advertises.
     *
     * This never showed up locally because the test account does not have
     * Managed Payments enabled — the two accounts are configured differently,
     * which is exactly the kind of drift that only surfaces in production.
     */
    adaptive_pricing: { enabled: false },
    managed_payments: { enabled: false },
    success_url: `${appUrl()}/admin/settings/billing?checkout=success`,
    cancel_url: `${appUrl()}/admin/settings/billing?checkout=cancelled`,
  });

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

/** Action wrapper — syncs then busts the cache. Safe to call from a client. */
export async function syncSubscription() {
  const { shop } = await requireShop();
  await syncSubscriptionForShop(shop.id);
  revalidatePath("/admin/settings/billing");
  revalidatePath("/admin");
}
