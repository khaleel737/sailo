# Payments compliance

What binds Sailo, where the code stands against it, and what is still open.

Written against the flow as it is: `packages/payments`, `packages/commerce/src/orders`,
`packages/security/src/restricted-businesses`, the two webhook routes in
`apps/web/src/app/api/stripe/`, and the legal pages under `apps/web/src/app/(legal)/`.
Sources are at the foot. Reconciled against Stripe's published lists and docs as at
**17 August 2026**; Stripe's restricted-business list was last published **13 May 2026**
and that date is asserted in code as `STRIPE_LIST_RECONCILED`.

This is an engineering audit, not legal advice. Two items below are marked
**counsel** and mean it: §3.3 and §7.4.

---

## 1. The classification everything else hangs off

Almost every question in this document has a different answer depending on one
thing: **who is the merchant of record**. Sailo's answer is the seller, and it
is the answer the code actually implements rather than merely the one the terms
claim.

| | Sailo |
| --- | --- |
| Connect account type | Express (Accounts v1, `type: "express"`) |
| Charge pattern | **Direct charges** — created on the connected account via the `Stripe-Account` header (`actingAs`) |
| Merchant of record | **The seller.** Money never enters Sailo's balance |
| Platform revenue | `application_fee_amount` on one-off charges, `application_fee_percent` on subscriptions |
| Dispute liability | The seller's balance is debited |
| Negative-balance liability | **Sailo's** — see §3.2, this is the one that is not obvious |
| Card data | Never touched. Full redirect to Stripe Checkout |

This maps to Stripe's "e-commerce enabler" model — sellers create their own
stores and accept their own payments — and the charge pattern is the one Stripe
prescribes for it. The Terms say the same thing in clause 2 and clause 5, so the
contract and the code agree. That agreement is worth more than it sounds: most
platform compliance failures are a mismatch between what the terms promise and
which Stripe account the charge was actually created on.

---

## 2. What binds, and where

| Instrument | Binds | Because |
| --- | --- | --- |
| Stripe Services Agreement | Sailo | Platform account holder |
| Stripe **Connect Platform Agreement** | Sailo | We onboard connected accounts |
| Stripe **Connected Account Agreement** | Each seller | Accepted during hosted onboarding |
| Stripe **Prohibited & Restricted Businesses list** | Both | Named in both agreements |
| Visa Core Rules / VAMP | Stripe → us → sellers | Acquirer chain |
| Mastercard rules / MMP (from 1 Jan 2026) | Stripe → us → sellers | Acquirer chain |
| PCI DSS v4.0.1 | Sailo, as SAQ A | We host the page that links to checkout |
| PSD2 SCA | Stripe, for us | Checkout applies 3DS2 |
| PayPal / Venmo AUP | **The seller only** | Their account, their link — §6 |

The sharp edge is in the Connect Platform Agreement. For accounts onboarded
through Express, the platform is **"responsible and liable to Stripe for all
activity on the connected accounts, whether initiated by them or not"**, and
must take **"all reasonable steps"** to keep those accounts off the restricted
list. That is not a best practice. It is the clause that turns §4 from a
published page into an engineering requirement.

---

## 3. Stripe

### 3.1 Verified correct

Each of these was read in the source, not inferred from the docs.

- **Direct charges, consistently.** `actingAs()` in `packages/payments/src/connect/accounts.ts`
  attaches `stripeAccount` unless the shop *is* the platform account. Every
  session, price, coupon, refund and portal call goes through it.
- **No `payment_method_types` anywhere.** Stripe's own rule, and the reason
  dynamic payment methods work at all. `createCheckoutSession` leaves it unset
  deliberately and says so.
- **Capabilities requested per country, with a per-capability retry.**
  `capabilities.ts` requests the batch, and on refusal falls back to one call
  each — so a German seller does not silently lose Link because Cash App
  travelled in the same request. An Express account is offered nothing it never
  requested, whatever the Dashboard says, so this file is the whole of the
  European payment-method surface.
