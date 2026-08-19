# 44 — Dispute evidence capture: the data we are not keeping

**Priority:** P0 · **Effort:** M · **Depends on:** nothing ·
**Blocks:** 45 (the evidence pack), 46 (platform disputes)

## What

Five things a dispute is answered with that Sailo does not record. Each is a
column or a small table. None of them can be added retroactively, which is why
this ships alone and first.

## The argument for shipping this before anything else

`packages/core/src/disputes/ce3.ts` already makes it, about a different column:

> *"It is retroactive in the worst way. The two prior transactions must
> *already* carry the data points, so a platform that starts capturing IP
> addresses today cannot use CE3.0 for another four months. That is the argument
> for `orders.buyerIp` being a one-line change made now rather than a feature
> scheduled later."*

That reasoning is correct and it applies with full force to every item below.
A dispute can arrive 120 days after the sale. **Evidence not captured at the
time cannot be printed later** — spec 45's PDF can only render facts something
wrote down. Every week this waits is a week of orders that will be undefendable.

Ship this on its own, before 45 and 46, and before spec 30's release.

## What already exists — do not rebuild any of it

The dispute pipeline is substantially built and good. Confirmed in source:

- `disputes` with `scope` (`connected` | `platform`), `feeCents`,
  `deductedCents`, `networkReasonCode`, `dueBy`, `evidenceSnapshot`,
  `completenessBp`, `enhancedEligibility`, `ce3Status`, and three separate
  seller-notification claims;
- `early_fraud_warnings` — the only advance notice of a chargeback there is;
- `download_events` — Stripe's `access_activity_log`, with IP and user agent;
- `dispute_evidence_files` — one row per Stripe evidence slot, with the
  4.5 MB combined budget enforced from the *set* (`EVIDENCE_FILE_BUDGET_BYTES`);
- `packages/core/src/disputes/` — `assemble.ts`, `ce3.ts`, `escalation.ts`,
  `files.ts`, `lifecycle.ts`, `rate.ts`, `reasons.ts`, all pure and tested;
- `orders.termsAcceptedAt`, `buyerIp`, `buyerUserAgent`,
  `buyerDeviceFingerprint` — the CE3 match points, already captured;
- `docs/chargebacks.md`, verified against the live API on 2026-08-17.

The five gaps below are gaps in **capture**, not in the pipeline.

## Data model (migration, production first)

`drizzle/NNNN_evidence_capture.sql`.

### 1. Statement descriptor — the cause of `unrecognized`

`statement_descriptor` matches **0 files** in this tree. Nothing sets it,
records it, or shows it.

`unrecognized` (Visa 10.4 / MC 4837) is a cardholder who did not recognise the
line on their statement, and `docs/chargebacks.md` already says the answer is
*"usually a statement-descriptor problem."* Sailo cannot make that argument
because it does not know what the buyer saw. Whatever the seller's connected
account defaults to is what appears, and for a link-in-bio shop that is often a
legal entity name the buyer has never heard.

```
shops
  statement_descriptor        text        -- ≤22 chars, what the buyer sees
  statement_descriptor_suffix text        -- ≤22, per-transaction suffix
orders
  statement_descriptor        text        -- snapshot of what was sent
```

- Set on the PaymentIntent / Checkout Session at creation, on the seller's
  connected account, and **snapshot onto the order** — a seller who changes it
  next month must not change what a five-month-old dispute claims the buyer saw.
- Validate to the card-network rules server-side (length, no `< > \ " '`, at
  least one letter). An invalid descriptor is silently ignored by Stripe, which
  is the worst outcome: it looks configured and is not.
- Default it from `shops.name` on first save so an unconfigured shop is still
  better than the account default.
- Show the buyer a preview at checkout — *"this will appear on your statement
  as …"*. That single line prevents disputes rather than answering them, which
  is worth more.
- It feeds the `receipt` and the pack (spec 45) and it is what makes an
  `unrecognized` rebuttal say anything.

### 2. Terms and policy snapshot — what the buyer actually agreed to

`orders.termsAcceptedAt` records **when**. Nothing records **what**.
`termsVersion` / `termsSnapshot` match 0 files.

`refund_policy_disclosure`, `cancellation_policy_disclosure` and the
`refund_policy` / `cancellation_policy` file slots are all "the policy as the
buyer saw it". `shops.termsUrl` is a URL whose contents the seller can change,
and a URL that changed is not evidence — an issuer following it today sees
today's policy.

