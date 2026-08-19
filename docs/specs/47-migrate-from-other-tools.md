# 47 — Migrate from other tools

**Priority:** P1 · **Effort:** L · **Depends on:** nothing ·
**Blocks:** nothing

## What

A seller arrives with a catalogue somewhere else and gets it into Sailo without
retyping it. Seven sources: **Stripe**, **Shopify**, **Etsy**, Gumroad,
Lemon Squeezy, Paddle, and the CSV that already works.

This is not a feature so much as a removal of the reason people do not switch.
Easytools ships five migration guides and a Stripe product importer, and every
one of their comparison pages is a migration pitch. Sailo has CSV import
(`apps/web/src/lib/import/{products,clients,tickets}.ts`) and no path from any
named product.

## Why Shopify and Etsy are the two that matter

Every other platform in this category — Easytools, Gumroad, Lemon Squeezy,
Paddle — is built for *digital* products. Sailo's own README says the gap it
occupies is physical sellers, and it is the only one of the group with variants,
option matrices, real stock claimed by conditional UPDATE, shipping zones and a
booking engine.

**A Shopify or Etsy seller is therefore the migrant Sailo can serve and its
competitors cannot** — and the one with the most data to move, which is exactly
why they do not move.

**Etsy is the one this repo has already promised.** `apps/web/src/app/layout.tsx`
and `(marketing)/_components/home-metadata.ts` both ship
**"Etsy alternative"** as a targeting keyword, and the home page's own meta
description is an Etsy argument in one line: *"no marketplace takes a cut of the
customers you found yourself."* Marketing yourself as the alternative to a
marketplace and then offering no way off it is the gap a seller notices on day
one. An Etsy shop is also the closest shape to Sailo's model of anything on this
list — physical goods with variations and quantities, plus Etsy's own digital
downloads — so the mapping is nearly one-to-one.

Stripe comes first only because it is nearly free: the seller has already
connected an account, so there are no credentials to collect.

## The architecture: one write path, six readers

`apps/web/src/lib/import/product-rows.ts` already exists, is tested
(`product-rows.test.ts`), and validates a row shape into products. **Do not write
six importers.** Each source is a *fetcher* and a *mapper* that produce the
existing validated row shape, and everything downstream — validation, dry run,
the write, the failure report — is shared and already there.

```
packages/commerce/src/import/
  sources/stripe.ts      products + prices off the connected account
  sources/shopify.ts     Admin GraphQL
  sources/etsy.ts        listings CSV export (see the OAuth note below)
  sources/gumroad.ts     CSV export (their API is too thin to rely on)
  sources/lemonsqueezy.ts  API
  sources/paddle.ts      API
  map.ts                 source object → the existing row shape
  plan.ts                pure: rows → a preview with per-row verdicts
```

`plan.ts` is pure and is where every branch lives — testable from object
literals, no network, the shape `assemble.ts` and `segments.ts` already use.

## Data model (migration, production first)

`drizzle/NNNN_imports.sql`.

```
import_jobs      id, shop_id → shops(cascade),
                 source text not null,    -- stripe|shopify|gumroad|lemonsqueezy
                                          -- |paddle|csv
                 kind text not null,      -- products | customers
                 status text default 'draft',
                   -- draft | previewed | running | done | failed | cancelled
                 counts jsonb,            -- {found, created, updated, skipped, failed}
                 report jsonb,            -- per-row verdicts and reasons
                 created_by text,
                 started_at, finished_at, created_at
                 idx (shop_id, created_at)

import_links     shop_id → shops(cascade),
                 source text not null,
                 external_id text not null,
                 entity text not null,    -- product | variant | customer | category
                 local_id uuid not null,
                 first_imported_at, last_seen_at
                 primary key (shop_id, source, entity, external_id)
```

`import_links` is what makes re-running an import an **update rather than a
duplicate**, and it is the single most important table here: a seller who
imports 200 Shopify products, fixes three prices in Shopify, and imports again
must end with 200 products. Without this they get 400, and the second run is the
one that loses their trust permanently.

## Credentials — collect, use, discard

Shopify, Lemon Squeezy and Paddle need an API token. **Do not store it.** Take
it in the form, hold it for the job, discard it on completion. A stored
third-party token is a credential at rest with no ongoing purpose — the import
is a one-off, and a seller who wants to re-run it can paste it again.

This is the opposite of spec 31's `integration_apps`, and deliberately: that one
is an ongoing connection, this one is a single errand. If continuous Shopify sync
is ever wanted it is a different spec with a different security posture, and it
should not be smuggled in through this one.

Stripe needs nothing: `shops.stripeAccountId` is already connected and the read
is `products.list` + `prices.list` on that account.

## Mapping — the decisions that must be written down

