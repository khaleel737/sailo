# Feature Specs — Stan-parity roadmap

One file per feature, written to be handed to an agent cold. Each spec says
what the feature is (with Stan's version as the reference), the exact tables
and files involved, the edge cases that will otherwise be missed, the tests
that prove it, and a "done when". Source: the 2026-08-10 gap analysis of
Stan Store's admin against this codebase — every "Sailo has / lacks" claim in
these files was verified in source, not assumed.

## Rules for every agent, before any spec

1. **A schema change is not shipped until its migration has run against
   production.** Hand-write `drizzle/NNNN_<name>.sql`, apply to prod first,
   then push code. Green build/tests/types prove nothing about the database.
2. **Verification gate before every commit:** `npx tsc --noEmit` →
   `npx vitest run` → scenario suite (`./scripts/scenarios/up.sh` then
   `npx vitest run --config vitest.scenarios.mts`) → `npm run build` →
   `npx oxlint` → `npx knip`. Money-path changes need scenario coverage, not
   just unit tests.
3. **i18n is total.** Admin strings: keys in all 35 `src/i18n/admin/*.ts`.
   Storefront strings: all 35 `src/i18n/dictionaries/*.ts`. `en.ts` is the
   typed source; missing keys are compile errors — use that.
4. **Concurrent agents work in this tree.** Stage explicit paths only —
   never `git add -A`. Check `git status` before staging; leave others'
   files alone.
5. **Every public route carries a rate limit** (`rateLimit` /
   `refundRateLimit` in `src/lib/redis.ts`). Throttled is *unknown*, never a
   negative answer; budgets for guessing secrets charge misses, not
   lookups; no response may be an existence oracle.
6. **Money invariants:** claims are conditional UPDATEs (ceiling in the
   WHERE), webhooks are idempotent and ownership-checked
   (`src/lib/stripe-webhooks/ownership.ts` is the seam), ledger rows are
   append-only, order *lines* not order headers, blank ≠ zero.
7. **Check the six recurring bug shapes** (see auto-memory / PR history):
   half-updated function pairs, guard applied at one sink not its twin,
   check-then-act gaps, header-vs-lines, blank-vs-zero, throttled-as-no.
8. **Plan gating** goes through `src/lib/plans.ts` (`Features`/`Limits`,
   `can(shop, ...)`, `cheapestPlanWith`) with the existing upgrade-modal
   pattern. No silent caps — clamped or truncated output says so.
9. **Storefront caching:** public pages are `"use cache"` +
   `cacheTag(shopTag(shopId))`; any write that changes what a storefront
   shows must revalidate the tag.
10. **Never point write-tests at production.** The scenario stack refuses
    non-local databases; keep it that way in anything new.

## The specs

| # | Spec | Tier | Effort | Status / notes |
|---|------|------|--------|----------------|
| 01 | Two-factor authentication | P0 | S | Ready. Named priority. |
| 02 | Login session history | P0 | S | Ready. Session table already has IP/UA. |
| 03 | Account deletion | P0 | M | Ready. Ledger-retention rules inside. |
| 04 | Seller notifications + prefs | P0 | M | Ready. Highest-value gap. |
| 05 | Checkout compliance (T&C + consent) | P1 | S–M | Ready. Blocks 14. |
| 06 | Recurring memberships | P1 | XL | Ready. Largest revenue feature. |
| 07 | Lead capture + Leads metric | P1 | M | Ready. After 05. |
| 08 | Order bumps | P2 | M | Ready. |
| 09 | Marketing pixels | P2 | M | **In flight** — another agent started `src/lib/shop-pixels.ts` (ga4/gtm/meta/tiktok). Reconcile: spec's CSP scoping, storefront consent, and purchase events still apply. |
| 10 | Outbound click tracking | P2 | S | Ready. |
| 11 | Analytics upgrades | P2 | S | Ready. Leads tile needs 07. |
| 12 | Payout visibility | P2 | S | Ready. |
| 13 | Refer-a-creator | P2 | M–L | Ready. Distinct from product affiliates. |
| 14 | Email broadcasts & flows | P2–3 | L | Needs 05 first. Legal floor inside. |
| 15 | Landing pages / funnels | P3 | L | Ready. |
| 16 | Outbound webhooks | P3 | M | Ready. SSRF rules inside. |
| 17 | Booking integrations (GCal, Zoom) | P3 | L | Ready. Fail-open rules inside. |
| 18 | eCourse | P3 | XL | Video-hosting decision recorded inside. |
| 19 | Community | P4 | XL | **Decision spec** — recommends defer or Discord-gate via 06. |
| 20 | Webinar | P3 | M | Ready. Capacity via atomic claim. |
| 21 | Media embeds (YouTube/Spotify) | P3 | S | Ready. Feeds 15. |
| 22 | Onboarding checklist | P3 | S | Ready. Computed, no migration. |
| 23 | CRM upgrades (tags/import/filters/phone) | P3 | M | Ready. |
| 24 | PayPal rail | P4 | XL | **Decision spec** — recommends defer; read before assigning. |
| 25 | AutoDM (Instagram) | P4 | L | **Blocked on Meta app review** — human task first. |
| 26 | Education hub | P4 | S+content | Ready; content is the real work. |

Already at parity (do not build): CSV export, coupons, storefront theming
(accent/theme/layout), 35-language admin+storefront, powered-by removal
(`removeBadge` plan flag), automatic payouts via Stripe Connect (12 only
*surfaces* them), product affiliates, invoices, reviews, tax, physical
goods, manual rails, booking engine.

## Suggested assignment order

01+02 together (one Security tab) → 03 → 04 → 05 → 07 → 06 → 12 → 11 → 10 →
08 → 13 → 22 → 21 → 15 → 16 → 20 → 17 → 23 → 14 → 18 → then the P4
decision specs with the owner in the room.
