import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { partners, type Partner } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { stripe } from "@/lib/stripe";

/**
 * Where a partner's money goes: a Stripe connected account that can *only*
 * receive it.
 *
 * Deliberately not `lib/connect.ts`, which onboards sellers. That flow creates
 * an Express account requesting `card_payments` under the **full** service
 * agreement, because a seller is a merchant taking money from buyers. A
 * partner is not: they never charge anyone, they only get paid. So this
 * creates an account requesting `transfers` alone under the **recipient**
 * service agreement, which is Stripe's own name for exactly this relationship
 * — Stripe has no service relationship with the recipient, only we do.
 *
 * The practical difference is what onboarding asks for. A newsletter writer
 * being asked for a merchant category code, a refund policy and a statement
 * descriptor abandons the form; a recipient is asked who they are and where
 * their bank account is, which is all we actually need to pay them.
 *
 * Two consequences of `recipient` worth knowing, both from Stripe's docs:
 *
 *   - Transfers to recipient accounts take an extra 24 hours to land in the
 *     partner's balance. Not a problem for a monthly payout run; it is why the
 *     portal says "on its way" rather than "paid" until the transfer settles.
 *   - `recipient` is available in a subset of countries, and cross-border is
 *     supported between the US, Canada, UK, EEA and Switzerland. Outside that
 *     set the platform and the account must share a region — see
 *     `crossBorderBlocked` below, which is why we check before we transfer
 *     rather than discovering it in a failed payout.
 */

/** Fields we mirror from Stripe onto the partner. */
export function partnerAccountFields(account: Stripe.Account) {
  return {
    stripeAccountId: account.id,
    /*
     * `capabilities.transfers`, not `payouts_enabled`. A recipient account has
     * no charges capability at all, so the seller-side `charges_enabled` check
     * would be false forever; what we need to know is whether Stripe will let
     * us send this account money, and that is the transfers capability.
     */
    stripeTransfersEnabled: account.capabilities?.transfers === "active",
    stripeDetailsSubmitted: Boolean(account.details_submitted),
    stripeAccountCountry: account.country ?? null,
  };
}

export const partnerDisconnectedFields = {
  stripeAccountId: null,
  stripeTransfersEnabled: false,
  stripeDetailsSubmitted: false,
  stripeAccountCountry: null,
  stripeConnectedAt: null,
};

/**
 * Countries whose accounts can be paid across a border from a platform in
 * another of them.
 *
 * Stripe supports cross-border transfers on the payments balance between the
 * US, Canada, the UK, the EEA and Switzerland; anywhere else, the platform and
 * the connected account must be in the same country. Listed here rather than
 * inferred so that a partner in an unsupported country is told at onboarding
 * instead of at payout, when the money has already been counted.
 */
const CROSS_BORDER_ZONE = new Set([
  "US", "CA", "GB", "CH",
  // EEA
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL",
  "PT", "RO", "SK", "SI", "ES", "SE",
]);

/**
 * Our own country, read from Stripe once per process.
 *
 * `STRIPE_PLATFORM_COUNTRY` short-circuits it so a test or a preview deploy can
 * state the answer, but the fallback is the account itself rather than a
 * default — an environment variable that drifts from the real account would
 * silently pick the wrong service agreement, and that failure surfaces as a
 * partner unable to finish onboarding with no explanation.
 */
let cachedPlatformCountry: string | null = null;

export async function platformCountry(): Promise<string | null> {
  const configured = process.env.STRIPE_PLATFORM_COUNTRY?.toUpperCase();
  if (configured) return configured;
  if (cachedPlatformCountry) return cachedPlatformCountry;

  try {
    // `GET /v1/account` returns the account the key belongs to. The SDK types
    // only model the by-id form, so it is read through a narrowed alias.
    const readPlatform = stripe().accounts.retrieve.bind(
      stripe().accounts,
    ) as unknown as () => Promise<Stripe.Account>;
    const account = await readPlatform();
    cachedPlatformCountry = account.country?.toUpperCase() ?? null;
    return cachedPlatformCountry;
  } catch {
    return null;
  }
}

/**
 * Which service agreement a partner in this country goes under.
 *
 * **This is not a preference, it is a rule Stripe enforces.** The `recipient`
 * agreement exists for *cross-border* payouts, and Stripe rejects it outright
 * when the platform and the account share a country: "The recipient ToS
 * agreement is not supported for platforms in US creating accounts in US."
 * Sending it unconditionally — which this code did until `check:partners`
 * caught it — makes onboarding fail for every domestic partner, which is the
 * majority of them.
 *
 * So: same country gets the default (`full`) agreement, a different country
 * gets `recipient`. The guarantee we actually care about survives either way,
 * because it comes from the *capabilities* and not from the agreement — an
 * account that never requests `card_payments` cannot process a payment under
 * either one.
 */
export function serviceAgreementFor(
  partnerCountry: string | null,
  platform: string | null,
): "recipient" | null {
  if (!partnerCountry || !platform) return null;
  return partnerCountry.toUpperCase() === platform.toUpperCase()
    ? null
    : "recipient";
}

/**
 * Whether Stripe will refuse a transfer from us to this country outright.
 *
 * Returns false when we don't know our own platform country — the answer then
 * is "let Stripe decide", because guessing would block legitimate payouts on a
 * lookup that happened to fail.
 */
