> **Superseded in part, 2026-08-19.** The owner restored the full feature
> set: *"add the features back, we will deal with what's needed later."*
> Everything below still stands as the **analysis** — it is why each spec
> was questioned and what the smaller version of it would have been — and
> the reduced shapes it describes are the ones to fall back to if the
> calendar bites.
>
> Three of its findings survived as decisions and are live:
> **preorders replace waitlists** (`33-preorders-and-back-in-stock.md`),
> **regional pricing** (EUR/GBP, for the EU and UK) and **the 90-day file
> sweep** join the release from `README.md`'s own gap list, and **spec 37 is
> rebuilt on Better Auth's organization plugin**.
>
> **Sailo's market is the US and the EU, and Stripe is the priority rail.** An
> earlier draft of this document argued from the chat rails reaching countries
> Stripe does not — that is a fact about the codebase, not the strategy, and it
> is not a reason to build anything.

# Reshaping the release around Sailo

`GAP-2026-08-easytools.md` was a parity exercise. It did the hard half well —
§4's refusals are correct and stand — but a parity exercise inherits the other
company's *problem list*, and Easytools sells to people selling courses,
coaching and ebooks.

It produced **22 specs**. This document cuts them to **12**, and says why for
each one that goes.

Written 2026-08-19, after Wave 0 and spec 44 landed.

---

## Two tests, applied in order

**1. Does this serve a seller in the US or the EU, taking card payments through
Stripe?**

That is the market and Stripe is the rail. The chat and manual rails exist and
matter — a shop can take a bank transfer or hand off to WhatsApp, and
`orders.paymentMethod` still defaults to `"whatsapp"` in the schema — but they
are a way of ordering, not the strategy. **A feature that only pays off outside
Stripe's reach is not the priority**, and one that improves the card path
usually is.

The relevant half of the positioning is the *catalogue*, not the geography:

> Every incumbent in this category optimises for *digital* products — courses,
> coaching, ebooks. None of them ship a real product catalogue: no categories,
> no filters, no search, no reviews. **Sailo sits in the empty middle.**

So: a physical seller with a real catalogue, taking cards, in the US and the EU.

**2. Is it a feature, or a subsystem?**

> One template, no checkout to configure. A seller is live in about three
> minutes.

That is the product. A release that adds a flow-builder, a permissions model, a
tax-threshold engine, a course platform and a Zapier is not a bigger version of
that product — it is a different one. **Anything that adds a screen a seller has
to learn before they can sell needs to earn it against the three minutes.**

The second test is the one that does most of the cutting below, and it is the
one the parity exercise had no way to apply.

---

## Ship — twelve

Each of these is something a seller notices, and none of them is a subsystem.

| | What the seller gets | Effort |
|---|---|---|
| **N1** | **Regional pricing.** Sell in the buyer's currency | M |
| **33** | **Preorders and back-in-stock** | M |
| **51a** | **Low-stock alerts, weight and dimensions** | S |
| **32a** | **Chat-handoff recovery** — nudge the order that was never sent | M |
| **30a** | **Order follow-ups** on every rail | M |
| **43a** | **Sell windows** — a drop opens Friday, closes Sunday | S |
| **36a** | **One post-payment cross-sell** (absorbs 08) | M |
| **41** | **Legal pages** | S |
| **47a** | **Shopify and CSV import** | M |
| **52+N4** | **Data requests, and the file sweep they depend on** | M |
| **45** | **Evidence pack** — the payout on 44, which is built | L |
| **42a** | **Analytics** — three pixels, four tiles, a link vocabulary | M |

Nothing here is XL. The whole release is smaller than spec 30 was on its own.

### The two that are new, and why they beat what they replaced

**N1 — Regional pricing.** The first line of `README.md`'s own *"Not built
yet"*. Scoped to the markets that matter: **EUR, GBP and the non-euro EU
currencies.** A British buyer shown `$29.00` is doing mental arithmetic at the
moment they were about to pay.

Half of it already exists on the rail that matters most — Stripe's Adaptive
Pricing is on in `card-checkout.ts`, and the Connect webhook records what the
buyer actually paid into `orders.presentmentCurrency`. The gap is that the
*storefront* shows one currency until the buyer reaches Stripe, and that the
manual rails have nothing at all.