- **The connected account's country is never guessed.** `requireStripeCountry`
  throws rather than defaulting. Stripe fixes country at creation and offers no
  edit; a wrong one means deleting the account and re-verifying.
- **Two webhook endpoints, two secrets.** Connected-account events are not
  delivered to a platform endpoint. An integration with only the platform one
  records no buyer payments at all — `apps/web/src/app/api/stripe/connect/webhook/route.ts`
  exists for exactly that.
- **Signature verified before the body is parsed**, on the raw text, against a
  comma-separated secret list so a secret can be rotated without a window of
  failed deliveries. Thin v2 payloads are verified with the v2 parser and
  acknowledged rather than 400'd — a 400 would have Stripe retry and eventually
  disable the destination, taking working payments down with it.
- **Idempotency.** `claimEvent` / `releaseEvent` around every handler, so a
  Stripe retry cannot double-apply, and a thrown handler releases the claim so
  the retry can succeed.
- **Delayed-notification methods handled.** `checkout.session.async_payment_succeeded`
  and `…_failed` are in `HANDLED`. Without them, every iDEAL, SEPA and Bancontact
  buyer pays and the order stays unpaid.
- **Disputes handled** — `charge.dispute.created` / `.closed`, with a `disputed`
  payment status that is deliberately not settable by hand.
- **The charge cannot disagree with the order.** `createCheckoutSession`
  asserts line totals against `order.subtotalCents` *and* the rounded Stripe
  total against `order.totalCents`, and refuses rather than charging a different
  number. This is the check that catches three-decimal currencies.
- **Fees are correct in both directions.** `application_fee_amount` on one-off
  charges; `application_fee_percent` on subscriptions, because the renewal
  amount is Stripe's to compute; `refund_application_fee: true` on refunds, so a
  refunded sale returns our cut proportionally.
- **Shipping address is put on the PaymentIntent** for orders that have one.
  Absent, the seller's dispute evidence shows a payment with nowhere to send it,
  which is a losing position on an undelivered-goods chargeback.
- **`adaptive_pricing: { enabled: false }`** on both session types, so the
  books and the payout are in one currency.
- **Keys.** Env only, prefix-validated at boot, never logged. Now accepts `rk_`
  as well as `sk_` (§7.5).

### 3.2 Open: negative-balance liability sits with Sailo

Express plus direct charges means `controller.losses.payments = application`.
Stripe's consequences, all of which apply today:

- Sailo can incur losses from connected accounts' unrecoverable negative balances.
- Stripe **may hold a reserve on the platform account** pending collection, and
  after 180 days of a negative connected balance takes it from that reserve.
- **Managed Risk is unavailable** while the platform holds losses.
- Connected accounts can use the Express Dashboard but not the full one.

Terms clause 5 already passes any shortfall on to the seller contractually and
gives a set-off right, which is the correct drafting — but the money leaves
Sailo first and is recovered second. Two things follow:

1. This is a **funded risk**, not a papered one. It wants a number attached
   (worst-case exposure at current GMV) and a monitoring threshold.
2. Moving it to Stripe means `losses_collector: "stripe"`, which under Accounts
   v2 requires the full Stripe Dashboard for connected accounts rather than
   Express — a different product, not a flag. See §3.4.

The platform does hold the mitigations Stripe expects of a losses-collector:
it *can* pause payments and payouts on a connected account, and clause 9 of the
Terms reserves that in writing.

### 3.3 Open: platform approval for a creator-commerce category — **counsel / Stripe**

Stripe's list has a **Restricted Businesses → Content Creation Platforms**
entry: platforms enabling creators to *"receive content-related tips and other
payments"* or *"sell exclusive content or digital goods"* **require approval**.
Sailo sells digital files and recurring memberships for creators, which is at
least adjacent and arguably squarely inside it.

