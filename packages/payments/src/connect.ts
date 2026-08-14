import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, type Shop } from "@sailo/db/schema";
import { stripe } from "./stripe";

/**
 * Opening a seller's connected account, and the single-use link that walks
 * them through Stripe's onboarding.
 *
 * This is the one part of `apps/web/src/lib/connect.ts` that had to leave it.
 * Everything else there — the checkout session, the refund, the membership
 * price — is called from a browser request and only ever will be. Onboarding
 * is different: the phone has to be able to start it too, and the seam between
 * the two is exactly two URLs. A browser comes back to `/admin/payments`; the
 * app comes back to `sailo://`, which is what dismisses the browser sheet
 * instead of stranding the seller on a Stripe page with no way home.
 *
 * So the redirects are arguments rather than something this file decides, and
 * nothing else about the flow is duplicated per client: one account shape, one
 * capability set, one place that writes the account id onto the shop.
 */

/** Fields we mirror from Stripe onto the shop. */
export function accountFields(account: Stripe.Account) {
  return {
    stripeAccountId: account.id,
    stripeChargesEnabled: Boolean(account.charges_enabled),
    stripeDetailsSubmitted: Boolean(account.details_submitted),
    stripeAccountCountry: account.country ?? null,
  };
}

/**
 * The shop's public address, but only when Stripe will accept it.
 *
 * `business_profile.url` has to be a URL Stripe can actually reach. Anything
 * local — localhost, an IP, a bare hostname, a .local domain — is refused with
 * a flat "Not a valid URL" that names no field, so the first person to press
 * Connect on a dev machine gets a runtime error and no idea which of the eight
 * parameters was wrong. Returning null here means we send a description of the
 * business instead and let Stripe ask the seller for their address during
 * onboarding, which it does anyway.
 *
 * Takes the deployment's own address rather than reading it from the
 * environment: apps/web and apps/api spell that variable differently, and a
 * function that reads `process.env` is a function neither of them can test
 * without setting one.
 */
export function publicShopUrl(siteUrl: string, handle: string): string | null {
  let url: URL;
  try {
    url = new URL(`${siteUrl}/${handle}`);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    // A bare hostname with no dot can't resolve publicly either.
    !host.includes(".") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith("[");

  return isLocal ? null : url.toString();
}

/**
 * What a connected account is allowed to take money through.
 *
 * `createCheckoutSession` deliberately does not pin `payment_method_types`, so
 * Stripe decides at runtime which of these to show — from the buyer's country
 * and device and the account's active capabilities. Everything here therefore
 * reaches the checkout with no code behind it beyond this list. Apple Pay and
 * Google Pay need no entry at all; they ride `card_payments`.
 *
 * Deliberately short. Stripe's own guidance: "The capabilities you request for
 * a connected account determine the information you're required to collect for
 * it… Requesting more capabilities means the onboarding flow must verify more
 * information." Every extra line here is another question between a seller and
 * their first sale, so a rail earns its place by being one a small US seller
 * actually gets asked for.
 *
 * Not here on purpose:
 *  - Affirm, Klarna and Afterpay decide eligibility on the account's merchant
 *    category code, and `business_profile` below sets no `mcc`. Requesting
 *    them before that exists buys the onboarding questions and none of the
 *    payments. They also finance a purchase, and nobody finances a $45 cake.
 *  - PayPal and Venmo are not obtainable at all: Stripe lists no US business
 *    location for PayPal, does not support it on direct charges, and does not
 *    offer it to platforms whose connected accounts take payment directly.
 *    Venmo has no Stripe support anywhere. Both ship as manual rails instead —
 *    see `PAYMENT_METHOD_DEFS`.
 */
const BASE_CAPABILITIES = {
  card_payments: { requested: true },
  transfers: { requested: true },
} as const;

export const WALLET_CAPABILITIES = {
  /** Stripe's own wallet. One tap for anyone who has used Link anywhere. */
  link_payments: { requested: true },
  /** US only, USD only, and Stripe simply won't offer it elsewhere. */
  cashapp_payments: { requested: true },
  /** Cheap on larger orders, where card fees start to hurt a small seller. */
  us_bank_account_ach_payments: { requested: true },
} as const;

/**
 * Adds the wallet capabilities to an account, and shrugs if Stripe says no.
 *
 * Separate from account *creation* on purpose, and swallowing its own error on
 * purpose, because these three are country-scoped and Sailo's sellers are not
 * all in those countries. Stripe rejects a capability the account's country
 * cannot have rather than leaving it inactive — so requesting them inside
 * `accounts.create` would mean a seller in a country without Cash App could not
 * open a Stripe account at all, which is a far worse failure than not being
 * offered a wallet they could never use.
 *
 * Idempotent: re-requesting an active capability is a no-op, so this is safe to
 * run on every visit and safe to run over every shop after adding a line above.
 */
export async function requestWalletCapabilities(accountId: string) {
  try {
    return await stripe().accounts.update(accountId, {
      capabilities: WALLET_CAPABILITIES,
    });
  } catch (error) {
    // Not an error the seller can act on, and nothing they were promised.
    console.warn("[sailo] wallet capabilities not available for", accountId, error);
    return null;
  }
}

/** Where Stripe sends the seller when it is done with them. */
export type OnboardingRedirects = {
  /**
   * This deployment's own address, used to work out the storefront URL Stripe
   * is told about. Not where the seller comes back to — that is `returnUrl`.
   */
  siteUrl: string;
  /** Where the seller lands on leaving or completing the flow. */
  returnUrl: string;
  /**
   * Where Stripe sends them when the link has expired or has already been
   * used. It must start the flow again rather than dead-end on an error page,
   * so whatever handles it asks for a fresh link and opens that.
   */
  refreshUrl: string;
};

/**
 * Creates the seller's connected account if they don't have one, then returns
 * a fresh onboarding link.
 *
 * Account links are single-use and expire in minutes, so one is minted per
 * click rather than stored.
 */
export async function connectOnboardingLink(
  shop: Shop,
  redirects: OnboardingRedirects,
): Promise<string> {
  const db = getDb();
  let accountId = shop.stripeAccountId;

  if (!accountId) {
    const shopUrl = publicShopUrl(redirects.siteUrl, shop.handle);

    const account = await stripe().accounts.create({
      type: "express",
      email: shop.contactEmail ?? undefined,
      business_profile: {
        name: shop.name,
        ...(shopUrl
          ? { url: shopUrl }
          : {
              product_description:
                shop.description?.trim().slice(0, 500) ||
                `Products and services sold through ${shop.name}.`,
            }),
      },
      capabilities: BASE_CAPABILITIES,
      metadata: { shopId: shop.id, handle: shop.handle },
    });
    accountId = account.id;

    // After creation, never inside it — see `requestWalletCapabilities`.
    await requestWalletCapabilities(accountId);

    await db
      .update(shops)
      .set({ ...accountFields(account), stripeConnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(shops.id, shop.id));
  } else {
    /*
     * The backfill, at the one moment it is free: a seller who already has an
     * account and has come back to the payments screen. Accounts created
     * before a capability was added never requested it, so without this a
     * shop connected last month keeps offering card alone for ever. Requesting
     * an already-active capability is a no-op, so this is safe every time.
     */
    await requestWalletCapabilities(accountId);
  }

  const link = await stripe().accountLinks.create({
    account: accountId,
    refresh_url: redirects.refreshUrl,
    return_url: redirects.returnUrl,
    type: "account_onboarding",
  });

  return link.url;
}