**33 — Preorders and back-in-stock**, replacing waitlists. A waitlist is a
digital-launch instrument: availability is a date the creator picks. Sailo's
sellers ship things, and their version of that moment is **the last blue medium
selling on a Tuesday**. Written as `33-preorders-and-back-in-stock.md`; the
waitlist spec is in `deferred/`.

On the card rail a preorder is charged at checkout like any other order — the
ordinary commerce answer, and what every Shopify preorder does. What it buys is
a duty rather than machinery: **the expected date is shown before the buyer
commits and recorded on the order**, because a card payment for goods arriving
six weeks later is a chargeback waiting to happen if nobody said six weeks.
Spec 44 is already in the tree and is exactly what answers that dispute.

**N4 — The 90-day file sweep.** A deleted seller's product files are kept
deliberately, because buyers who paid still hold live tokens — and *"the cron
that finally clears them is a TODO in `api/cron/sweep`."* That is personal data
with no deletion path, and **spec 52 is about to promise a statutory one.** The
two collide; 52 cannot honestly ship without it.

### The four that shrank

**30a — order follow-ups, not an automation engine.** Spec 30 was P0 and XL: a
visual flow builder with a step graph, branches, and four triggers — **for
email**, on a platform whose orders happen in chat. A seller whose buyers all
came through WhatsApp has almost no addresses to send to.

Ship only the transactional sequences, on the contact details the order already
has: bank transfer not yet paid, COD arriving tomorrow, *did it arrive?* (spec
44 already built that link), review request, back-in-stock. These reach **every
rail**, need no audience model, and are what a physical seller actually asks for.

And the piece that is genuinely Sailo's: a follow-up whose action is **"open
WhatsApp with this message pre-filled"** — Sailo composes and schedules, the
seller presses send from their own number, in the thread the order already lives
in. No Business API, no approval, no per-message cost, works in every country.
That is the same handoff model the checkout already uses.

**The flow builder is cut, not deferred with a wink.** Re-open it when a seller
has a list large enough to need branching, which is a problem no Sailo seller
has today.

**32a — recover the handoff, not the session.** As written, 32 recovered an
abandoned *Stripe session*. On the chat rails there is no session: the order is
persisted and the buyer is handed off, and per the README *"the seller keeps the
lead even if the handoff never completes."* **That already-persisted order is
the recoverable thing and nobody is recovering it.** No new `checkout_sessions`
table — the orders are already there. Larger in volume than the card half for
most shops, and no competitor can build it, because no competitor persists an
order before the money.

**43a — sell windows only.** Two columns, `sell_from` and `sell_until`. Pay-what-
you-want and a donation preset are creator instruments — a tip jar under an
essay — and near-useless to somebody shipping mugs.

**42a — analytics, filtered to three parts of four.** Sailo already ships
analytics (specs 10 and 11), so the test here is redundancy. Three parts survive
and one does not:

- **Three more pixels** — Google Ads, LinkedIn, Pinterest, joining the GTM, Meta
  and TikTok that exist. Four columns and a validator each. Every one goes
  through spec 09's three gates or it does not ship: format validation (an
  unvalidated id is script injection in a `<script>` src), the consent gate, and
  a CSP entry added **only when that pixel is configured**.
- **Four tiles** — handoffs not completed, recovered orders, enquiries received,
  follow-ups sent. Retargeted onto the reshaped sources, because 32a no longer
  has a `checkout_sessions` table and 30a no longer has `automation_runs`.
  **No tile whose source has not shipped** — an always-zero tile reads as a
  broken product.
- **Checkout link vocabulary** — a small, closed, documented set:
  `?variant= ?coupon= ?qty= ?ref= ?name= ?email=`. No new tables, just parsing.
  `?coupon=` **prefills and never auto-applies** (auto-applying makes every
  coupon guess free and turns the storefront into a discount oracle), and there
  is **no `?price=`** — a price in a URL is a price from the browser, and "the
  server re-prices everything" is the invariant the checkout rests on.

**Cut from it: share links.** A public URL rendering a shop's revenue, needing
its own table, hashed tokens, required expiry, revocation, per-token rate
limits, its own CSP and a plan gate. The spec calls it "the most dangerous
feature in this spec" and it is a subsystem serving a rare case. A seller who
needs to show a partner their numbers can export a CSV, which already ships.

