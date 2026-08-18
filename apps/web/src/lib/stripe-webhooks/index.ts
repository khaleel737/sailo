/**
 * Everything both Stripe webhook routes need.
 *
 * There are two endpoints because Stripe has two delivery channels and will not
 * mix them: events about Sailo's own account (a seller paying us) go to a plain
 * endpoint, and events from connected accounts (a buyer paying a seller) go to
 * one registered for Connect. They sign with different secrets, which is why
 * they cannot share a route — but everything after the signature is the same
 * code, and it lives here rather than in two copies that drift.
 *
 * Split by the question each part answers, not by size:
 *
 * - `verify`      — is this really from Stripe, and do we act on it?
 * - `idempotency` — Stripe delivers at least once; this handles it once.
 * - `ownership`   — which row may this event touch, and did the account that
 *                   sent it have the right to? The security seam.
 * - `platform`    — Sailo's own account: subscriptions and billing.
 * - `connect`     — a buyer paying a seller: sessions, charges, refunds.
 * - `disputes`    — chargebacks, on either account. Its own module because a
 *                   dispute is the one object that exists on both, and because
 *                   an inquiry and a chargeback are not the same event.
 *
 * The first three now live in `@sailo/payments`, because apps/api needs them
 * too and they answer questions about the event alone — no stock, no email, no
 * ledger. The last two stay here: they fan out into the rest of apps/web, and
 * moving them would mean copying that fan-out into the package or inverting it
 * behind an interface, which is a refactor of the money path rather than a
 * relocation of it.
 *
 * The package's seam is re-exported here only where something actually reaches
 * it through this barrel — which is now just the scenario suites, for the two
 * idempotency calls they make around a handler. Everything else imports
 * `@sailo/payments` directly: the routes take `verifyEvent`, `signingSecrets`
 * and `HANDLED` because those answer the signature question before any of this
 * module's orchestration is in scope, and `connect.ts` takes `intentIdOf` and
 * the scoped lookups because it is the caller. A second name for one thing is
 * the name that goes stale.
 */

export { claimEvent, releaseEvent } from "@sailo/payments";
export { handleAccountEvent } from "./platform";
export { handleConnectEvent } from "./connect";
export { handleDisputeEvent, handleEarlyFraudWarning } from "./disputes";
