# 31 — Integration Scenarios (Store → Automations)

**Priority:** P3 · **Effort:** L · **Depends on:** 30 (shares the runner and
the `automations` table) · **Blocks:** nothing

## What

A seller says "when someone buys X, do Y in another app" without writing a
webhook consumer. Reference: Easytools Store → Automations, three tabs —
**Scenarios**, **Executions**, **Apps** — documented in `llms-full.txt`
§`setting-up-automations`.

Sailo shipped the developer half of this in spec 16: signed Standard Webhooks,
a REST v1 surface, an MCP endpoint, `/docs/api`. What is missing is the half a
seller who is not a developer can use. Their own example is the whole product:
*"After purchase, assign the customer to a mailing list"*, *"3 days after
subscription expiration, remove the customer from the community"*.

## The reshape, and the refusal it keeps

Easytools ships an **app directory** — pick Mailchimp, paste an API key. This
tree has refused named connectors twice, in spec 16's notes and in
`17-booking-integrations.md`, both times for the same reason: each logo is an
OAuth client, a refresh token at rest and a support surface, per logo, forever.

That refusal stands, and it does not block this spec, because the thing sellers
actually lack is not Mailchimp — it is **a trigger they can pick and an action
they can configure, with a log they can read and retry.** So:

- **Actions are generic:** `http.request` (a signed POST to a URL they own, the
  spec-16 delivery path unchanged), `email.notify` (mail *themselves* —
  Easytools' "Notification integration", and the most-used action in practice),
  and `contact.tag` (write a tag on the buyer, which is how a seller segments
  without leaving Sailo).
- **Credentials are API keys, not OAuth.** An `integration_apps` row holds a
  label, a base URL and a secret. That reaches every tool with an API key and
  every tool behind Zapier, Make or n8n.
- **A named connector is a preset, not a client.** If Mailchimp is worth doing
  later it is a stored `{ baseUrl, headerName, path template }` shipped as data,
  with no OAuth and no refresh token. Design for that; do not build presets now.

## Data model (migration, production first)

`drizzle/NNNN_integration_scenarios.sql`. Reuses spec 30's `automations` with
`kind = 'scenario'`; reuses `automation_runs` and `automation_steps` as the
Executions log. Two new tables:

```
integration_apps  id, shop_id → shops(cascade), label, kind text
                  ('http'|'notify'), base_url text, secret_ciphertext text,
                  header_name text, last_checked_at, last_check_ok boolean,
                  created_at, updated_at
                  unique (shop_id, label)

-- scenario triggers that are not already spec-30 triggers
-- (subscription lifecycle, which email flows have no use for)
```

`secret_ciphertext` is encrypted at rest with the existing key derivation, and
is **never** returned by any query that feeds a page — the settings card shows
a last-four and a "replace" action, the pattern `api_keys` already uses.

## Triggers

Spec 30's four, plus the subscription lifecycle, which is where their examples
live and which Sailo already emits for webhooks:

`product.purchased` · `order.paid` · `order.refunded` ·
`subscription.started` · `subscription.renewed` · `subscription.past_due` ·
`subscription.expired` · `waitlist.signup` · `member.checked_in`

Every one of these must have **a real emit point before it appears in the
picker.** Spec 16's note is the rule: *"a catalogue longer than its emit points
is a checkbox a seller ticks and then waits on for ever."* Where an emit point
does not exist yet, the trigger does not ship.

Timing modifier, because their second example needs it: a scenario may run
`immediately` or `N days after` the trigger. "After" is a `timer` node — the
same node spec 30 built. That is the whole reason to share the runner.

## Behaviour

- **Scenarios tab** — list, status, last run, per-product filter. New scenario
  is a three-field form (trigger, product/variant scope, action), not a canvas:
  a two-node graph does not need a graph editor.
- **Executions tab** — `automation_runs` filtered to `kind = 'scenario'`, with
  request/response summary, error text, and **Retry** and **Cancel**. Theirs
  has both and they are the reason the tab exists. Retry re-arms `wake_at` and
  resets `attempt` through the same claim; it never re-executes inline.
- **Apps tab** — list, add, **Check connection** before save (theirs does this
  and it prevents the commonest support ticket), delete.

## Details that must not be missed

- **`http.request` reuses `packages/webhooks/src/post.ts` exactly** — `node:https` with
  the `lookup` hook, so the address approved is the address connected to. Do
  **not** call `fetch` here. The resolve-then-fetch shape is the SSRF hole spec
  16 documents at length, and "Check connection" is precisely the button that
  turns a naive implementation into a port scanner with our IP on it. 443 only,
  no redirects, capped and discarded body.
- **The response body is never shown in full.** A truncated status line and
  content-type only. An arbitrary third-party response rendered into the panel
  is stored XSS with extra steps.
- **`email.notify` sends to the shop's own `notificationEmail`** and nowhere
  else. An action that mails an arbitrary address is an open relay wearing a
  scenario's clothes.
- **`contact.tag` writes to `clients.tags`** (GIN-indexed, spec 23) and must
  not create a client — a trigger whose subject has no client row is a scenario
  with nothing to tag, and it fails visibly.
- **Executions are pruned** on the `webhooks/prune.ts` schedule and policy.
  A log nobody prunes becomes the largest table in the database.
- **Plan gate:** the existing `integrations` flag (Business), not a new one.
  One credential opens webhooks, the API, MCP and scenarios; revoking revokes
  everything, which is what a seller expects.
- **Idempotency is the consumer's**, as spec 16 already tells them: dedupe on
  `webhook-id`. Retry is at-least-once here too and the Retry button says so.

## Testing

Unit: scenario graph compiles to a two- or three-node graph 30's runner
accepts; action config validation refuses a non-https URL, a port that is not
443, and a private address literal in every notation `packages/core/src/net/ip.ts`
unwraps (IPv4-mapped, NAT64, 6to4).

Scenario: purchase → scenario fires → execution row with a status; a failing
endpoint retries on the policy and stops; twenty consecutive failures disable
the app and mail the seller (spec 16's rule, reused); Retry re-arms exactly
once under two concurrent ticks; a scenario on a deleted product stops cleanly;
`email.notify` cannot be redirected by config.

## Done when

A seller connects an app by API key, checks the connection, builds
"purchase → POST to my URL" and "subscription expired + 3 days → remove",
watches both in Executions, retries a failure, and no action can be pointed at
anything the SSRF guard would refuse.
