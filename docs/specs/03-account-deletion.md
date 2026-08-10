# 03 — Self-Serve Account Deletion

**Priority:** P0 · **Effort:** M · **Depends on:** 02 (lives in the same tab)

## What

A "Delete My Account" flow at the bottom of Settings → Security: explicit
warning, typed confirmation, then the account and store are gone and every
session dies. Reference: Stan's "Request Account Deletion" block.

## Why this is NOT a one-line cascade

`shops.userId` cascades from `user` (`src/db/schema/shop.ts:14`), and most of
the catalogue cascades from `shops` — so a naive `DELETE FROM "user"` *would*
run. It would also be wrong three ways:

1. **Invoices are legally retained.** The invoice sequence is per-shop and tax
   authorities expect it unbroken (see the invoicing comments in
   `src/lib/actions/orders.ts`). Deleting a shop must NOT delete issued
   invoices/orders that document real money movement.
2. **Stripe objects outlive us.** The seller's platform subscription
   (`src/lib/actions/billing.ts`) must be cancelled at Stripe first, or they
   keep being charged for a store that no longer exists. The Connect account
   belongs to the seller — do not deactivate it, just disconnect.
3. **Blobs leak.** Product images and files live in Vercel Blob; rows
   cascading does not delete the objects. Collect URLs before the delete and
   remove them after.

## Design: anonymise the ledger, delete the rest

- New server action `deleteAccount` requiring: current password (or a fresh
  magic-link re-auth), a typed confirmation of the shop handle, and a rate
  limit (3/day per user).
- Order of operations, each step idempotent so a retry after a mid-way crash
  completes rather than corrupts:
  1. Cancel the platform Stripe subscription (if any). Verify by re-reading it.
  2. Snapshot blob URLs (product images, product files, avatars/logos).
  3. **Anonymise, don't delete, the money ledger:** orders, order_items,
     invoices, refunds keep their rows; strip PII (customerName → "Deleted
     buyer" is wrong — buyers didn't ask to be deleted; keep buyer PII, strip
     nothing there). What gets anonymised is the *seller*: user row's name and
     email are replaced with a tombstone (`deleted-<id>@sailo.invalid`), shop
     handle is released (renamed to `deleted-<id>`), `isPublished = false`.
  4. Hard-delete everything that is not ledger: products, files, images,
     variants, categories, coupons, delivery methods, reviews, visits,
     booking claims, affiliate rows, support tickets, sessions, accounts
     (auth), passkeys/2FA rows.
  5. Delete the snapshotted blobs (best-effort, log failures).
  6. Revoke all sessions last (the actor's own session dies here).
- Because ledger rows survive, the `shops` row must survive (FKs). The
  tombstoned shop is the retention container. Add `deletedAt` to `shops`
  (migration, production first) and exclude `deletedAt IS NOT NULL` from every
  public query path — grep for `isPublished` to find them; the storefront 404s
  the handle either way once unpublished + renamed.
- Buyers keep working: their invoice URLs and download tokens for *already
  purchased* digital goods should keep working (files are gone if we delete
  blobs — decision: keep product **files** for 90 days after deletion, delete
  images immediately; encode the 90-day sweep as a cron TODO in the PR).

## Details that must not be missed

- Confirmation email to the tombstoned address BEFORE overwriting it ("your
  account was deleted; reply within 30 days if this wasn't you" — with support
  contact), since after the overwrite we cannot reach them.
- HQ staff view (`src/app/hq/`) must render tombstoned accounts sanely.
- The action must refuse while the shop has an order in `new`/`confirmed` with
  `paymentStatus = 'paid'` and undelivered obligations (paid booking in the
  future, paid physical order unshipped) — deleting mid-obligation is seller
  fraud tooling. Message: fulfil or refund first.
- i18n: all strings in 35 admin locales.

## Testing

Scenario suite: create a full shop (product, image, coupon, order via
`createOrderIntent`, invoice), delete, then assert: invoice row survives with
sequence intact; product rows gone; handle re-registrable; sessions dead;
public queries never return the tombstone; the refusal fires for an open paid
booking.

## Done when

Deletion is refused while obligations are open, completes idempotently
otherwise, ledger + sequence survive, blobs cleaned, sessions revoked, and the
scenario proves each of those.
