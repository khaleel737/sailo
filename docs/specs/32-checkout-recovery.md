# 32 — Checkout Recovery and Checkout Sessions

**Priority:** P1 · **Effort:** L · **Depends on:** nothing (better with 30)
· **Blocks:** nothing

## What

A row for every checkout a buyer opens, a status machine over it, and one
email with a resume link when they leave without paying. Reference: Easytools
Store → Recovery (Checkout sessions / Recovery settings / Surveys), documented
in `llms-full.txt` §`enabling-recovery`.

Sailo's only abandonment handling today is a 24-hour sweep that cancels unpaid
orders and reclaims stock and slots (`booking_claims`, and the `membership`
exemption). That protects *inventory*. It does nothing for *revenue*: nobody
is ever asked to come back.

## What we take, and what we refuse

Their feature is a **staffed service on a 10% commission** — consultants phone
the buyer, they run remarketing "at our expense", and, decisively: *"our
customers have their data … remembered in the system. This means that we also
have data of people from our entire network in your cart."*

Sailo refuses all three, and the reasons are structural, not squeamish:
the seller is merchant of record and Sailo never touches the money, so there is
no commission to take at settlement; there is no cross-seller buyer network and
building one would put one seller's buyers inside another seller's checkout
(`GAP-2026-08-easytools.md` §4.2).

What we take is the machinery, which is excellent and unencumbered: the session
row, their status vocabulary, the T+3h threshold, and — the genuinely clever
part — **the randomised discount.** Their reasoning, worth preserving in the
code comment: award a recovery discount every time and buyers learn to abandon
on purpose.

## Data model (migration, production first)

`drizzle/NNNN_checkout_sessions.sql`.

```
checkout_sessions  id, shop_id → shops(cascade),
                   product_id → products(set null),
                   order_id → orders(set null),
                   client_id → clients(set null),
                   email text, phone text,
                   status text not null default 'opened',
                     -- opened | error | recovering | recovered | finalized
                     -- | help_requested | expired
                   visitor_key text not null,   -- see below
                   currency text, subtotal_cents integer,
                   last_error text,
                   discount_code text,          -- minted, single-use
                   recovery_sent_at, recovered_at,
                   opened_at default now(), last_seen_at, expires_at
                   unique (shop_id, visitor_key, product_id)
                     WHERE status IN ('opened','error','help_requested')
                   idx (shop_id, status, opened_at)
                   idx (status, opened_at) WHERE status = 'opened'
```

`shops` gains `recoveryEnabled boolean default false`,
`recoveryDiscountBp integer` (nullable), `recoveryDiscountCents integer`
(nullable — flat *or* percentage, theirs supports both, exactly one may be set).
`products` gains `recoveryEnabled boolean` **nullable**, meaning "inherit the
shop": blank ≠ false, the rule this tree already enforces elsewhere.

### `visitor_key`, and why not a cookie alone

Theirs: *"If a customer revisits the same checkout from the same device and
browser, a new session is not created. We remember their entry for 30 days."*
Same behaviour, same 30 days (`expires_at`). The key is a first-party,
`httpOnly`, `SameSite=Lax` opaque id — **not** derived from IP or user agent,
because a phone changing network mid-checkout would read as two buyers, the
same reasoning the download rate limit already documents. It is not a
cross-shop identifier: keyed per shop by the unique index, and no query joins
sessions across shops.

## Behaviour

**Creating.** A row on first checkout view, under a rate limit keyed on the
visitor key. `last_seen_at` on subsequent views. This is the one new *public
write* in the spec, so it needs the same care as `/api/upload`: a ceiling, and
no response that is an existence oracle.

**Statuses**, theirs, and the transitions are the spec:

| Status | Entered when |
|---|---|
| `opened` | checkout viewed |
| `error` | a payment attempt failed. Returns to `opened` if they come back |
| `finalized` | paid without a recovery link |
| `recovering` | the recovery email was sent |
| `recovered` | paid **from the recovery link** |
| `help_requested` | buyer left a phone number after an error |
| `expired` | 30 days, by cron |

