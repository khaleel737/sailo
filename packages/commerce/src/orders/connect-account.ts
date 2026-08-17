/**
 * The seller's own Stripe account: onboarding it, reading it back, linking to it.
 *
 * This is not checkout. It is the account a checkout later charges *on behalf of*, and the
 * questions it answers — has this shop finished verifying, may it take cards yet, where does
 * the seller go to fix it — are asked by the settings screen and the storefront long before
 * any buyer arrives. It shared a file with the checkout for no better reason than both
 * mentioning Connect.
 */

import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, type Shop } from "@sailo/db/schema";
import {
  accountFields,
  connectOnboardingLink,
  publicShopUrl as shopUrlUnder,
  stripe,
} from "@sailo/payments";
import { appOrigin } from "@sailo/core/origin";
import type Stripe from "stripe";

/** This deployment's origin. Read once, for the same reason `@sailo/email/origin` reads it. */
const appUrl = appOrigin;

export const disconnectedFields = {
  stripeAccountId: null,
  stripeChargesEnabled: false,
  stripeDetailsSubmitted: false,
  stripeAccountCountry: null,
  stripeConnectedAt: null,
};

/**
 * The shop's public address, as this deployment serves it.
 *
 * The rule about which addresses Stripe will accept is shared — the phone
 * opens the same kind of account — so it lives in `@sailo/payments`. What is
 * web's alone is knowing where "here" is, which is the one thing this adds.
 */
/**
 * The storefront's public address on *this* deployment.
 *
 * Renamed from `publicShopUrl`, which `@sailo/payments/connect` also exports with
 * a different arity — it takes the base explicitly, because Stripe onboarding has
 * to name a host that is not necessarily ours. This one supplies the base from
 * the environment, which is the only difference and exactly the kind that is
 * invisible at a call site when both are called the same thing.
 */
export function shopUrl(handle: string): string | null {
  return shopUrlUnder(appUrl(), handle);
}

/**
 * Sends the seller to Stripe to create or finish their account, and comes
 * back to the admin.
 *
 * The flow itself is shared; only these two URLs are web's. The app calls the
 * same function with `sailo://` redirects, which is what lets its browser
 * sheet close itself instead of asking the seller to find a Close button.
 */
export async function startOnboarding(shop: Shop) {
  return connectOnboardingLink(shop, {
    siteUrl: appUrl(),
    returnUrl: `${appUrl()}/admin/payments?stripe=return`,
    // Refresh is what Stripe calls when the link has expired — it must start
    // the flow again, not dead-end on an error page. `/admin/payments` renders
    // the Connect card, from which the seller presses Connect again.
    refreshUrl: `${appUrl()}/admin/payments?stripe=refresh`,
  });
}

/**
 * Re-reads the account from Stripe and stores its state.
 *
 * Onboarding finishing is not the same as being able to charge — Stripe may
 * still be verifying — so the return redirect syncs rather than assuming.
 */
export async function syncAccount(shop: Shop) {
  if (!shop.stripeAccountId) return null;

  let account: Stripe.Account;
  try {
    account = await stripe().accounts.retrieve(shop.stripeAccountId);
  } catch {
    // Deleted or rejected on Stripe's side: clear it so the seller can start
    // over rather than being stuck pointing at an account that isn't there.
    await getDb()
      .update(shops)
      .set({ ...disconnectedFields, updatedAt: new Date() })
      .where(eq(shops.id, shop.id));
    return null;
  }

  await getDb()
    .update(shops)
    .set({ ...accountFields(account), updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  return account;
}

/** A link into Stripe's own dashboard for the connected account. */
export async function loginLink(accountId: string) {
  const link = await stripe().accounts.createLoginLink(accountId);
  return link.url;
}

export type ConnectState =
  | "not_connected"
  | "onboarding"
  | "verifying"
  | "active";

export function connectState(shop: {
  stripeAccountId: string | null;
  stripeDetailsSubmitted: boolean;
  stripeChargesEnabled: boolean;
}): ConnectState {
  if (!shop.stripeAccountId) return "not_connected";
  if (!shop.stripeDetailsSubmitted) return "onboarding";
  if (!shop.stripeChargesEnabled) return "verifying";
  return "active";
}

/**
 * The Checkout Session a card buyer is sent to.
 *
 * Created **on the connected account** (`stripeAccount`), which makes it a
 * direct charge: the money never passes through Sailo's balance.
 *
 * The line items restate the order rather than pointing at a Stripe product —
 * Sailo's catalogue is the source of truth and mirroring it into Stripe would
 * be a second thing to keep in sync.
 *
 * Amounts come from the order row, which was computed server-side, so a
 * tampered client can't change what Stripe charges.
 */
