# 23 — CRM Upgrades (tags, manual contacts, filters, phone)

**Priority:** P3 · **Effort:** M · **Depends on:** 05 for the consent column
in imports; feeds 14 (audiences)

## What

Four small parity items on the Customers/Income surfaces, bundled because
they share the `clients` table. Reference: Stan's Customers filters
(Name/Email/Since/Purchases/Spent/Product/Active Subscription/Tag),
"Add Contacts", and its Income filter row.

## 1. Tags

- `clients.tags text[] default '{}'` (migration, production first) + a GIN
  index on it.
- Admin: add/remove tags inline on the client row and in bulk from the list;
  free-text with autocomplete over the shop's existing tags (one query,
  `select distinct unnest(tags)`).
- Normalise: trim, lowercase, max 32 chars, max 20 tags per client —
  enforced in the action.
- Clients list gains a tag filter; export CSV gains a `tags` column
  (semicolon-joined — the CSV writer in `src/lib/csv.ts` handles quoting).

## 2. Manual contacts + import

- "Add contact" form: name, email, optional phone/note/tags. Writes through
  `upsertClient` with `source: 'manual'` (column from spec 07; if 07 hasn't
  landed, this spec adds it).
- CSV import: email column required; dedupe by (shopId, email) via the
  existing upsert; row-level error report ("14 added, 2 skipped: invalid
  email line 7…"); hard cap 1,000 rows per import; rate-limit imports.
- **Consent is NOT importable.** Imported contacts get
  `marketingConsentAt = null` regardless of any CSV column — consent
  collected elsewhere can't be verified here, and spec 14 sends only to
  consented contacts. State this in the import UI copy so sellers aren't
  surprised later.

## 3. Income filters

The Income/orders list already filters some dimensions; add: coupon code
(join `orders.couponId` → `coupons.code`), payment method, status, and —
once spec 08 lands — a "has bump" toggle (`order_items.viaBump`). Filters
compose as WHERE clauses server-side with the existing pagination; no
client-side filtering of capped lists (silent-truncation rule).

## 4. Seller phone number

`user` has no phone column. Add nullable `phone text` via BetterAuth
`additionalFields` + migration, surfaced on the profile/settings identity
card, validated with the existing `normalizePhone` (`src/lib/utils.ts`).
Display-only v1 (no SMS anything).

## Details that must not be missed

- Tag writes and imports are shop-scoped — every query keyed by
  `requireShop()`'s id, never a client id from the form alone (IDOR).
- Import parsing happens server-side on a size-capped upload (reuse the
  upload route's limits); reject non-UTF8 gracefully.
- 35-locale admin strings for all four surfaces.

## Testing

Scenario: import a CSV with duplicates + junk rows → correct add/skip
report, no consent granted; tag filter returns exactly tagged clients;
coupon-code filter matches orders paid with that code. Unit: tag
normalisation, phone normalisation, CSV row validation.

## Done when

Tags filter and export, manual + CSV contacts land deduped without consent,
income filters compose server-side, and the profile holds a validated phone.
