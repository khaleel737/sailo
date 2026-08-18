/**
 * How a **buyer** pays a **seller**.
 *
 * What a *seller* pays *Sailo* is `@sailo/billing`, and the two used to be one
 * package on the strength of both calling Stripe. They have different
 * customers and different failure modes; sharing a vendor is not sharing a
 * responsibility.
 *
 * Split by the rail the money arrives on, and by the question each part
 * answers:
 *
 *   ./stripe   — the client, and the three questions asked of an incoming
 *                webhook event: is it really Stripe's (`verify`), have we
 *                already handled it (`idempotency`), and which row is it
 *                allowed to touch (`ownership`)?
 *   ./connect  — the seller's connected account: opening it, the link that
 *                finishes it, and which capabilities their country grants.
 *   ./offline  — every way of getting paid that is not a card. Cash on
 *                delivery, bank transfer, a WhatsApp handoff: what the shop has
 *                switched on (`rails`), what each one is configured with
 *                (`settings`), and what the buyer is shown once they pick one
 *                (`handoff`).
 *
 * `./offline` is not a lesser case. In the markets Sailo sells into it is the
 * *only* case for most shops, and `isRailUsable` is what decides whether a
 * seller who takes cash is told their shop can be paid at all.
 *
 * WHAT DELIBERATELY IS NOT HERE
 *
 * The webhook **orchestrators** — `platform`, the webhook half of `connect`,
 * and `memberships` — are still in `apps/web/src/lib/stripe-webhooks`. They
 * take a verified event and fan out into stock, downloads, invoices, buyer and
 * seller email, outbound seller webhooks and the partner ledger. Lifting them
 * means bringing half of `apps/web` behind them, which stops being true once
 * email, commerce and partners have moved out; they follow then, not before.
 */

export { billingEnabled, stripe } from "./stripe/client";
export { HANDLED, signingSecrets, verifyEvent } from "./stripe/verify";
export { claimEvent, releaseEvent } from "./stripe/idempotency";
export {
  intentIdOf,
  orderForIntent,
  orderForSession,
  ownedBySender,
  sameAccount,
  sendingAccount,
  shopIdFor,
} from "./stripe/ownership";
export {
  accountFields,
  actingAs,
  billingPortalSession,
  cancelSubscriptionAtPeriodEnd,
  connectOnboardingLink,
  MissingStripeCountryError,
  publicShopUrl,
  refundCharge,
  requireStripeCountry,
  setSubscriptionApplicationFee,
  syncCapabilities,
  accountRails,
  type OnboardingRedirects,
} from "./connect/accounts";
export {
  capabilitiesFor,
  classify,
  listCapabilities,
  type CapabilityFacts,
  type RailReport,
  type RailState,
} from "./connect/capabilities";
export {
  CONNECT_RAILS,
  enabledMethods,
  sellerRails,
  type ConnectRail,
  type SellerRail,
  type SellerRailState,
} from "./connect/methods";
