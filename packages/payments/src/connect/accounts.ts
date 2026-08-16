import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, type Shop } from "@sailo/db/schema";
import { isStripeAccountCountry } from "@sailo/core/countries";
import { baseCapabilities, capabilitiesFor, requestCapabilities } from "./capabilities";
import { stripe } from "../stripe/client";

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
 * Thrown when a shop tries to connect before saying where it is.
 *
 * Its own class so the two callers can tell it apart from Stripe being down.
 * One sends the seller to the country picker; the other, on the phone, shows
 * the same prompt in a sheet. A generic Error would have both of them
 * pattern-matching on message text.
 */
export class MissingStripeCountryError extends Error {
  constructor() {
    super("This shop has no business location set.");
    this.name = "MissingStripeCountryError";
  }
}

/**
 * The country Stripe will open the account in, or a refusal to guess.
 *
 * Deliberately not defaulted. Every fallback available here is wrong often
 * enough to matter: the platform's country is what caused this bug, the shop's
 * currency maps to twenty countries for EUR alone, and the seller's IP is
 * where they happened to be sitting. The value is unchangeable once the
 * account exists, so the only acceptable source is a seller who was shown the
 * question and answered it.
 */
export function requireStripeCountry(shop: Shop): string {
  if (!isStripeAccountCountry(shop.stripeCountry)) {
    throw new MissingStripeCountryError();
  }
  return shop.stripeCountry;
}

/**
 * Brings an account's capabilities up to what its country allows.
 *
 * `createCheckoutSession` deliberately does not pin `payment_method_types`, so
 * Stripe decides at runtime which methods to show — from the buyer, the
 * currency, the amount, and the account's *active capabilities*. That last one
 * is the only half Sailo controls, and for an Express account it is the half
 * that decides everything: Stripe will not offer a payment method whose
 * capability was never requested, no matter what the Dashboard says.
 *
 * Which capabilities, and why one call per refusal rather than one call, is
 * `capabilities.ts`.
 *
 * Idempotent — re-requesting an active capability is a no-op — so this runs on
 * every visit to the payments screen. That is also the backfill: a shop
 * connected before a capability was added to the table picks it up the next
 * time its owner opens the page, with no migration to run over old accounts.
 */
export async function syncCapabilities(account: Stripe.Account) {
  const wanted = capabilitiesFor(account.country);
  const outcome = await requestCapabilities(stripe(), account.id, wanted);

  if (outcome.refused.length > 0) {
    // Worth a line in the log and nothing more: the account still takes cards,
    // and a seller cannot act on Stripe declining to offer them BLIK.
    console.warn(
      `[sailo] ${account.id} (${account.country ?? "??"}) refused ` +
        outcome.refused.map((r) => r.name).join(", "),
    );
  }

  return outcome;
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

    /*
     * The seller's own country, and the one field on this call that cannot be
     * corrected afterwards.
     *
     * Omitting it does not mean "ask the seller during onboarding" — it means
     * the account is created in *the platform's* country. Sailo's platform is
     * in the US, so every account made without this line was a US account: a
     * German seller was asked for a US tax ID and a US bank account, and no
     * European payment method was reachable however many capabilities were
     * requested, because eligibility is decided by the connected account's
     * business location.
     *
     * `requireStripeCountry` refuses rather than guessing. A wrong country is
     * not an inconvenience here — Stripe fixes it at creation and offers no
     * edit, so recovering means deleting the account and starting the whole
     * verification again. Better to send the seller back to a dropdown.
     */
    const country = requireStripeCountry(shop);

    const account = await stripe().accounts.create({
      type: "express",
      country,
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
      // Only the pair the account cannot take a card without. Everything else
      // goes up separately, because a capability this country cannot have
      // would otherwise fail the *creation* rather than just itself.
      capabilities: baseCapabilities(),
      metadata: { shopId: shop.id, handle: shop.handle },
    });
    accountId = account.id;

    await syncCapabilities(account);

    await db
      .update(shops)
      .set({ ...accountFields(account), stripeConnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(shops.id, shop.id));
  } else {
    /*
     * The backfill, at the one moment it is free: a seller who already has an
     * account and has come back to the payments screen.
     *
     * Read the account first rather than trusting `shop.stripeCountry`. The
     * country that decides which capabilities are obtainable is the one Stripe
     * holds, and for every account created before this file asked for one it
     * is US regardless of what the shop row now says.
     */
    const existing = await stripe().accounts.retrieve(accountId);
    await syncCapabilities(existing);
  }

  const link = await stripe().accountLinks.create({
    account: accountId,
    refresh_url: redirects.refreshUrl,
    return_url: redirects.returnUrl,
    type: "account_onboarding",
  });

  return link.url;
}

/* --------------------------------------------------------------------------
   The three calls the phone needed, and the header they all ride on.

   The header comment above says onboarding was "the one part of
   `apps/web/src/lib/connect.ts` that had to leave it", and that everything
   else there "is called from a browser request and only ever will be." That
   was true when it was written and is no longer: refunding an order, cancelling
   a membership and opening a billing portal are all things a seller does
   standing up, and `packages/api` cannot import from `apps/web`.

   They are lifted rather than copied for the reason `refund_application_fee`
   makes plain — a second copy that forgot that flag would refund the buyer in
   full and leave Sailo as the only party that profited from a sale which got
   undone. apps/web now re-exports these from here.
-------------------------------------------------------------------------- */

/**
 * The `stripeAccount` header, unless the shop *is* the platform account.
 *
 * A real seller always has a distinct connected account and gets the header —
 * that is what makes the charge land in their balance rather than ours. The
 * exception exists so the platform's own Stripe account can be attached to a
 * shop and exercise the whole flow end to end; Stripe rejects the header when
 * it names the calling account itself.
 */
export function actingAs(accountId: string): { stripeAccount?: string } {
  const platform = process.env.STRIPE_PLATFORM_ACCOUNT_ID;
  return accountId && accountId !== platform ? { stripeAccount: accountId } : {};
}

/** Money back to the buyer, and Sailo's cut back with it. */
export async function refundCharge(opts: {
  accountId: string;
  paymentIntentId: string;
  amountCents: number;
}) {
  return stripe().refunds.create(
    {
      payment_intent: opts.paymentIntentId,
      amount: opts.amountCents,
      /*
       * Give our fee back with the money.
       *
       * Without this the seller refunds the buyer in full and is still out
       * Sailo's cut — we would be the only party who profited from a sale that
       * got undone. Stripe returns it in proportion to the amount refunded, so
       * a partial refund returns part of the fee.
       */
      refund_application_fee: true,
    },
    actingAs(opts.accountId),
  );
}

/** Stripe's own hosted page for a member's card and subscription. */
export async function billingPortalSession(opts: {
  accountId: string;
  customerId: string;
  returnUrl: string;
}) {
  return stripe().billingPortal.sessions.create(
    { customer: opts.customerId, return_url: opts.returnUrl },
    actingAs(opts.accountId),
  );
}

/**
 * Stops a subscription at the end of the period the member already paid for.
 *
 * Never immediately, and not as a kindness: they have paid for the month, so
 * ending it today would be taking money for access we then withdrew. Stripe
 * reports the change back through `customer.subscription.updated`, which is
 * what actually writes it here — this function's return value is not the
 * source of truth and no caller treats it as one.
 */
export async function cancelSubscriptionAtPeriodEnd(opts: {
  accountId: string;
  subscriptionId: string;
}) {
  return stripe().subscriptions.update(
    opts.subscriptionId,
    { cancel_at_period_end: true },
    actingAs(opts.accountId),
  );
}
