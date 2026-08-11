# 27 — Lifecycle Email

**Priority:** P1 · **Effort:** M · **Depends on:** 14 (email infrastructure)

## What

Sailo's own onboarding and activation email to its **sellers** — as opposed to
`14-email-broadcasts.md`, which is a seller mailing their **buyers**. Sent
from `marketing@sailo.store`, one rung at a time, based on where the account
actually is: signed up with no shop, shop with no product, products with no
way to be paid, ready but no orders, first sale, upgrade.

## Design: derived state, claimed sends

Two tables, and neither stores a funnel stage.

| Table | What it holds |
|---|---|
| `lifecycle_emails` | one row per (user, step) — the *claim*, plus Resend's id |
| `marketing_opt_outs` | addresses Sailo may never market to again, platform-wide |

Which rung a seller is due is **derived** at send time from shops, products,
`payment_methods` and orders — the same way the setup checklist derives its
ticks, and for the same reason: a stored stage is a second answer to a
question the data already answers, and the two drift the first time a product
is deleted or a rail switched off. Deriving also means the pipeline was
correct for every seller who signed up before it existed. No backfill.

Sending is claim-then-send: the INSERT's unique index on `(user_id, step)`
picks one winner, so two ticks, a retry or a hand-run send one email between
them. A failed send keeps its claim — the same trade `event-reminders.ts`
makes, because "retried" and "sent twice" are indistinguishable when the
failure was in the provider's reply.

## The ladder

Anchored on real timestamps, never "N days after the last email" — a drip
chained off its own previous send drifts the moment a step is skipped, and
every step here can be skipped.

| Step | Anchor + delay | Sent when |
|---|---|---|
| `no_shop_1/2/3` | signup + 2h / 2d / 9d | still no shop |
| `shop_live` | shop + 20m | always — this is the one that carries their link |
| `no_product_1/2` | shop + 2d / 8d | shop, no product |
| `no_rail` | first product + 1d | product, no enabled rail and no Stripe |
| `no_orders_1/2` | first product + 3d / 12d | can sell, no orders |
| `first_sale` | first order + 1d | ≥1 order |
| `upgrade` | first order + 14d | ≥3 orders, free plan by entitlement |
| `catch_up` | signup + 14d | never mailed, no orders — the backfill rung |

## Details that must not be missed

- **Every rung goes stale** except `catch_up`. Without expiry, the first tick
  after deploy tells a seller of six months' standing that their shop is live.
- **`catch_up` exists for exactly that fleet.** One email, once, that reads
  their current state and names the one thing in their way. Gated on
  `sent.size === 0`, so it can never interleave with the ladder.
- **Retirement tombstone.** An account past every rung gets a `retired` row so
  the hourly pass stops re-reading it forever and starving new signups. The
  exit is not permanent: building a shop brings them back.
- **Pacing.** 20 hours between any two lifecycle emails to one seller. Several
  rungs come due at once for someone who does everything in one sitting.
- **Verified address required — but only with no shop.** Completing a signup
  form is not evidence the person owns the address they typed; building a shop
  is evidence of a genuine account. Without this, a mistyped address gets three
  marketing emails from our verified sending domain.
- **The paid-rail step counts manual rails.** A cash-on-delivery seller is
  fully set up without Stripe. This is Sailo's differentiator; don't copy a
  Stripe-centric funnel blindly.
- **`upgrade` reads `planFor`, not `shops.plan`** — a comp and a lapsed
  subscription must each be read correctly.
- **RFC 8058 one-click, plus a visible footer link, plus the postal address.**
  The header is what Gmail requires on bulk mail; the postal address is
  CAN-SPAM's flat requirement and comes from `LEGAL`. Both parts of the
  message — HTML and plain text — carry the unsubscribe.
- **The unsubscribe copy names what does *not* stop.** Somebody who wants the
  tips to stop but has an order arriving needs to know before they click, or a
  good share of them press "report spam" instead.
- **Separate signing domain** from the broadcast token, so a token from one
  flow can never unsubscribe somebody from the other's list.
- **Bounces and complaints** arrive on the one Resend webhook; whichever of the
  two delivery tables owns the provider id decides whose list the address comes
  off. A seller bouncing our product mail must not mute their shop's newsletter.
- **Re-subscribing is asymmetric.** The Settings switch may lift an
  `unsubscribed` row; it may not lift `bounced` or `complained`.

## What was deliberately not built

- **No product tour or seeded demo data on signup.** Onboarding is already the
  first-run experience, the dashboard's setup checklist is the in-app guide,
  and seeding fake products means the seller's first job is deleting them. The
  emails link to the real demo shops on the marketing site instead.
- **No open/click tracking.** Nothing in the ladder branches on it, and it
  would mean pixels and rewritten links in mail sent to our own users.
- **No per-rung scheduling UI.** The ladder is code, reviewed like code.

## Testing

Unit on the ladder (each rung true/false from state literals, ordering,
staleness, retirement, backfill), on the token (round-trip, tamper, junk,
cross-flow confusion, multi-byte signature), and on rendering (every rung
carries the footer, the header, the postal address and a text part — looped
over `LIFECYCLE_STEP_IDS`, so a new rung without copy fails the suite).

## Done when

A fresh signup that stalls gets three emails and then silence; a seller who
builds a shop gets their link within the hour; a shop with products and no
rail is told nobody can pay them; a first sale is congratulated a day later; an
existing dormant fleet gets one honest catch-up email rather than a stale
ladder; and one click in any of them stops all of it while order, billing and
account email keeps arriving.
