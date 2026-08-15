/**
 * Stripe, once the money path moves out of apps/web.
 *
 * What lives here is the part of the webhook path that answers questions about
 * *the event itself* — is it really Stripe's, have we already handled it, and
 * which row is it allowed to touch. That set has no opinion about what Sailo
 * then does with it, which is why it can sit in a leaf package that two apps
 * import without either of them dragging the other's app code along.
 *
 * What deliberately did **not** move: `platform`, the webhook half of
 * `connect`, and `memberships`. Those are orchestrators — they take a verified
 * event and fan out into stock, downloads, invoices, buyer and seller email,
 * outbound seller webhooks and the partner ledger. Lifting them would mean
 * either copying half of apps/web in behind them or inverting those calls
 * behind an interface, and inverting them is a refactor of the money path.
 * They stay in apps/web and import this package's seam; see
 * `apps/web/src/lib/stripe-webhooks/index.ts`.
 *
 * `connect` is the one thing here that is not about a webhook, and it is here
 * for the same reason the others are not: two clients need it. A seller opens
 * their Stripe account from the admin *or* from the phone, and the only thing
 * that differs between those is where Stripe sends them afterwards.
 *
 * Split by the question each part answers, not by size:
 *
 * - `stripe`      — the client, lazily constructed.
 * - `connect`     — opening the seller's connected account, and the link that
 *                   finishes it.
 * - `verify`      — is this really from Stripe, and do we act on it?
 * - `idempotency` — Stripe delivers at least once; this handles it once.
 * - `ownership`   — which row may this event touch, and did the account that
 *                   sent it have the right to? The security seam.
 */

export { billingEnabled, stripe } from "./stripe";
export {
  accountFields,
  actingAs,
  billingPortalSession,
  cancelSubscriptionAtPeriodEnd,
  connectOnboardingLink,
  publicShopUrl,
  refundCharge,
  type OnboardingRedirects,
} from "./connect";
export { HANDLED, signingSecrets, verifyEvent } from "./stripe-webhooks/verify";
export { claimEvent, releaseEvent } from "./stripe-webhooks/idempotency";
export {
  intentIdOf,
  orderForIntent,
  orderForSession,
  ownedBySender,
  sameAccount,
  sendingAccount,
  shopIdFor,
} from "./stripe-webhooks/ownership";
