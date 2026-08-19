"use server";

import type Stripe from "stripe";
import { redirect } from "next/navigation";
import { requireShop } from "@/lib/session";
import { stripe } from "@sailo/payments";
import { appUrl } from "@/lib/app-url";
import { ensureCustomerId, resolveCustomerId } from "@sailo/billing/customer";
import { isPlanId } from "@sailo/core/plans";
import {
  checkoutSessionParams,
  priceEnvKey,
  priceMismatch,
} from "@sailo/billing/checkout";

/**
 * Sends the seller to Stripe Checkout. The subscription is only applied when
 * the webhook confirms it — the success redirect is a UI convenience, never
 * the source of truth.
 */
export async function startCheckout(formData: FormData) {
  const { shop } = await requireShop("settings:write");

  const plan = String(formData.get("plan") ?? "");
  const interval = String(formData.get("interval") ?? "month");
  if (!isPlanId(plan) || plan === "free") return;
  if (interval !== "month" && interval !== "year") return;

  /*
   * The card rail, closed to an account that has charged back twice — spec 46.
   *
   * Enforced here rather than only in the UI, because the button being hidden is
   * not a control: this action is a callable endpoint and the whole point of the
   * block is that re-subscribing by card is how the same loss happens again.
   *
   * Deliberately narrow, and the refusal says so: their shop keeps trading, keeps
   * taking card payments from its own buyers, and keeps its storefront. What is
   * closed is the rail they pay *us* on, and nothing is offered in its place —
   * that is the honest position about a customer we do not want a recurring card
   * mandate with.
   */
  if (shop.cardBillingBlockedAt) {
    throw new Error(
      "Card billing is closed on this account after repeated chargebacks on its " +
        "Sailo subscription. Your shop is unaffected and keeps trading. Write to " +
        "support if you believe that is wrong.",
    );
  }

  const price = process.env[priceEnvKey(plan, interval)];
  if (!price) throw new Error(`No Stripe price configured for ${plan}/${interval}`);

  /*
   * Read the price back before quoting it.
   *
   * The failure this guards against is not a typo, it is a *mode*: a price id
   * copied from a test sandbox into production, where the live key cannot see
   * it. Stripe answers that with `resource_missing` — "No such price:
   * 'price_…'" — which is true, unhelpful, and indistinguishable at a glance
   * from a price that was deleted.
   *
   * It reached production once, and what a seller saw was the generic error
   * page: no plan, no reason, nothing to report but a digest. Naming the
   * variable is the whole point — the fix is always to set that one env var to
   * an id belonging to the account the deployment's key is for, and the
   * message should be able to say so without anyone opening a log.
   */
  let quoted: Stripe.Price;
  try {
    quoted = await stripe().prices.retrieve(price);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as { code?: string }).code === "resource_missing"
    ) {
      throw new Error(
        `${priceEnvKey(plan, interval)} is set to ${price}, which this ` +
          `deployment's Stripe account cannot see. That is usually a test-mode ` +
          `price id in a live environment, or the reverse.`,
        { cause: error },
      );
    }
    throw error;
  }

  // Refuse to send anyone to a checkout that charges something other than what
  // the pricing table showed them.
  const reason = priceMismatch(plan, interval, quoted);
  if (reason) throw new Error(`Stripe price ${price} ${reason}`);

  const customer = await ensureCustomerId(shop.id);
  const session = await stripe().checkout.sessions.create(
    checkoutSessionParams({
      shopId: shop.id,
      plan,
      price,
      customer,
      /*
       * This app's own settings page. Passed in rather than read inside
       * `@sailo/billing`: a package with no opinion about which app is asking
       * cannot know whose billing page to return to.
       */
      returnTo: {
        success: `${appUrl()}/admin/settings/billing?checkout=success`,
        cancelled: `${appUrl()}/admin/settings/billing?checkout=cancelled`,
      },
    }),
  );

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  redirect(session.url);
}

/** Stripe-hosted portal for changing plan, card or cancelling. */
export async function openBillingPortal() {
  const { shop } = await requireShop("settings:write");
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
