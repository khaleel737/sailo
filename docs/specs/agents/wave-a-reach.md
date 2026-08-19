# Wave A — Reach

You are one of six agents building the Sailo 2026-08 release in
`~/Desktop/Sailo`. You own **two** items: sell in the buyer's currency, and
take the sellers leaving Shopify. A third — letting a shop live on its own
domain — was removed by the owner mid-wave; see A3 below before touching
anything domain-shaped.

Migrations **0036–0038**, of which 0038 is a tombstone. Claim each with a one-line commit to
`apps/web/drizzle/` before writing the SQL.

---

## A1 — Regional pricing · M · `0036_regional_pricing.sql`

**No spec exists. Write one first** as `docs/specs/53-regional-pricing.md`,
following the shape of the others in that folder.

> *"Flat USD today; localised pricing lifts conversion sharply."*
> — `README.md`, the first line of its own *"Not built yet"*

**Scope it to the markets Sailo is actually going after: the US and the EU/UK.**
That is a multi-currency problem before it is anything else — EUR, GBP, and the
non-euro EU currencies (SEK, DKK, PLN) — and a British buyer shown `$29.00` is
a British buyer doing mental arithmetic at the moment they were about to pay.

**Half of this already exists, on the rail that matters most.** Stripe's
Adaptive Pricing is switched on in `packages/commerce/src/orders/card-checkout.ts`
(`adaptive_pricing: { enabled: true }`) and the Connect webhook records what the
buyer actually paid into `orders.presentmentCurrency` and
`presentmentAmountCents` (`0030_adaptive_pricing_presentment.sql` — read the
long comment on those columns; it explains why the shop's own books never move).

**So the gap is narrower than it looks, and it is in two places:**

1. **The storefront shows one currency.** A buyer sees the shop's price until
   they reach Stripe, and only then discovers what they will be charged. The
   price on the card is where the decision is made.
2. **The chat and manual rails have nothing.** A bank transfer or a
   cash-on-delivery order in the EU quotes the shop's currency and always will —
   Stripe is not in that path at all.

**Keep it small:**

- A per-shop set of prices per currency, per product. **Not an FX engine** — the
  seller types the number they want charged in €, and that is the number.
  A price a seller chose is also a price they can round to something that reads
  well, which no conversion will ever do.
- The currency a visitor sees is decided **server-side** from the geo headers
  `apps/web/src/lib/auth.ts` already reads (`x-vercel-ip-country`), with a manual
  switcher.
- **The order stores what was charged, in the currency it was charged in**, and
  the invoice states that currency. Do not re-derive from a rate at read time —
  `orders.taxCents` carries a comment about why snapshots beat re-derivation and
  the argument is identical here.
- **No live FX rates in v1.** A rate that moves between the price shown and the
  order written is a price the buyer never agreed to.
- Where a seller has set no price for a currency, **fall back to the shop's own
  and say nothing** — a half-configured currency must not show a converted guess.

`chargeStep` in `packages/core/src/money/currency.ts` already knows about
zero-decimal currencies. Use it, and do not add a second rounding rule.

**Check first whether Adaptive Pricing already covers the card rail well enough
for v1.** If it does, this spec is only the storefront display plus the manual
rails, which is a much smaller piece of work — say so rather than building
around something that already works.

## A2 — Migrate from other tools · L · `0037_imports.sql`

`docs/specs/47-migrate-from-other-tools.md`. **New tables:** `import_jobs`,
`import_links`.

Stripe and CSV ungated. **Shopify is the one migrant our competitors cannot
serve**, and a physical seller leaving a heavy platform is precisely Sailo's
target — it is why this is P1.

- Products, variants, images, categories, stock.
- **Imports no orders and no consent.** An imported contact has not opted in to
  anything, and treating an import as consent is the fastest way to damage the
  sending domain every other seller shares. It is not recoverable by
  apologising.
- Every seller-supplied URL through the SSRF guard **at the write**, with the
  `lookup` hook — resolve-then-fetch is a TOCTOU window a redirect walks through.
- A partial import is resumable and **says what it skipped**. No silent caps.

---

## A3 — Custom domain · **REMOVED**

**Do not build this.** The owner's decision, mid-wave on 2026-08-19: *"Remove
custom domains, we will never add it, it will always be sailo.store/store-name."*

A build was started against `docs/specs/39-custom-domain.md` and backed out the
same day — the table, the host routing, the DNS verification and the platform
binding are all gone. The spec is now `docs/specs/deferred/39-custom-domain.md`
with the decision on its front page, the argument is
`GAP-2026-08-easytools.md` §4.11, and `drizzle/0038_custom_domains.sql` is a
tombstone explaining why its number cannot be reused.

This wave is **two** items, not three.

---

## Done when

A buyer in Berlin sees €, on the storefront and not only at Stripe, and a
seller moves their Shopify catalogue in one pass and sees exactly what did not
come.

The third clause used to read *"a shop serves from its own domain"*. It does
not, and it never will — see A3.

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
