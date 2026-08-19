> **Retired 2026-08-19, replaced by `33-preorders-and-back-in-stock.md`.**
> A waitlist is a digital-launch instrument — availability is a date the
> creator picks. Sailo's sellers ship things, and their version of this
> moment is stock reaching zero. The reasoning is in `RESHAPE-2026-08.md`.
> Kept here as the record of a decision, not as work.

# 33 — Waitlists

**Priority:** P2 · **Effort:** M · **Depends on:** 43 (sell windows, for the
"not released yet" case) · **Blocks:** nothing

## What

When a product cannot be bought — sold out, or not on sale yet — the checkout
offers to take an email instead. Reference: Easytools Store → Waitlists, in
`llms-full.txt` §`enabling-waitlist` / `managing-waitlist`.

## The thing their docs admit, and what we do about it

> *"We won't send any automatic notifications to your waitlist on your behalf.
> To contact users who signed up, you can: Download CSV and manually import the
> data into your email marketing tool."*

A waitlist that cannot mail the list is a CSV with extra steps. Sailo ships the
notification, and after spec 30 that costs almost nothing: `waitlist.signup` is
an automation trigger, and **back in stock** is one more.

That inverts the value. Their waitlist captures demand; ours converts it.

## Data model (migration, production first)

`drizzle/NNNN_waitlists.sql`.

```
waitlist_entries  id, shop_id → shops(cascade),
                  product_id → products(cascade),
                  variant_id → product_variants(set null),
                  client_id → clients(set null),
                  email text not null, name text,
                  notified_at timestamp,
                  converted_order_id → orders(set null),
                  marketing_consent_at timestamp,
                  created_at default now()
                  unique (product_id, email)
                  idx (shop_id, created_at)
                  idx (product_id) WHERE notified_at IS NULL
```

`products` gains `waitlistEnabled boolean default false`.

No `waitlists` parent table. A waitlist is not an object a seller creates — it
is the set of entries against a product, which is exactly how their dashboard
reads ("All products with created waitlists will show up here"). A parent row
would need creating, naming and deleting, and would be able to disagree with
`products.waitlistEnabled` about whether the list exists.

`unique (product_id, email)` on purpose: signing up twice is a no-op, not a
duplicate, and it means the form can never become a membership oracle.

## Behaviour

**When it shows.** Theirs: the product is unavailable *and* the waitlist is
enabled. Sailo's unavailability, precisely:

- `trackInventory` and `stockQuantity <= 0` (their "limited quantities" case);
- outside a sell window (spec 43) — before `sellFrom`, after `sellUntil`;
- `event` past `eventStartsAt`, where sales already close;
- **not** `isPublished = false`. A draft renders `notFound()` and must keep
  doing so: an unpublished product's title and price are not public, and spec
  10 in `PRODUCTION-PLAN.md` §2 was exactly this leak through an OG image.

**The form.** Email, optional name, optional marketing-consent checkbox — and
consent is a separate thing from joining the list, the invariant spec 05
established and the API's `POST /contacts` restates: *consent is a thing a
person gave.* Joining a waitlist consents to being told about **this product**
and nothing else.

**The answer is always the same sentence** whether the address was new, already
on the list, or suppressed. The subscribe page (spec 14) set this precedent and
the reason is the same: the form reads no rows a caller can distinguish.

**Notifying.** Two paths, and both are the same write:

1. Automatic — a product becomes available (stock rises above zero with
   `trackInventory` on, or a `sellFrom` passes). A cron detects the edge and
   emits `waitlist.available`.
2. Manual — the seller presses "Notify waitlist" on the product.

Either way: one mail per entry, `notified_at` claimed in a **conditional
UPDATE** so two ticks mail once, carrying a link to the product. Counted
against the broadcast quota and checked against suppressions like any other
bulk send.

**Conversion.** When a notified entry's email later places a paid order for
that product, set `converted_order_id`. That is the only number that makes the
dashboard worth opening: signups are vanity, conversions are not.

**Dashboard.** Store → Waitlists: products with entries, active/inactive
filter, count, notified count, converted count. Drill in for entries with date
filter, search and CSV download — theirs has all four and they are right.

## Details that must not be missed

- **A waitlist does not hold stock.** Being first on the list buys nothing.
  Say so in the notification, because the alternative is a seller fielding
  "but I was told" mail. First-come at the checkout, as always.
- **Notify is rate-limited and plan-gated** on the broadcast ceilings, not a
  new one. A 40,000-entry list is a bulk send wearing a different name.
- **Variant granularity:** `variant_id` nullable. A buyer waiting on "size M"
  must not be mailed when only XL returns. Where the entry names a variant, the
  availability edge is that variant's.
- **Storefront cache.** The product page is `"use cache"` + `cacheTag(shopTag)`.
  Stock crossing zero already revalidates; confirm the waitlist form appearing
  and disappearing rides that same tag, or the form will be stale in both
  directions — offering a waitlist for something in stock, and hiding it for
  something sold out.
- **Deleting a product cascades the entries.** Correct: there is nothing to be
  waiting for. But the seller should be told the count before confirming.
- 35-locale strings: form, success sentence, notification email, dashboard.

## Testing

Unit: the availability predicate over every combination of `trackInventory`,
`stockQuantity`, sell window, `isPublished` and product kind — with a table
test, because this predicate is the whole feature and it has five inputs.

Scenario: form appears only when unavailable and never for a draft; duplicate
signup is a no-op with the same response; suppressed address is not mailed;
stock rising fires one mail per entry under two concurrent ticks; a
variant-scoped entry is not mailed for a different variant; a subsequent paid
order sets `converted_order_id`; CSV export escapes a formula-injection name
(the existing rule).

## Done when

A sold-out product takes emails, a restock mails everyone once, the dashboard
shows signups → notified → converted, `waitlist.signup` is a live automation
trigger, and no waitlist form ever appears on an unpublished product.