### Stripe
- `product` → `products`, `price` → a variant when several exist on one product.
- Recurring prices → `kind = 'membership'` with `billingInterval` and
  `billingIntervalCount`. **Reuse the existing cached-Price logic**; do not mint
  new Prices for something the seller already sells at that Price id.
- `images[0]` → the product image; the rest → `product_images`.
- `metadata` is ignored, not guessed at.

### Shopify (the substantial one)
| Shopify | Sailo | Rule |
|---|---|---|
| Product | `products` | `status: ACTIVE` → `isPublished`, `DRAFT` → not |
| `requires_shipping = false` | `kind = 'digital'` | This is how Shopify sellers model digital goods, and getting it wrong makes every ebook ask for a shipping address |
| Options (≤3) | `products.options` | Sailo's `ProductOption`/`VariantOptions` shape. **Verify the arity limit** before promising a 3-option import |
| Variants (≤100) | `product_variants` | `sku`, `price`, `compare_at_price` → `compareAtCents`, `inventory_quantity` → `stockQuantity`, `image` → `imageUrl` |
| Inventory across locations | one `stockQuantity` | **Sum, and say so in the report.** Sailo has no multi-location model, and silently importing one location's count oversells |
| Collections | `categories` | Custom collections only; smart collections are a query, not a list, and importing the current members freezes a rule into rows |
| `body_html` | `description` | Strip to text through the existing sanitiser. Shopify HTML carries their theme's markup |
| Customers | `clients` | Name, email, phone, address, tags |
| **Orders** | **nothing** | See below |

### Etsy — CSV first, and deliberately not OAuth

| Etsy | Sailo | Rule |
|---|---|---|
| Listing | `products` | `state: active` → `isPublished`; `draft`/`inactive` → not |
| Price + quantity | `priceCents`, `stockQuantity`, `trackInventory` | Quantity present → `trackInventory` on. Etsy sellers live by their quantity field |
| Variations (≤2 properties) | `products.options` + `product_variants` | Etsy caps at two variation properties; Sailo's `ProductOption` shape takes them directly. Per-variation price and quantity map to the variant columns |
| SKU | `sku` / `product_variants.sku` | Straight across |
| Tags, materials | `tags` | Merge both into `tags`; Etsy's 13-tag cap is below anything Sailo enforces |
| Images (≤10) | `product_images` | Re-hosted, see trap 3 |
| Taxonomy / shop sections | `categories` | Shop **sections** map to categories; Etsy's global taxonomy does not — it is their search tree, not the seller's own grouping |
| Digital listing files | `kind = 'digital'`, file slot empty | Etsy digital files sit behind their auth. Same rule as Gumroad — the product is created, the file is the seller's checklist item |
| Receipts (orders) | **nothing** | See trap 1 |

