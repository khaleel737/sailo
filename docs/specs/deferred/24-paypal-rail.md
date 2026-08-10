# 24 — PayPal Rail

**Priority:** P4 (decision required before any code) · **Effort:** XL

## What

Buyers pay with PayPal alongside cards and manual rails. Reference: Stan's
"+ Add PayPal" under Payment Methods.

## Read this before assigning

PayPal is not "another button". It is a **second payment platform** running
parallel to everything Stripe Connect provides today:

- Marketplace money movement needs **PayPal Commerce Platform** (partner
  onboarding of each seller's PayPal account, like Connect onboarding).
- A second webhook infrastructure: signature verification, idempotency,
  ownership seam — the entire `src/lib/stripe-webhooks/` architecture again
  with PayPal semantics (and PayPal's webhook signing is fussier).
- A second settlement path through orders: `handOffToStripe` has a sibling,
  the sweep gets a third rail case, refunds get a second implementation,
  `claimRefundAmount` semantics must hold across both.
- Disputes/chargebacks arrive through PayPal's own flow.

The scenario suite, card-e2e run, and the whole "money path exercised for
real" discipline would need a PayPal twin. Estimate honestly: this is the
size of the original card-rail build.

## Recommendation

Defer until sellers ask with volume. The manual rails already cover
buyers-without-cards (Sailo's actual differentiator), and card coverage is
global through Stripe. If demand materialises, v1 scope: one-time payments
only (no memberships), PCP partner onboarding, capture-on-order,
webhook-driven settlement mirroring the connect module's structure
file-for-file, and the same scenario coverage before production.

## Done when (if built)

A PayPal order settles, refunds, and sweeps with the same invariants the
scenario suite pins for cards — nothing less clears the bar for a money
path in this repo.