The same entry contains the note that matters if we are in scope: *"Individual
content creators on approved platforms … do not require preapproval"* — i.e.
the approval is a platform-level one that then covers every seller, which is
exactly the shape Sailo needs.

**Action: ask Stripe directly whether Sailo's platform account needs the
Content Creation Platform approval, and get the answer in writing.** This costs
an email and removes the single largest unquantified risk in this document — a
platform discovering mid-scale that its category needed preapproval does not get
to fix it gradually.

### 3.4 Open: Accounts v1 → v2 — **recommendation: stay on v1, adopt one piece**

Corrected 17 Aug 2026 after checking the shipped SDK rather than the summary.

**v1 is not deprecated and has no sunset date.** Accounts v2 shipped in December
2025. Existing v1 Accounts keep working, v2 endpoints can be called against
them without changing them, and Stripe's own migration guide opens with "if you
don't need Accounts v2 features, you can continue to use your Accounts v1 and
Customers v1 platform integration." The only stated pressure is that Stripe
"discourages indefinitely maintaining both API versions simultaneously."

**It is callable today.** `stripe@22.5.0` types `V2/Core/Accounts` — `dashboard`,
`defaults.responsibilities.fees_collector`, `losses_collector` — and the SDK's
own `ApiVersion` is `2026-07-29.dahlia`, exactly what `stripe/client.ts` pins.
(Stripe's curl examples for v2 show `2026-07-29.preview`; the SDK does not need
it. Worth confirming with Stripe before building, but nothing is blocked.)