**No OAuth, and that is a decision rather than a shortcut.** Etsy's Open API v3
is OAuth 2.0 with PKCE behind an app registration and app review — the same wall
that put `deferred/25-autodm.md` in `deferred/`, and the same trade this repo has
now refused three times (spec 16's app directory, `17-booking-integrations.md`
choosing iCal over Google OAuth, and spec 31's generic actions). It would also
contradict this spec's own "collect, use, discard" posture, because an OAuth
refresh token is a credential at rest by definition.

So Etsy lands as a **listings CSV upload**: the seller exports from Shop Manager
and drops the file in. No app review, no token, and it ships in the same week as
the rest.

> **Verify before building:** the exact column set of Etsy's current listings
> export, and in particular whether it carries image URLs and per-variation rows
> at all. Do not write the mapper against remembered column names. Export a real
> shop's CSV, commit it as a fixture, and map against that — the method
> `docs/chargebacks.md` established, where the live artefact wins over the
> documentation. If the export turns out to omit variations or images, the
> mapper says so per row in the report and the seller is told what to add by
> hand; it does not guess.

If Etsy sellers arrive in volume and the CSV proves too thin, the API becomes its
own spec with its own security posture — not a widening of this one.

### Gumroad / Lemon Squeezy / Paddle
Digital-first, so simple: product → `kind = 'digital'`, variants → variants,
files → **not** transferred automatically (see below), customers → `clients`.

## The four traps

**1. Do not import orders. Ever, by default.**
`invoices` is a numbered sequence a tax authority expects unbroken, and
`invoiceNextNumber` is claimed per order. Importing 4,000 historical Shopify
orders would either claim 4,000 invoice numbers for sales Sailo did not make, or
write orders with no invoice and break the sequence's meaning. Historical orders
also enter revenue rollups, the dispute rate denominator and every analytics
tile, none of which should describe a period Sailo was not the merchant for.

If a seller wants their history, the answer is a **read-only archive** — a
separate table, excluded from money and rate queries, out of scope here.

**2. Money is minor units, parsed not multiplied.**
Shopify prices are decimal strings (`"19.99"`), Stripe is minor units, Gumroad's
CSV is a decimal with a currency symbol. `PRODUCTION-PLAN.md` §2 item 1 is the
warning: a flat `/100` across 14 call sites turned ¥1,000 into ¥10 and charged a
KWD seller ten times over. Every amount goes through `parseMoneyToCents` with
the target currency. An import is a bulk write, so this bug arrives 200 times at
once.

**3. Remote images go through the SSRF guard at the write, then get re-hosted.**
Two reasons, and both have bitten this repo. `PRODUCTION-PLAN.md` §2 item 2 —
`apps/web/src/lib/og.tsx` fetched any URL it was handed and four writes had to be
fixed. And the storefront CSP plus `next.config.ts` only allow known image hosts,
so a `cdn.shopify.com` URL written straight into `product_images` renders as a
broken image. Fetch through the guard, cap the size, upload to Blob, store our
URL. Fail the row rather than the job when one image is unreachable.

**4. Import cannot grant marketing consent.**
The existing invariant, stated in both `addClient` and the API's `POST /contacts`:
consent is a thing a person gave, and a column in a CSV is a claim that they did.
Imported customers land with **no** `marketingConsentAt` unless the source
carries a real timestamp *and* a source, which Shopify does
(`email_marketing_consent.consent_updated_at` and `opt_in_level`) and Gumroad's
CSV does not. Where it is absent, they are contacts and not an audience — spec
34's Rule 1 then governs everything downstream.

**Files are not transferred.** A Gumroad or Shopify digital file lives behind
their auth; fetching it would mean holding a credential to pull arbitrary bytes.
The importer creates the product with `digitalDelivery` set and the file slot
empty, and the report says which products need a file uploaded. That list is the
seller's checklist.

## Behaviour

1. Pick a source. Paste a token, or (Stripe) nothing.
2. **Dry run, always.** Fetch, map, and show a preview: per row, will-create /
   will-update / will-skip and why. No writes. This is not optional — a bulk
   write with no preview is a bulk mistake.
3. Choose what to import; run. Chunked, resumable, with the source's rate limit
   respected — Shopify's Admin API is a leaky bucket and a naive loop gets
   throttled halfway through 200 products.
4. A report that stays: `import_jobs.report`, downloadable as CSV, listing every
   skipped and failed row with the reason. A silent partial import is worse than
   a failure.
5. Re-run is safe, through `import_links`.

## Details that must not be missed

- **Plan limits are enforced at import, and they say so.** A Free seller
  importing 200 products against a lower product ceiling gets a truncated import
  that **names the number left out** — rule 8, no silent caps — not a mystery.
- **Handle and slug collisions:** dedupe with a numeric suffix and report it. Two
  Shopify products with the same title are normal.
- **Rate-limit the job endpoint** per shop, and cap concurrent jobs at one. Two
  simultaneous imports of the same catalogue race on `import_links`.
- **Currency mismatch is a refusal, not a conversion.** A shop trading in EUR
  importing USD-priced Shopify products must be stopped at the preview and told,
  not silently converted at a rate nobody recorded.
- **A cancelled job leaves what it wrote.** Rows already created are real
  products; the report says which. Rolling back a bulk product write is a
  different and worse feature.
- Plan gate: **none for CSV, Etsy and Stripe** — Etsy is a CSV upload and it is
  the migration this product's own marketing promises, so gating it would be
  charging for the door. Shopify/Gumroad/LS/Paddle on Pro.
- 35-locale strings: the source picker, the preview verdicts, the report.

## Testing

Unit (pure, `plan.ts`, from fixtures of each source's real JSON **and Etsy's real
CSV**): Shopify option arity and variant mapping; Etsy two-property variations
with per-variation price and quantity, tags merged with materials, shop section →
category, a digital listing landing with an empty file slot; `requires_shipping = false` → digital; multi-location
inventory summed with a report line; smart-collection refusal; every money format
across USD, JPY (0 decimals) and KWD (3) through `parseMoneyToCents`; consent
mapped only where a timestamp and level exist; slug collision suffixing; plan
truncation naming the count.

Scenario: import 3 Shopify products with variants and images → products,
variants, re-hosted images, categories; re-run the same payload → updates, no
duplicates, counts say so; a row with an unreachable image fails that row and the
job completes; **no order or invoice row is written by any import**; a
currency-mismatched preview refuses before writing; two concurrent jobs → one
runs; an imported customer has no `marketingConsentAt` and is therefore not a
broadcast recipient.

## Done when

A Shopify seller pastes a token and an **Etsy seller drops in their listings
export**, both see exactly what will happen before anything is written, both get
their catalogue with variants, stock and images re-hosted, both can re-run it
safely, and both get a list of the files they still need to upload — with not one
invoice number, order or marketing consent invented anywhere in the process.

And the word "Etsy" in `layout.tsx`'s keywords stops being a claim with nothing
behind it.
