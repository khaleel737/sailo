# Wave B — Catalogue and checkout

You are one of six agents building the Sailo 2026-08 release in
`~/Desktop/Sailo`. You own **four** items — the catalogue a physical seller
touches every day, and the checkout it feeds.

Migrations **0039–0042**. Claim each with a one-line commit to
`apps/web/drizzle/` before writing the SQL.

**Order: B2 and B3 first (both small), then B1, then B4.**

---

## B1 — Preorders and back-in-stock · M · `0039_preorders.sql`

`docs/specs/33-preorders-and-back-in-stock.md` — **newly written, replacing the
waitlist spec, which is now in `deferred/`.** Read it in full; it is the most
Sailo-shaped thing in the release.

A waitlist is a digital-launch instrument — availability is a date the creator
picks. Sailo's sellers ship things, and their version of that moment is **the
last blue medium selling on a Tuesday**.

**New table:** `stock_requests`. Columns on `products` and `product_variants`.

The two things most likely to go wrong:

- **`variant_id` is the subject, not `product_id`.** "Tell me when the blue
  medium is back" is the request; notifying that person because the *red* one
  arrived is the failure that turns a helpful message into a complaint.
- **One notification per request, ever**, claimed with a conditional UPDATE. A
  seller who restocks Monday, sells out by lunch and restocks Wednesday must not
  message the same person twice in three days.

**Preorders on the card rail: charge at checkout, like any other order.**

The spec as written refused the card rail in v1, reasoning that a preorder needs
an authorisation held against goods that do not exist. That is one way to build
it and it is not the one to build — **Stripe is Sailo's priority rail, and the
ordinary commerce answer is to charge now and ship later**, which is what every
Shopify preorder does. No authorisation to hold, no capture window to expire.

What that buys is a duty, not machinery, and it is the whole of the risk:

- **The expected date is shown before the buyer commits, and recorded on the
  order.** A card payment for goods that arrive six weeks later is a chargeback
  waiting to happen if the buyer was never told six weeks.
- Spec 44 is already in the tree and is exactly what answers that dispute — the
  policy the buyer agreed to (`policy_snapshots`), what they were told
  (`order_messages`), and when it arrived (`orders.delivered_at`). **Record the
  promised date the same way**, so a `product_not_received` case can show what
  was promised rather than what was hoped.
- **Say what happens if it never ships.** A refund policy for preorders is the
  seller's, but the checkout must state that one exists.

On the chat and manual rails a preorder is even simpler — no money moves at
checkout there at all, so it is an ordinary order with a promised date.

Where there is only a phone number **Sailo does not send** — there is no
WhatsApp Business API here. The seller's screen gives a `wa.me` compose link and
the seller presses send from their own number.

---

## B2 — Physical depth · M · `0040_physical_depth.sql`

`docs/specs/51-service-and-physical-depth.md` — **the physical half only** (§
"Physical — four gaps"). The service half belongs to Wave C; agree the migration
between you if you both need `products` columns.

Low-stock alerts, weight and dimensions so shipping can be priced, partial
fulfilment and multiple shipments. **New table:** `shipments`.

- The low-stock alert is **one email when stock crosses the threshold
  downward**, claimed so a busy afternoon does not send five.
- Weight and dimensions are the input spec 28's shipping zones (`0019`) were
  missing. Grams and millimetres, integers, no unit picker — a seller who thinks
  in ounces is served by a label, not a second stored unit. Same reasoning that
  keeps money in minor units.

---

## B3 — Pricing models · M · `0041_pricing_models.sql`

`docs/specs/43-pricing-models.md`. Pay-what-you-want, donation preset, sell
windows, manual trials. Columns on `products` and `product_variants`.

> **This is the only place in the checkout where a price comes from the
> request.** Clamp at **both** sinks — `resolveLines` *and* `previewOrder` — and
> remember `createOrderIntent` is the third. `PRODUCTION-PLAN.md`'s recurring
> shape is *"guard applied at one sink not its twin"*, and here it costs money
> directly.

Payment plans and installments stay **refused** (§"Payment plans").

**Sell windows unblock two other specs** — 33's "not released yet" case and
Wave C's event tiers. Land them early and say so.

---

## B4 — Order bumps and cross-sells · L · `0042_offers.sql`

`docs/specs/36-cross-sells-and-thank-you.md` **and**
`docs/specs/08-order-bumps.md`. **Build them as one thing, 36 first** — 36
supersedes 08's `products.bumpProductId` with an `offers` table and keeps its
`viaBump` attribution, so building 08 as written and then replacing it is wasted
work.

**New tables:** `offers`, `offer_events`.

- **Cross-sells go after payment, never before.** Their citation is worth
  keeping: Baymard found 66% of shoppers made to pass a cross-sell before paying
  reported extreme frustration.
