# Feature Specs — the build list

One file per feature, written to be handed to an agent cold. Each spec says
what the feature is, the exact tables and files involved, the edge cases
that will otherwise be missed, the tests that prove it, and a "done when".
Every "Sailo has / lacks" claim was verified in source during the
2026-08-10 gap analysis, not assumed.

**Everything in this folder is wanted.** Specs we decided not to pursue live
in `deferred/` and are not work — do not pick them up without the owner
saying so.

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

## Build order

Work top to bottom unless the owner reorders. 01+02 ship together (one
Security tab).

| Order | Spec | Effort | Notes |
|---|---|---|---|
| 1 | `01-two-factor-authentication.md` | S | Named priority |
| 2 | `02-login-sessions.md` | S | Same tab as 01; data already exists |
| 3 | `03-account-deletion.md` | M | Ledger-retention rules inside |
| 4 | `04-seller-notifications.md` | M | Highest-value gap — sellers get no order emails today |
| 5 | `05-checkout-compliance.md` | S–M | T&C + consent; prerequisite for 14 |
| 6 | `07-lead-capture.md` | M | After 05 (consent column) |
| 7 | `06-recurring-memberships.md` | XL | Largest revenue feature |
| 8 | `12-payout-visibility.md` | S | Stripe balance + requirements banner |
| 9 | `11-analytics-upgrades.md` | S | Per-product conversion, custom ranges |
| 10 | `10-outbound-clicks.md` | S | "Where do my customers go" |
| 11 | `08-order-bumps.md` | M | Checkout upsell |
| 12 | `09-marketing-pixels.md` | M | **In flight** (`src/lib/shop-pixels.ts` exists) — remaining: CSP scoping, storefront consent, purchase events |
| 13 | `13-refer-a-creator.md` | M–L | Distinct from product affiliates |
| 14 | `22-onboarding-checklist.md` | S | Computed, no migration |
| 15 | `21-media-embeds.md` | S | YouTube/Spotify; feeds 15 |
| 16 | `15-landing-pages.md` | L | Funnels phase 2 inside |
| 17 | `16-outbound-webhooks.md` | M | Zapier substrate; SSRF rules inside |
| 18 | `20-webinar.md` | M | Capacity via atomic claim |
| 19 | `17-booking-integrations.md` | L | GCal busy-sync + Zoom; fail-open rules |
| 20 | `23-crm-upgrades.md` | M | Tags, import, filters, phone |
| 21 | `14-email-broadcasts.md` | L | Needs 05; legal floor inside |

## Deferred (`deferred/` — not work)

| Spec | Why it's parked |
|---|---|
| `18-ecourse.md` | Not needed — not Sailo's product direction now |
| `19-community.md` | Covered better by 06: memberships can gate a Discord/WhatsApp invite |
| `24-paypal-rail.md` | A second payment platform; Stripe + manual rails cover buyers |
| `25-autodm.md` | Blocked on Meta app review — a human/business task, not agent work |
| `26-education-hub.md` | We have education (blog programme, onboarding); no in-admin hub needed |

Already at parity (do not build): CSV export, coupons, storefront theming,
35-language admin+storefront, powered-by removal (`removeBadge`), automatic
payouts via Stripe Connect (12 only *surfaces* them), product affiliates,
invoices, reviews, tax, physical goods, manual rails, booking engine.
