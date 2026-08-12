# 16 — Outbound Webhooks (Zapier-style)

> **Built (`drizzle/0020_integrations.sql`), and widened.** This shipped
> together with a REST API and an MCP endpoint, because a webhook that fires
> and cannot look anything up is half an integration. Read the *integrations
> block, as built* section of `README.md` for what departed from this document
> and why — chiefly: signing is
> [Standard Webhooks](https://www.standardwebhooks.com) rather than Stripe's
> scheme (better libraries, and Svix-compatible), the SSRF guard runs at
> *connect* time through a `node:https` `lookup` hook rather than as a
> pre-flight resolve, the claim is a lease rather than a `sending` status, and
> the retry ladder tops out at six attempts. `lead.created` is still absent —
> spec 07 has not landed.

**Priority:** P3 · **Effort:** M · **Depends on:** nothing (07 adds the
`lead.created` event)

## What

Sellers register HTTPS endpoints; Sailo POSTs signed JSON on business events.
This is the substrate for "connect your tools" (Zapier consumes plain
webhooks) without building a Zapier app first. Reference: Stan's Zapier
integration card.

## Data model (migrations, production first)

- `webhookEndpoints`: id, shopId, url, `secret` (generated, shown once),
  `events text[]`, isActive, `failureCount int default 0`, createdAt.
  Limit 5 per shop.
- `webhookDeliveries`: id, endpointId, event, payload jsonb, attempt,
  status (`pending | ok | failed | dead`), responseStatus, nextAttemptAt,
  createdAt. Prune rows older than 30 days in the sweep cron.

## Events (v1 catalogue)

`order.created`, `order.paid`, `order.cancelled`, `booking.confirmed`,
`refund.issued` (+ `lead.created` when spec 07 lands). Payloads are stable,
versioned (`{ v: 1, event, data }`), and contain ids + snapshots the shop
already owns — never another shop's data, and no full card/PII beyond what
the CSV export already exposes.

## Delivery

- Emit points call a single `emitWebhook(shopId, event, data)` that inserts
  `pending` deliveries — **inside `after()`** or post-commit, never before
  the business write commits (an emitted event for a rolled-back order is a
  lie).
- A cron route drains pending deliveries: claim each row with a conditional
  UPDATE (the repo's atomic-claim shape), POST with 5s timeout, HMAC-SHA256
  signature header (`sailo-signature: t=<ts>,v1=<hex>` over
  `<ts>.<body>` — mirror Stripe's scheme so consumers can reuse verifiers),
  plus `sailo-event` and a delivery id for consumer-side idempotency.
- Retries: exponential backoff (1m, 5m, 30m, 2h, 12h), then `dead`. 20
  consecutive failures across deliveries → endpoint `isActive = false` and a
  seller email (spec 04 transport) saying so.

## SSRF — the security seam

The URL is attacker-controlled by definition. Reuse the repo's existing SSRF
guard (the "Stop a seller pointing a product file at our own network" work —
find it where product file URLs are validated) and apply it **at request
time, not just at save time**: resolve DNS and refuse private/loopback/
link-local ranges and cloud metadata IPs on every attempt, because DNS
rebinding beats save-time checks. HTTPS only, no redirects followed
(`redirect: "manual"`), response bodies read to max 4KB and discarded.

## Details that must not be missed

- The secret is shown once at creation; store only its hash? No — HMAC needs
  the plaintext; store it, but never render it again in the UI (regen
  action instead). Endpoint list shows last delivery status + a "send test
  event" button.
- Plan-gate: `webhooks` flag, business plan.
- Rate: a burst of orders must not stampede one endpoint — serialise per
  endpoint in the drain query (take the oldest pending per endpoint per
  tick).
- 35-locale admin strings.

## Testing

Scenario: order → delivery row post-commit only (rollback path emits
nothing); signature verifies with the documented recipe; retry ladder
advances on failure; private-IP URL refused at save AND at send;
auto-disable at the threshold emails the seller. Unit: HMAC vector tests.

## Done when

Signed, replay-identifiable, retry-safe deliveries to seller endpoints with
request-time SSRF defence and auto-disable — and a test event button that
works from the settings UI.
