# 14 — Email Broadcasts & Flows

**Priority:** P2–P3 · **Effort:** L · **Depends on:** 05 (consent — hard
prerequisite), 07 (audiences worth mailing)

## What

Marketing email from sellers to their contacts: one-off broadcasts first
("Email Flows" automation second). Reference: Stan's "Email Flows — I want to
send automatic emails!" toggle and its email-marketing training.

## Non-negotiable legal floor (build this before any send button)

- Recipients: **only** clients with `marketingConsentAt IS NOT NULL`
  (spec 05/07). Purchase alone is not consent for this — Sailo is the
  platform, not the store, so the safe-harbour a merchant might claim doesn't
  cleanly transfer. Consent-only keeps every jurisdiction simple.
- Every message carries a working one-click unsubscribe link (tokenised,
  no login), a `List-Unsubscribe` header, and the seller's identification.
- New `emailSuppressions` table: shopId, email, reason
  (`unsubscribed | bounced | complained`), createdAt — checked at send time,
  written by the unsubscribe route and by Resend webhooks for bounces and
  complaints (add a Resend webhook route; verify its signing secret like the
  Stripe ones).

## Data model (migrations, production first)

- `broadcasts`: id, shopId, subject, bodyMarkdown, status
  (`draft | sending | sent`), audienceFilter jsonb (v1: `all` or tag —
  spec 23), scheduledAt nullable, sentAt, recipientCount.
- `broadcastDeliveries`: broadcastId, clientId, status
  (`queued | sent | failed | suppressed`), providerId — the audit trail and
  the resume point.

## Sending

- Compose: subject + markdown body rendered through the existing email markup
  helpers (`src/lib/email/markup.ts`) so broadcasts inherit the transactional
  template's rendering and dark-mode behaviour. v1 has no drag-drop builder.
- Send path: a cron-driven queue (`/api/cron/` pattern), batching ~100 per
  tick through Resend's batch API, marking deliveries as it goes — a crash
  resumes from `queued` rows instead of double-sending (claim each row with
  a conditional UPDATE, the repo's standard atomic-claim shape).
- Per-shop quota: e.g. 2,000 recipients/day on `business`, lower on `pro`,
  none on free (plan flag `broadcasts`). Platform-level daily ceiling too —
  one seller must not exhaust the shared Resend account (log when clamped;
  no silent caps).
- Test-send-to-self button before enabling the real send.

## Flows (phase 2 — separate PR, same tables)

Trigger (`lead captured`, `first purchase`) → delay (days) → send template.
One linear sequence per trigger in v1; `flowState` per client with a cron
tick advancing due steps. No branching, no A/B — write that in the UI so
nobody waits for it.

## Details that must not be missed

- Sender identity: `from` stays a sailo.store address with the shop name as
  display name and seller as reply-to (custom sender domains are a later
  feature; SPF/DKIM for arbitrary domains is its own project).
- Unsubscribe tokens: signed, per-client, no expiry, idempotent, and the
  landing page needs no auth and works from a cold email client. Suppression
  applies across all of a shop's future broadcasts.
- The unsubscribe route is public: rate-limit it, and make it a POST-on-click
  (some scanners prefetch GETs — a GET that unsubscribes is a footgun; use
  the one-click POST pattern from RFC 8058 plus a confirm page for GET).
- HTML + plaintext parts both generated.
- 35-locale admin strings; the *email body* is seller-authored and not
  localised by us, but chrome (unsubscribe line) follows the shop language.

## Testing

Scenario: broadcast to a mixed audience sends only to consented,
non-suppressed clients; unsubscribe suppresses future sends; crash mid-send
(kill between batches) resumes without duplicates; bounce webhook writes
suppression. Unit: token sign/verify, quota clamping.

## Done when

A seller can send a compliant broadcast to consented contacts with
resume-safe delivery, working unsubscribe, bounce suppression, and quotas —
and flows have a spec'd phase-2 skeleton.