export function crossBorderBlocked(
  partnerCountry: string | null,
  platform = process.env.STRIPE_PLATFORM_COUNTRY?.toUpperCase() ??
    cachedPlatformCountry,
): boolean {
  if (!platform || !partnerCountry) return false;

  const partner = partnerCountry.toUpperCase();
  if (platform.toUpperCase() === partner) return false;

  return !(
    CROSS_BORDER_ZONE.has(platform.toUpperCase()) && CROSS_BORDER_ZONE.has(partner)
  );
}

/**
 * Everything that has to be true before we can send a partner money.
 *
 * One function because it is asked in three places that must agree: the
 * portal's "you're ready to be paid" banner, HQ's payout button, and the cron
 * run that actually transfers. A partner shown as payable by one and refused
 * by another is the bug this prevents.
 */
export function canReceiveTransfer(partner: {
  status: string;
  stripeAccountId: string | null;
  stripeTransfersEnabled: boolean;
  stripeAccountCountry: string | null;
}): boolean {
  return (
    partner.status === "approved" &&
    Boolean(partner.stripeAccountId) &&
    partner.stripeTransfersEnabled &&
    !crossBorderBlocked(partner.stripeAccountCountry)
  );
}

/**
 * Creates the partner's recipient account if they don't have one, then returns
 * a fresh onboarding link.
 *
 * Account links are single-use and expire in minutes, so one is minted per
 * click rather than stored.
 *
 * `country` is taken from the partner's own answer rather than geolocated: it
 * determines which bank details Stripe asks for and which service agreement is
 * even available, and getting it from an IP address would strand anyone
 * onboarding from an airport.
 */
export async function startPartnerOnboarding(
  partner: Partner,
  country?: string,
): Promise<string> {
  const db = getDb();
  let accountId = partner.stripeAccountId;

  if (!accountId) {
    const partnerCountry = country?.toUpperCase() || null;
    /*
     * `recipient` only when the partner is abroad — Stripe rejects it for a
     * domestic account. See `serviceAgreementFor`, which exists because
     * sending it unconditionally broke onboarding for every US partner.
     */
    const agreement = serviceAgreementFor(
      partnerCountry,
      await platformCountry(),
    );

    const account = await stripe().accounts.create({
      type: "express",
      country: partnerCountry ?? undefined,
      /*
       * Transfers alone, and this is what actually guarantees a partner can
       * never take a payment. An account with no `card_payments` capability
       * has no way to create a charge, under either service agreement —
       * whereas requesting it would put them through merchant onboarding they
       * have no use for.
       */
      capabilities: { transfers: { requested: true } },
      /*
       * Set at creation and never in an update: the agreement cannot be
       * changed once accepted, so getting it wrong here means deleting the
       * account and starting again.
       */
      ...(agreement
        ? { tos_acceptance: { service_agreement: agreement } }
        : {}),
      business_profile: {
        product_description:
          "Referral commission earned through the Sailo partner programme.",
      },
      metadata: { partnerId: partner.id, sailoRole: "partner" },
    });
    accountId = account.id;

    await db
      .update(partners)
      .set({
        ...partnerAccountFields(account),
        stripeConnectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(partners.id, partner.id));
  }

  const link = await stripe().accountLinks.create({
    account: accountId,
    // Refresh is what Stripe calls when the link has expired — it must start
    // the flow again, not dead-end on an error page.
    refresh_url: `${appUrl()}/partners/connect?state=refresh`,
    return_url: `${appUrl()}/partners/connect?state=return`,
    type: "account_onboarding",
  });

  return link.url;
}

/**
 * Re-reads the account from Stripe and stores its state.
 *
 * Onboarding finishing is not the same as being payable — Stripe may still be
 * verifying — so the return redirect syncs rather than assuming.
 *
 * A retrieve that throws means the account was deleted or rejected on Stripe's
 * side. Clearing our copy lets the partner start over instead of being stuck
 * pointing at an account that isn't there; keeping a dead id would make every
 * future payout fail with a message nobody could act on.
 */
export async function syncPartnerAccount(
  partner: Partner,
): Promise<Stripe.Account | null> {
  if (!partner.stripeAccountId) return null;

  let account: Stripe.Account;
  try {
    account = await stripe().accounts.retrieve(partner.stripeAccountId);
  } catch {
    await getDb()
      .update(partners)
      .set({ ...partnerDisconnectedFields, updatedAt: new Date() })
      .where(eq(partners.id, partner.id));
    return null;
  }

  await getDb()
    .update(partners)
    .set({ ...partnerAccountFields(account), updatedAt: new Date() })
    .where(eq(partners.id, partner.id));

  return account;
}

/** A link into Stripe's own dashboard, where the partner sees their payouts. */
export async function partnerLoginLink(accountId: string): Promise<string> {
  const link = await stripe().accounts.createLoginLink(accountId);
  return link.url;
}

export type PartnerConnectState =
  | "not_connected"
  | "onboarding"
  | "verifying"
  | "unsupported_country"
  | "active";

/** The one-word answer the portal renders a banner from. */
export function partnerConnectState(partner: {
  stripeAccountId: string | null;
  stripeDetailsSubmitted: boolean;
  stripeTransfersEnabled: boolean;
  stripeAccountCountry: string | null;
}): PartnerConnectState {
  if (!partner.stripeAccountId) return "not_connected";
  if (crossBorderBlocked(partner.stripeAccountCountry)) {
    return "unsupported_country";
  }
  if (!partner.stripeDetailsSubmitted) return "onboarding";
  if (!partner.stripeTransfersEnabled) return "verifying";
  return "active";
}