```
policy_snapshots  id, shop_id → shops(cascade),   -- NULL = Sailo's own, see below
                  kind text,            -- terms | privacy | refunds | cancellation
                  content_hash text not null,
                  body text not null,   -- the text as presented
                  source text,           -- shop_page | url_fetch | manual | platform
                  source_url text,
                  captured_at timestamp default now()
                  unique (shop_id, kind, content_hash)          -- shops
                  unique (kind, content_hash) WHERE shop_id IS NULL   -- Sailo's
                  idx (shop_id, kind, captured_at)

orders
  terms_snapshot_id    uuid → policy_snapshots(set null)
  refund_snapshot_id   uuid → policy_snapshots(set null)
```

- **Content-addressed, so it costs almost nothing.** A shop with a stable policy
  has one row per kind for its whole life; every order points at it. Only an
  edit writes a second row. That is what makes snapshotting per order affordable.
- **Where the text comes from.** Spec 41 hosts policies in `shop_pages`, and
  that is the good path: snapshot the `body_md` directly. For a seller using
  `termsUrl`, fetch it **through the existing SSRF guard**
  (`packages/webhooks/src/post.ts`'s `lookup` hook — not `fetch`), cap the body,
  strip to text, and re-snapshot on a schedule rather than per order. A failed
  fetch stores nothing and the order carries a null, which the readiness panel
  already knows how to report as `missing`.
- `set null` on both: a snapshot is never deleted, but if one ever is, the order
  survives and the panel says the policy is missing rather than the page failing.
- **`shop_id` is nullable and NULL means Sailo's own terms**, snapshotted on
  deploy from `(legal)/terms`, `privacy` and `refunds`. Spec 46 needs it: a
  seller charging back their subscription is answered partly with the Sailo terms
  they accepted at signup, and a link to a page that has since changed is no
  better as our evidence than it is as a seller's. Postgres treats NULLs as
  distinct in a unique index, so the platform rows need the partial index above
  or the same text would be stored on every deploy.

### 3. Per-order communications log — the `customer_communication` slot

`FILE_ASKS.customer_communication` currently asks the seller to *"upload the
messages"*. Sailo sends most of them and logs none of them per order:
confirmation, invoice, shipping notice, refund notice, download release, event
reminders, membership renewal notices. `confirmationSentAt` is a single
timestamp; `broadcast_deliveries` is marketing, not transactional.

```
order_messages  id, order_id → orders(cascade),
                shop_id → shops(cascade),
                kind text not null,      -- confirmation | invoice | shipped
                                         -- | refund | download | reminder
                                         -- | renewal | seller_note
                direction text not null default 'outbound',
                                         -- outbound | inbound
                to_address text, subject text,
                body_text text,          -- the rendered text part, as sent
                provider_message_id text,
                status text,             -- sent | delivered | bounced | complained
                sent_at timestamp default now()
                idx (order_id, sent_at)
```

- **Write it where the send succeeds**, beside the existing
  `confirmationSentAt` claim in `packages/workflows/src/orders/confirm-buyer.ts`
  — that file already documents writing only on real success, and this row
  follows the same rule. A logged message that was never sent is worse than no
  log: it is a false claim to an issuer.
- **`body_text`, as sent.** Not a template id. The template changes; the
  evidence must not. This is the same reasoning `disputes.evidenceSnapshot`
  already gives for snapshotting rather than referencing.
- `status` is updated from the existing signature-verified Resend webhook, which
  already handles bounces and complaints for broadcasts. A `bounced`
  confirmation is *itself* evidence — it explains why a buyer says they never
  heard anything, and it is an honest thing to disclose rather than hide.
- **`direction: 'inbound'` and `seller_note` are for the seller** to paste in a
  WhatsApp exchange or record a phone call. Sailo's whole ordering model is
  chat-first; most buyer communication happens somewhere Sailo cannot see, and
  a box to record it is the difference between an empty slot and a filled one.
- **Retention.** A dispute can arrive 120 days out and a compliance case later.
  Keep 400 days, and keep it **out of the analytics retention sweep** — the
  `download_events` header already states this distinction and it applies again.
- Account deletion (spec 03) retains the ledger; these rows are part of it.

### 4. Delivery confirmation — `shipped` is not `delivered`

`ORDER_STATUSES` is `new | confirmed | shipped | completed | cancelled |
refunded`. There is no `delivered`, and `deliveredAt` on orders matches 0 files
(the five hits are webhook deliveries, unrelated).

`docs/chargebacks.md` states the rule itself: for `product_not_received`
(Visa 13.1 / MC 4855), *"a tracking number showing 'in transit' is not
delivery."* Sailo records `trackingCarrier`, `trackingNumber`, `trackingUrl`
and `shippedAt` — and then has nothing to say about arrival.

```
orders
  delivered_at        timestamp
  delivered_source    text      -- seller | buyer_confirmed | carrier
  delivery_signed_by  text      -- name from a POD, when there is one
```

- **No status change.** Do *not* add `delivered` to `ORDER_STATUSES`: three
  surfaces render status and the enum's own header records what happened last
  time a copy drifted. `deliveredAt` is a fact, and `completed` stays the
  seller's own workflow mark.
- `seller` is the honest default — the seller ticks "delivered". That is weaker
  evidence than a carrier's POD and stronger than silence, and the pack must
  label which it is rather than implying a carrier said so.
- `buyer_confirmed` comes free: the order-status link the buyer already receives
  gains a "yes, this arrived" button. A buyer's own confirmation, timestamped
  with their IP, is the single strongest piece of not-received evidence there is,
  and it costs one route.
- `carrier` is reserved for a real integration and ships empty. Do not build a
  carrier API client here.
- **Prompt for it.** A shipped physical order with no `deliveredAt` after the
  carrier's typical window is a nudge on the orders list, not a silent hole.

### 5. Durable sign-in events — for platform disputes only

`session` (better-auth) carries `ipAddress`, `userAgent`, `city`, `country` and
`createdAt`, which is exactly the evidence a subscription chargeback wants. But
sessions **expire and are removed**, so a dispute arriving 120 days after a
seller's last login has nothing left to read. Spec 46 cannot be built on a table
that empties itself.

```
account_events  id, user_id text not null, shop_id → shops(set null),
                kind text not null,   -- signin | signup | plan_change
                                      -- | subscription_paid | terms_accepted
                ip text, user_agent text, city text, country text,
                detail jsonb,
                at timestamp default now()
                idx (user_id, at)
                idx (shop_id, kind, at)
```

- Written from the same better-auth session hook that already resolves geo from
  Vercel's headers — one more insert, no new lookup.
- **Not an analytics table.** Kept 400 days for the same reason
  `download_events` is: it answers a bank.
- `terms_accepted` is the seller accepting *Sailo's* terms at signup, which is
  the thing spec 46 leads with and which nothing currently records durably.
- **Rate-limit-adjacent, not rate-limiting.** This is a record, never a gate.
  `client-ip.ts` already says why: an IP is not identity.

## Details that must not be missed

- **Every one of these five is a write on a path Stripe or a buyer is waiting
  on.** None may throw into the caller. The `confirmationSentAt` handler already
  documents this failure mode; follow it — log and continue.
- **`buyerIp` and `buyerUserAgent` are already captured; confirm they are
  captured on *every* rail.** The card rail goes through Checkout; manual and
  chat rails go through a server action. A CE3 match needs the prior
  transactions to carry the points, so a rail that skips them silently
  disqualifies future fraud defences. Grep all order-creating paths and assert
  it in a scenario per rail.
- **Nothing here is shown to a buyer** except the statement-descriptor preview
  and the "did it arrive" button. `buyerDeviceFingerprint` in particular is
  evidence, not a feature, and must never appear on a public page.
- **Privacy.** Document all five in the privacy policy, with the retention
  period and the lawful basis (a legal claim). `(legal)/privacy` is prose and
  is edited by hand; this is a real change to what is collected.
- Plan gate: **none.** A free-plan seller taking card payments can be charged
  back, and gating their defence would be indefensible.
- 35-locale strings: the descriptor preview, the "did it arrive" page, the
  seller's delivered tick, the note box, the nudge.

## Testing

Unit: descriptor validation over length, forbidden characters, all-digits, and
empty; policy content hashing (same text → one row, one whitespace change → two);
message-log redaction of anything that looks like a token in `body_text`.

Scenario: an order on **each** rail (card, manual, chat) carries `buyerIp`,
`buyerUserAgent`, `buyerDeviceFingerprint` and a descriptor snapshot; a policy
edit produces a second snapshot and old orders still point at the first; a
confirmation send writes exactly one `order_messages` row and a failed send
writes none; a bounce webhook updates that row's status; the buyer's
confirmation button sets `delivered_at` with `buyer_confirmed` once and is
idempotent; a sign-in writes one `account_events` row that survives the session
being deleted.

## Done when

Every new order records what the buyer saw on their statement, which policy text
they agreed to, every message sent to them, whether it arrived, and — for the
seller's own account — a sign-in history that outlives their session. And
`assembleEvidence` reports fewer `needs_seller` fields than it did the day
before, which is the number that says this worked.