**The recovery pass** (cron, alongside the existing sweep). Eligible: `opened`
or `error`, `opened_at < now() - 3h`, no order paid, `recovery_sent_at` null,
recovery enabled for the shop-or-product, and **an address we are allowed to
mail.** Sends one email — one, never a series, and their communication
standard is worth adopting verbatim: *"It is one-time (we don't remind 10x)"* —
containing a signed resume link and, randomly, the discount.

**`recovered` requires the link.** Only a payment whose session was
`recovering` *and* whose checkout was entered through the signed resume token
counts. A buyer who returns from the seller's own newsletter is `finalized`.
Theirs draws exactly this line and it is the difference between a metric and a
flattering number.

**The discount.** Minted per session as a real single-use coupon through the
existing `coupons` path, scoped to that product, expiring with the session.
Awarded on a coin flip (configurable, default 50%) so it cannot be farmed.

**Reporting** — their four tiles: recovered funds, recovery actions, rate,
plus a session table filtered by status. `commission` is **not** a column.

**Surveys** — theirs has a cancellation survey and recovery surveys.
Out of scope here; see "Not in v1".

## Consent — the part to get right

The mail is triggered by an abandoned purchase and carries no offer other than
finishing it, so it is transactional in substance. That is **not** a licence to
mail anyone: send only where the address was typed into *this* checkout, or the
buyer is an existing client of *this* shop. Never from a marketing list, never
from another shop, and never past an `email_suppressions` row of any kind
(a `bounced` or `complained` suppression is absolute — the broadcast rule).

The checkout gains one line of notice where the address is entered, and the
mail carries a one-click opt-out that writes a shop-scoped suppression.

## Details that must not be missed

- **Never store a card detail, a Stripe client secret, or a full PAN.** The
  session records that an attempt failed and its message, nothing about the
  instrument.
- **`last_error` is Stripe's `decline_code`/message, sanitised through an
  allowlist** before it is stored, and it is shown to the seller only. A raw
  provider string rendered into the panel is untrusted input.
- **The resume link is a signed token under its own domain string**, expiring
  with the session, and it re-prices everything on arrival. It restores the
  *basket*, never a price: the server-side re-pricing invariant is untouched.
- **Interaction with the sweep is deliberate.** The sweep still cancels unpaid
  orders at 24h and reclaims stock and slots; this runs at 3h and does not
  extend any hold. A recovered buyer arriving at hour 20 may find the last unit
  gone, and the checkout says so honestly — holding stock for a maybe is worse.
- **`membership` products are exempt** from the recovery mail exactly as they
  are from the sweep: a trialling member's signup order is not abandoned.
- Free/zero-price and `lead` checkouts create no session — nothing to recover.
- **Plan gate:** `recovery` on Pro+. Sessions are recorded on every plan, so a
  seller who upgrades has history to show; only the send and the discount gate.
- 35-locale strings: the recovery email, the checkout notice, the settings
  card, the seven status labels.

## Not in v1

Cancellation and recovery **surveys**, subscription dunning beyond what Stripe
already retries, phone contact of any kind, remarketing audiences, and any
commission mechanism. The first two are worth a spec of their own once there
is recovery data to aim them with.

## Testing

Unit: eligibility predicate across all seven statuses and both enable
inheritances (`null` product = inherit, `false` = off, `true` = on with the
shop off); the randomiser is seeded and provably not 100%; status transition
table refuses `recovered` without a `recovering` predecessor.

Scenario: open checkout → row; revisit → no second row; fail payment → `error`;
return → `opened`; 3h pass → one mail, `recovering`; pay from the link →
`recovered` with the discount applied and the coupon burned; pay from a plain
link → `finalized`; a suppressed address is never mailed; two cron ticks send
**once**; the 24h sweep still cancels and still reclaims; a membership signup
is never mailed; the resume token cannot re-price.

## Done when

Every checkout view is a row with an honest status, one recovery mail goes at
T+3h to addresses we may mail, a link-attributed payment reads `recovered` and
nothing else does, the seller sees recovered funds and rate, and no commission
or shared buyer data exists anywhere in the implementation.
