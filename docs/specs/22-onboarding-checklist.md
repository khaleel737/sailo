# 22 — Onboarding Checklist

**Priority:** P3 · **Effort:** S · **Depends on:** nothing

## What

A "Store setup — N/4" card on the admin dashboard with linked steps that tick
themselves off as the underlying data appears. Reference: Stan's Home card:
Add profile photo → Connect socials → Set up direct deposit → Create first
product.

## Design: computed, never stored

Each step derives from data that already exists — no `onboardingState`
column, no migration, nothing to drift:

| Step | Truth |
|---|---|
| Add your photo | `shops.avatarUrl` or `logoUrl` set |
| Connect a social | `shops.socials` non-empty |
| Turn on a way to get paid | any enabled row in `paymentMethods` (or `stripeAccountId` present) |
| Add your first product | any product row |
| Publish your shop | `shops.isPublished` |

Five steps (one more than Stan — publishing is Sailo's real finish line).
One query in the dashboard's existing server component; the card renders
only while incomplete, plus a dismiss that stores a flag in `localStorage`
(client-side, like the consent choice — a dismissed checklist is
preference, not data).

## Details that must not be missed

- Each row links to the exact page that completes it (settings identity
  card, settings socials, payments, product create, publish card).
- The paid-rail step must count manual rails, not just Stripe — a
  COD-only seller is fully set up (this is Sailo's differentiator; don't
  copy Stan's Stripe-centric step blindly).
- Completion is instant on revisit because it's computed — no cache
  invalidation to forget. If the dashboard route is cached, confirm the
  card reads fresh (dashboard is per-seller/dynamic already).
- 35-locale admin strings; the count ("2/5") uses the localised number
  formatting the admin already uses.
- No emails, no nagging — the card is the whole feature.

## Testing

Unit on the derivation function (each step true/false from fixture shop
shapes). One RTL-safe render check is overkill; the derivation test is the
substance.

## Done when

A fresh seller sees 0/5 with working links, the ticks appear as data lands,
a COD seller reaches 5/5 without Stripe, and dismiss sticks per browser.