- **Flat: `parent_id` present and always null in v1.** §4.6 already refused
  three-level funnel trees.

---

## Shared risk with Wave C and Wave D

`resolveLines`, `previewOrder` and `createOrderIntent` are the three pricing
sinks, and B1, B3 and B4 all touch them. `packages/db/src/schema/catalog.ts`
(`products`) is touched by four waves. **Whoever lands second re-runs the first
one's scenarios, not just their own.**

---

## Non-negotiables

Read first: `docs/specs/README.md` (the ten rules) and
`docs/specs/GAP-2026-08-easytools.md` §4 (the refusals, which stand — no page
builder, no buyer network, no tax service, no per-seller sending domains, no
three-level funnels, no named themes). Then your specs, in full.

`docs/specs/RESHAPE-2026-08.md` is the analysis of why each spec was questioned
and what its smaller version looks like. **The full set is being built** — but
if something in your spec reads as a subsystem rather than a feature, that
document is where the argument for the smaller shape lives. Sailo is *"one template, no checkout to
configure"* and a seller is live in about three minutes — every screen you add
has to earn its place against that.

**The market is the US and the EU, and Stripe is the priority rail.** The chat
and manual rails exist and matter, but a feature that only pays off away from
Stripe is not the priority.

**Wave 0 is done and in the tree:** the chargeback suite runs again (it had been
failing to *load*, reporting "no tests"), spec 44 has landed, and Decisions A
and B are answered and built.

## Environment

```bash
nvm use 22.22.1     # node 20.10 breaks vitest at startup — non-negotiable
```

Scenario suites run against the **Neon dev branch**, not the container `up.sh`
starts. Apply your migration to that branch too:

```bash
npx dotenv -e .env.local.test -- \
  npx vitest run --config vitest.scenarios.mts e2e/scenarios/<yours>.scenario.ts
```

## The loop

**While working:** your package's `npx tsc --noEmit` and the one test file you
touched. Nothing more — a full `turbo test` takes minutes and tells you nothing
extra until you are ready to commit.

**Before a commit,** all of it:

```bash
npx tsc --noEmit && npx vitest run
./e2e/scenarios/up.sh && npx vitest run --config vitest.scenarios.mts
npm run build && npx oxlint
DATABASE_URL=postgres://k:k@localhost/k npx knip
npm run check:i18n
```

Plus **render it and read the visible text** (every RSC payload embeds the error
boundary's copy, so grepping for "something went wrong" matches healthy pages
too), and **verify in a browser** with `.env.local.test` — never `.env.local`,
which is production.

## Strings

Add English keys to `packages/i18n/src/{dictionaries,admin}/en.ts`, then
`npm run i18n:fill` (needs `ANTHROPIC_API_KEY`) or
`npm run i18n:fill -- --from batch.json`.

**Never hand-edit the 34 locale files.** A storefront key missing from any
locale is a compile error. Money sections (checkout, cart, rails, invoice,
billing, membership, download) are never machine-written.

## Rules you will be judged on

- **Claims are conditional UPDATEs** with the ceiling in the WHERE, never a read
  then a write. Webhooks idempotent and ownership-checked. Ledgers append. Order
  *lines*, not headers. Blank ≠ zero.
- **The six recurring bug shapes:** half-updated function pairs, a guard at one
  sink and not its twin, check-then-act, header-vs-lines, blank-vs-zero,
  throttled-as-no.
- **Every public route carries a ceiling.** Decision B is built — pass
  `{ onOutage: "closed" }` on public writes, anything spending money or quota,
  and anything whose answer says whether something exists. Read
  `verdict.reason`: a fail-closed refusal is **not** an answer about the
  request. Worked example: `COUPON_MESSAGES.unavailable` in
  `packages/core/src/money/pricing.ts`.
- **No response may be an existence oracle.** The same sentence whatever it
  found.
- **Plan gating** through `packages/core/src/shop/plans.ts`. No silent caps —
  clamped output says so.
- **Public storefront pages** are `"use cache"` + `cacheTag(shopTag(id))`; any
  write that changes what they show revalidates the tag.
- **Every seller-supplied URL** through the SSRF guard **at the write**, with the
  `lookup` hook rather than resolve-then-fetch.
- **Money-path changes need scenario coverage**, not unit coverage. That is
  where four defects were found last time, by writing them.
- **New columns on `products` are nullable or defaulted**, following
  `apps/web/drizzle/0034_product_kinds.sql`, so an existing catalogue reads and
  sells identically the moment your migration lands.

## Staging

Check `git status` first. **Stage explicit paths. Never `git add -A`.** Other
agents are in this tree and there is unrelated in-flight work in it.