**51a — the physical half, promoted.** Low-stock alerts and weight/dimensions so
shipping can be priced. Small, and shipping that cannot be priced by weight is a
daily cost to every physical seller. The service half (staff calendars, classes,
reschedule) is a booking product and is cut below.

---

## Fold in — four, with no new subsystem

These stay, but as changes to things that exist rather than as new models.

**34 → phone-first contacts.** Not lists, segments and double opt-in — that is a
newsletter product. Sailo has `clients` already, with GIN-indexed tags from spec
23. Two changes: identity becomes `(shop, email OR phone)` so the WhatsApp
buyer is not excluded, and the checkout custom-field set ships. **No
`contact_lists`, no `contact_list_members`.**

**35 → a wall built on `reviews`.** Sailo already has reviews
(`packages/db/src/schema/catalog.ts:380`), and `README.md` names them as part of
what the incumbents lack. Three new tables for a second review system is
duplication. What is missing is the *display*: a wall, and an embeddable one.

**48 → the code pool only.** A voucher, an access code, a key for a small tool —
with the `FOR UPDATE SKIP LOCKED` claim, which is the part with real correctness
content. **Licence keys with activation limits and a public activation API is a
software-vendor feature** and Sailo's digital seller is selling a PDF.

**07 → a zero-priced product that asks questions.** A "lead magnet" is a free
ebook traded for an email; for a physical seller it is not a thing. The
mechanism underneath is generic and tiny — a sample request, a quote request, a
made-to-order enquiry.

---

## Cut from this release — nine

Not refused forever. Cut *from this release*, each with the reason.

**37 — team members and roles.** The riskiest change in the whole plan:
`requireShop()` gains a required argument and every call site in the app is
audited. That is a large, tree-wide, conflict-generating change **for a
permissions model that a solo seller live in three minutes will never open.**
Build it when a seller asks to add their second employee.

**38 — tax jurisdictions, thresholds, report.** Stripe Tax already runs on the
seller's own account, with their registrations and their liability. Threshold
tracking and a jurisdiction report is an accounting product, and §4.3 already
refused becoming a tax provider. This is the same refusal one step further in.

**39 — custom domain.** Cut here, and **refused outright on 2026-08-19** —
*"we will never add it, it will always be sailo.store/store-name."* This
paragraph called it "genuinely wanted", which was true on the day and is not
any more; anyone reading it as a promise should read
`GAP-2026-08-easytools.md` §4.11 instead. In "Not built yet", and it is also
cookie scope, fixed-origin checks and a per-domain CSP — infrastructure, not a
feature, and the spec's own §"Details" says those three are what will bite. Not
a three-minute-setup change.

**46 — platform subscription disputes.** Real money, and it is **Sailo's** money
rather than a seller feature. 44 already captured what it needs, so it stays
cheap to build later.

**49 — membership depth.** Seats, dunning, pause, upgrade paths. Memberships
work today; this is the enterprise-subscription shape.

**50 — event depth.** Tiers and sessions is a ticketing product. Events sell
today.

**51-service — staff calendars, classes, reschedule.** This is Calendly inside
Sailo. Bookings work today.

**31 — integration scenarios.** Outbound webhooks already ship (spec 16) and are
the 20% sellers ask for. The rest is a Zapier, and §4 already refused the app
directory. Moved to `deferred/`.

**40 — gated content collections.** This is `deferred/18-ecourse.md` renamed,
and that spec was refused once already. It is a course platform, in the one
category `README.md` explicitly declines to compete in. **Returned to
`deferred/`.**

---

## What the cut is worth

| | Before | After |
|---|---|---|
| Specs | 22 | 12 |
| New tables | ~40 | ~6 |
| XL specs | 1 | 0 |
| New top-level admin screens | ~9 | ~3 |
| Tree-wide refactors | 1 (`requireShop`) | 0 |

The six new tables are: `stock_requests` (33), `shop_pages` (41),
`data_requests` (52), `product_codes` (48), `offers` (36a), and one for imports
(47a). Everything else is columns on tables that exist.

---

## What does not change

`GAP-2026-08-easytools.md` §4 stands entirely — the buyer network is a boundary
and not a roadmap item, Sailo does not become a tax provider, no page builder, no
per-seller sending domains, no three-level funnels, no named themes.

Those refusals were right for the same reason this document exists: they were
decided against **Sailo's** shape, not against a competitor's feature list. This
is the same judgement applied to the specs that survived them.