**KYC does not depend on the API version.** This is the most commonly mistaken
part. `requirements_collector` is computed from `dashboard` and
`losses_collector`, not from v1-vs-v2: Stripe collects KYC in *every*
configuration except `dashboard: "none"`, which is the only shape where the
platform does it — and the API says so when you try anything else ("When
controlling requirement collection, the Connect application must also control
losses, fees, and specify a dashboard type of `none`"). Sailo has Stripe doing
KYC today and would in v2 too. Nothing to gain or lose there.

None of the v2 blockers apply: Sailo uses account links rather than OAuth, signs
no recipient service agreement, and uses neither Treasury nor Issuing.

**But migrating account creation is a one-way door with a fee trap in it.**
Verified against the API in test mode, because two Stripe pages disagreed — full
matrix and the verbatim rejection messages are in
[ADR 0001](adr/0001-connect-account-shape.md):

- The Express Dashboard **forces** `fees_collector: application` and
  `losses_collector: application`, in v1 and v2 alike. `express` + Stripe-collected
  fees or losses is rejected outright.
- Today's account is `fees.payer = application_express`, under which **the
  connected account pays Stripe's payment processing fees**. That value exists
  *only* for legacy `type: "express"` and cannot be set on a new account. Every
  non-legacy Express configuration resolves to plain `application`, under which
  the published fee-payer table puts **processing fees on the platform** — larger
  than Sailo's entire 1–3% take.
- The webhook scope boundary also moves (v2 events for a connected account arrive
  on **Your account** scope while v1 events stay on **Connected accounts**), and
  Sailo's two endpoints are split on exactly that line. Payment methods in preview
  still require v1, which matters here because the European LPM set is the
  differentiator.

Decision recorded: **stay on legacy Express for account creation.** Item 1 of the
"ask Stripe" list in the ADR is the question that could reverse it.

**The one piece worth taking now is the `customer` configuration.** It lets
Sailo bill a seller's own subscription against their Stripe balance via
`customer_account`, instead of the separate v1 Customer that `ensureCustomerId`
maintains. That is not a tidiness argument: a card that expires is the largest
single cause of a failed renewal, every failed renewal is a `$19`/`$49` invoice
that never becomes `invoice.paid`, and no `invoice.paid` means **no partner
commission accrues either** — see §10. It can be added to existing v1 Accounts
without touching account creation, `connectState`, or the webhook split.

---

## 4. Restricted businesses — what changed in this pass

The policy existed and was well written. Three things were wrong with it as an
instrument rather than as prose.

**It was shorter than Stripe's.** Reconciling line by line against the
2026-05-13 list took the declined list from 13 groups and 90 lines to 16 and
129. The three new groups are *Airlines, cruises and timeshares*, *Government
services and public money*, and *Trades that need a permission Sailo does not
hold*. Among the 39 new lines are categories that were simply absent: airlines,
cruises, charter flights and timeshares; embassy and government services;
identity-theft protection; telemarketing and door-to-door selling; funded prop
trading; shell banks, payable-through accounts and bearer shares; ATMs;
peer-to-peer transfer; neobanks; paying off a loan by card; bankruptcy and
debt-settlement services; law firms holding client money; signal jammers;
improperly marked replica firearms; kava and kratom; ephedrine and HCG;
unmailable goods; games-console modification devices; cyberlockers; and online
dating. A seller reading a shorter list than their processor's is being told yes
by us and no by Stripe, after they have built a catalogue.

**It had no country layer at all.** Stripe's list carries jurisdiction-specific
prohibitions for eleven countries Sailo can open accounts in, and none of them
were represented. `jurisdictions.ts` now holds them, keyed on
`shops.stripeCountry` — the *seller's* business location, which is what Stripe
decides eligibility on and which cannot be edited after account creation. They
render on the public page under each country's own heading, and are declared
part of Terms clause 8.

**Nothing screened against it.** A published policy is the thing you screen
against, not the screen. `screen.ts` now reads a shop's name, description and
first hundred product listings, and `screenBeforeConnect` runs it at the moment
a connected account is about to be created — the moment the platform's liability
attaches, and the moment a refusal costs the seller a conversation rather than a
business. The verdict is recorded through `captureMessage` so it survives the
request, which is the other half of what "reasonable steps" means.

The screen is deliberately timid. `refuse` is reserved for phrases with no
innocent reading; everything ambiguous returns `review`, which is reported and
does not stop the seller. "CBD" is cannabidiol in Bristol and the central
business district in Sydney, and a screen that refused on it would close a
florist for its address. The failure mode designed against is the false
positive: a missed shop is caught by Stripe's own prohibited-business checks
downstream, and a wrongly refused one is a real small business told no by a
regular expression.

The policy is now published at **`/restricted-businesses`** as well as in Terms
clauses 6–8. That is not duplication for its own sake — diligence asks for a
URL, and "clause 8 of our terms of service" is the answer that gets a follow-up
email.

### 4.1 Still open

- **The screen reads English.** Sailo ships 35 storefront languages. A Polish
  shop written in Polish screens clean on its words. Documented in the module
  header rather than hidden; the honest mitigation is that Stripe's own checks
  are language-independent and run on every account we open.
- **There is no persisted review queue.** `review` verdicts go to Sentry, which
  is searchable and durable but is not a worklist. Mastercard's MMP expects
  *continuous* monitoring, not a check at onboarding — so the next step is a
  `shops.screenedAt` / `screeningVerdict` pair, an HQ panel listing flagged
  shops, and a re-screen when the catalogue changes. That needs a migration and
  was left out of this pass deliberately.

---

## 5. PCI DSS

**Sailo is SAQ A, and the reasoning should be written down because a QSA will
ask for it.**

Verified by search, not assumption: there is no `@stripe/stripe-js` dependency
anywhere in the monorepo, no `loadStripe`, no Elements and no Payment Element.
The card rail is a full redirect to Stripe-hosted Checkout. No card number, CVV
or expiry ever reaches Sailo's origin, its logs or its database.

That matters for the two requirements that became mandatory on 31 March 2025:

- **6.4.3** (inventory, authorise and verify the integrity of every script on
  the payment page), and
- **11.6.1** (detect tampering with payment-page content and HTTP headers).

Both attach to *the page that takes the card*. Under a full redirect that page
is `checkout.stripe.com` and it is Stripe's. This is the distinction that trips
up merchants who embed an iframe: the iframe is sandboxed but the page framing
it is not, and 6.4.3/11.6.1 stay with the merchant. Sailo frames nothing.

Sailo's own pages carry seller-configurable Meta and TikTok pixels and a GTM
container. Those are third-party scripts on Sailo's origin — but not on a
payment page, so they do not pull the requirements back in. They are bounded by
CSP regardless: a tag inside a seller's GTM container that loads from a host not
named in `script-src` is blocked, which is why Meta and TikTok are first-class
fields rather than something a container has to fetch.

**Action:** record the above as the SAQ A eligibility justification alongside
the annual attestation. It is a paragraph, and it is the paragraph an assessor
asks for.

Supporting headers, all verified in `apps/web/next.config.ts`: CSP with
`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
`form-action` limited to self and Stripe, `connect-src` naming
`api.stripe.com`; HSTS and `upgrade-insecure-requests` in production only;
`X-Content-Type-Options`, `Referrer-Policy`, COOP `same-origin-allow-popups`
(the strict form severs the opener Stripe Connect onboarding needs).

`'unsafe-inline'` remains on `script-src`, and the config is honest about the
cost: with it, this CSP is not a script-injection defence. A nonce is
architecturally unavailable while `cacheComponents` prerenders static shells,
since a nonce forces dynamic rendering on every page. That trade is defensible
and is not a PCI finding under SAQ A — but it is the one place where the
security posture is weaker than it reads.

---

## 6. The rails that are not Stripe

Sailo carries nine non-card rails. None of them is Sailo taking money.

- **Chat rails** (WhatsApp, Telegram, Instagram, email, phone) — the order moves
  to a conversation. No payment system involved.
- **Bank transfer and cash on delivery** — instructions and a seller
  confirmation. No payment system involved.
- **PayPal and Venmo** — a deep link to the *seller's own* PayPal.Me or Venmo
  handle, with the amount prefilled, and the buyer returns to say they paid.
  Sailo never learns the money arrived and takes no fee.

The classification is correct and matters: PayPal's Acceptable Use Policy (last
updated 15 July 2026) and Venmo's terms bind **the seller**, not Sailo, because
it is the seller's account and the seller's link. Sailo is not a PayPal partner,
holds no PayPal integration and receives no PayPal funds.

The code's own reasoning for not doing this through Stripe is correct and worth
preserving: Stripe carries PayPal but excludes this exact shape twice over — the
US is absent from its supported business locations, and Stripe states it "isn't
available for platforms that onboard other businesses and enable them to accept
payments directly", which is precisely Sailo. Reaching it would mean destination
charges, and destination charges make Sailo the merchant of record — undoing §1.
Venmo has no Stripe support anywhere; it is Braintree-only, which would be a
second processor with its own onboarding, webhooks and disputes.

**One gap, small and worth closing.** The Venmo rail warns the seller that a
personal profile will have business payments reversed. The PayPal rail carries
no equivalent warning, and the equivalent risk is real: a PayPal.Me payment sent
as *friends and family* carries no PayPal buyer or seller protection, so a
dispute leaves the seller with neither the money nor the goods. One sentence in
the `paypal` entry's `hint` in `packages/payments/src/offline/rails.ts`, matching
the Venmo one. *Not applied in this pass — that file is being concurrently
refactored in this worktree (see `rail-defs.ts`).*

---

## 7. Regulatory surfaces

### 7.1 SCA / PSD2 — compliant, by construction

European card payments require Strong Customer Authentication. Stripe Checkout
applies its own SCA logic and triggers 3D Secure 2 where required, including the
frictionless flow and exemptions. Sailo redirects to Checkout for every card
payment and for every subscription, so there is no code path where a card is
authorised without Stripe's SCA logic in front of it. PSD3 is still in
negotiation and is not expected to bind before this document is next revised.

### 7.2 Tax — the seller's, and the code says so

Sellers are merchant of record, so sales tax, VAT and GST on a shop's sales sit
with the seller. Stripe Tax and `automatic_tax` are **not** used; `order.taxCents`
is computed by Sailo from the seller's own settings and passed as a Checkout line
(exclusive) or left inside the unit price (inclusive), with `taxName(order)`
labelling it.

This is a defensible design for a MoR-is-the-seller platform, and the conditional
business list makes the obligation explicit. Two things to hold:

- Sailo must not present the tax number as authoritative. It is the seller's
  configuration rendered, not a calculation Sailo warrants.
- If Sailo ever adds `automatic_tax`, it does nothing without an active Stripe
  Tax registration — the most common Stripe Tax error is enabling it and
  collecting no tax while believing it is on.

### 7.3 US information reporting — not Sailo's

Card payments settle on the seller's own Stripe account, so Stripe issues the
seller's 1099-K. Sailo does not aggregate settlement and has no filing.

### 7.4 EU DAC7 — **counsel**

DAC7 puts an annual seller-reporting obligation on "platform operators", and the
obligation never transfers to the seller. Whether Sailo is one is a genuine
question, not a formality:

- **Arguing in scope:** Sailo hosts storefronts and takes orders for goods and
  personal services from sellers to buyers.
- **Arguing out of scope:** DAC7 excludes operators whose sole function is
  processing payments, listing or advertising, or redirecting users. Sailo runs
  no marketplace — there is no cross-seller discovery, no shared checkout and no
  buyer relationship. It is closer to Shopify (software a seller runs their own
  shop on) than to Etsy.

Shopify's position is instructive but not binding on us. **This needs a written
opinion**, because if Sailo is in scope the obligation includes collecting
seller tax identifiers and residence, verifying them, and filing by 31 January
for the preceding year — none of which is currently built, and all of which is
much cheaper to design now than to backfill.

### 7.5 Consumer protection — already in the product

- **Terms acceptance** is enforced server-side at order creation with a
  timestamp (`orders.termsAcceptedAt`), not trusted from a resubmitted flag.
- **Marketing consent** is a timestamp, unchecked by default, grant-only on
  merge — which is the GDPR-correct shape (pre-checked consent is invalid, and
  omission is not withdrawal).
- **Subscriptions** cancel at period end through Stripe's own hosted billing
  portal, so there is no path where the UI says cancelled and Stripe keeps
  charging. Silent auto-renewal and negative-option billing are declined
  categories, not merely discouraged.
- **Refunds** return the platform fee proportionally.

---

## 8. Changes made in this pass

| # | Change | Where |
| --- | --- | --- |
| 1 | Reconciled the declined list against Stripe's 2026-05-13 list: 13 groups / 90 lines → 16 / 129 | `security/restricted-businesses/declined.ts` |
| 2 | Country-specific prohibition layer, 11 countries, keyed on the seller's Stripe country | `security/restricted-businesses/jurisdictions.ts` |
| 3 | Screening matcher, two severities, false-positive-averse by design | `security/restricted-businesses/screen.ts` |
| 4 | Screen runs before a connected account is created; verdict recorded to Sentry | `apps/web/src/lib/actions/connect.ts` |
| 5 | Conditional list gains travel-reservations and cross-border-selling entries; alcohol and sexual-wellness entries now point at the country rules | `security/restricted-businesses/accepted.ts` |
| 6 | Policy published at its own URL, in the legal nav and the sitemap; Terms clause 8 cross-links it and adopts the country rules | `apps/web/src/app/(legal)/restricted-businesses/`, `layout.tsx`, `sitemap.ts`, `terms/page.tsx` |
| 7 | `STRIPE_SECRET_KEY` accepts `rk_` restricted keys as well as `sk_`, still refusing `whsec_` | `payments/src/keys.ts` |
| 8 | Tests for the country layer and the screen, including the CBD false-positive and word-boundary cases | `security/restricted-businesses/policy.test.ts` |

## 9. Open, in priority order

| # | Item | Kind | § |
| --- | --- | --- | --- |
| 1 | Confirm with Stripe whether Sailo needs Content Creation Platform approval | Business — do this week | 3.3 |
| 2 | Quantify negative-balance exposure; set a monitoring threshold | Business + eng | 3.2 |
| 3 | DAC7 scope opinion | **Counsel** | 7.4 |
| 4 | Persisted screening verdicts + HQ review queue + re-screen on catalogue change | Eng, needs a migration | 4.1 |
| 5 | Record the SAQ A eligibility justification with the attestation | Doc | 5 |
| 6 | PayPal.Me friends-and-family warning on the rail | Eng, one line | 6 |
| 7 | Plan the Accounts v1 → v2 migration | Eng, sizeable | 3.4 |
| 8 | Screening beyond English | Eng | 4.1 |
| 9 | `integration_identifier` on the *storefront* Checkout Sessions. Corrected: it is in `stripe@22.5.0` and already set on the plan-upgrade session in `@sailo/billing`; only `card-checkout.ts` and `subscription-checkout.ts` omit it | Eng, cosmetic | — |
| 10 | Add the v2 `customer` configuration so sellers can pay their plan from their Stripe balance — fewer failed renewals, and therefore fewer lost partner commissions | Eng, contained | 3.4 |

---

## 10. Pricing at $19 / $49, and what it does to partner commission

Added 17 Aug 2026, after the plan prices moved to $19 (Pro) and $49 (Business)
and the fee ladder to 3% / 2% / 1%.

### 10.1 The chain, and where it was broken

Partner commission is not computed from the plan table. `invoice.paid` on the
platform account calls `recordReferralEarning` with `invoice.amount_paid` —
Stripe's number, not ours — which is the correct design and means the rate
needed no change at all when the prices moved. A prorated upgrade or a
promotion code pays commission on what we actually received.

The consequence people miss is what that makes commission *depend* on:

> a seller can upgrade → an invoice is raised → `invoice.paid` fires →
> a partner earns.

Break the first link and the partner programme silently earns nothing. **It was
broken.** `plans.ts` had been updated to 1900/4900 and the Stripe account had
correct prices created for them, but `.env.local` still named the previous,
now-**archived** price objects — $9.99, $95.90, $19.99, $191.90. `startCheckout`
calls `priceMismatch` before creating a session, so it failed safe rather than
charging the wrong amount, but the result was that **no upgrade could complete
at all**, and therefore no commission could accrue.

The guard did its job; nothing was watching the guard. Two things fixed that:
the four ids now point at the live $19/$180/$49/$468 prices, and
`verify-prices.ts` — which existed but was not runnable by name — is wired up as
`pnpm --filter @sailo/web check:prices`, alongside `check:stripe` for the
read-only drift report.

**`/hq/system` reports these four variables as present, and presence is not
correctness.** A stale id is present and wrong, which is precisely this bug.
Only `check:prices` catches it.

### 10.2 What the numbers actually are now

| | Pro | Business |
| --- | --- | --- |
| Plan | $19 / mo · $180 / yr | $49 / mo · $468 / yr |
| Card fee kept by Sailo | 2% | 1% |
| Partner commission at 30% | **$5.70 / mo** | **$14.70 / mo** |
| On the yearly invoice | $54.00 | $140.40 |
| Invoices to clear the $25 payout floor | 5 monthly, or 1 yearly | 2 monthly, or 1 yearly |

Free carries a 3% card fee and no subscription, so it generates no partner
commission at all — commission is a share of what a seller pays *Sailo*, and a
free seller pays nothing. That is correct and worth stating, because "referrals
who never upgrade are worth zero" is the single most important thing a partner
should understand before promoting.

`economics.test.ts` in `@sailo/partners` pins every figure in that table as
concrete money rather than a re-derived formula, so a future price change moves
the numbers in a diff instead of silently moving a partner's income.

### 10.3 Where the prices are stated, and where they were wrong

Derived everywhere it matters — `PLANS` is the single source, the marketing page
formats from it, `blog-facts.ts` interpolates it into articles, the partner
landing page computes the per-referral figure from it, and
`pricing-section.test.ts` fails the build if a currency literal appears in the
markup.

Three surfaces were still wrong:

- **The partner page re-implemented the commission formula inline** rather than
  calling `commissionCents`. Two implementations that merely agree is not one
  source of truth; it now calls the ledger's own function.
- **`softwareJsonLd` declared a single `Offer` at `price: "0"`** — true of the
  free plan, false of the product, and the only structured-data price on the
  site. Now an `AggregateOffer` with low/high derived from `PLANS`.
- **Nineteen blog articles carried figures derived from the old 0.5% fee and the
  old $19.99 plan** — "on a $34 hoodie that's 17 cents", "$30.79", "$239.88",
  and three whole fee tables in `how-payment-fees-eat-a-small-order`. The tokens
  beside them had updated; the arithmetic they fed had not. Several also still
  claimed card payments require a paid plan, which stopped being true when
  `cardRails` moved to Free. All English-only — no translation carried a stale
  figure — and all corrected.

Two tools now cover this, split by what automates honestly:

- `blog-pricing-claims.test.ts` **fails the build** on a literal Sailo percentage
  or plan price anywhere in the 412-article corpus. A literal is always wrong,
  so it can be a test.
- `pnpm --filter @sailo/web check:blog-fees` **reports** sentences stating a
  Sailo fee as a single amount. A derived figure is only wrong once the rate
  moves, and about one hit in three is legitimate — a sentence naming one plan
  states a single figure correctly. Made to fail the build it would need an
  allowlist of individual sentences, which is a thing nobody maintains and
  everybody mutes. Run it beside `check:prices` whenever `plans.ts` changes; it
  currently reports 2, both correct.

---

## Sources

- [Stripe Prohibited and Restricted Businesses](https://stripe.com/legal/restricted-businesses) — last published 2026-05-13
- [Stripe Connect Platform Agreement](https://stripe.com/legal/connect)
- [Stripe Connected Account Agreement](https://stripe.com/legal/connect-account)
- [Risk and liability management with Connect](https://docs.stripe.com/connect/risk-management)
- [Connected account configuration (Accounts v2)](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)
- [Strong Customer Authentication readiness](https://docs.stripe.com/strong-customer-authentication)
- [Stripe: 3D Secure 2](https://stripe.com/guides/3d-secure-2)
- [Visa Core Rules and Visa Product and Service Rules, 18 April 2026](https://usa.visa.com/dam/VCOM/download/about-visa/visa-rules-public.pdf)
- [Visa Payment Facilitator and Marketplace Risk Guide](https://usa.visa.com/content/dam/VCOM/regional/na/us/partner-with-us/documents/visa-payment-facilitator-and-marketplace-risk-guide.pdf)
- [LegitScript: Mastercard BRAM and Visa VIRP](https://www.legitscript.com/bram-virp/)
- [PCI DSS 6.4.3 and 11.6.1 — payment page security and integrity](https://cloudsecurityalliance.org/blog/2026/07/23/pci-dss-6-4-3-and-11-6-1-a-deep-dive-into-payment-page-security-and-integrity-requirements)
- [PayPal Acceptable Use Policy](https://www.paypal.com/uk/legalhub/paypal/acceptableuse-full) — last updated 15 July 2026
- [European Commission: DAC7](https://taxation-customs.ec.europa.eu/taxation/tax-transparency-cooperation/administrative-co-operation-and-mutual-assistance/dac7_en)
