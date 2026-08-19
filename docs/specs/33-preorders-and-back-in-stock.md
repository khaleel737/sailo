# 33 — Preorders and back-in-stock

**Priority:** P1 · **Effort:** M · **Depends on:** nothing ·
**Blocks:** nothing · **Replaces:** the waitlist spec

## What

Two answers to the same moment — a buyer wants something there is none of.

- **Back in stock.** They leave a contact against the variant. When stock
  crosses zero upward, they hear about it once.
- **Preorder.** The seller takes the order now, against stock they do not have,
  with a date shown before the buyer commits.

## Why this and not a waitlist

A waitlist is a digital-launch instrument: *join the list, I'll tell you when my
course opens.* It exists because a course has no stock — availability is a date
the creator picks, and the list is how they build anticipation for it.

Sailo's sellers ship things. The equivalent moment is not a launch, it is **the
last blue medium selling on a Tuesday**, and today it has two bad outcomes: the
seller hides the product and loses everyone, or leaves it reading "out of stock"
and loses the buyer who would happily have waited eleven days.

The model is already here. `products.trackInventory`, `products.stockQuantity`,
`products.inStock`, and `product_variants.stockQuantity` /
`product_variants.isAvailable` all exist and are enforced by `reserveStock` in
`packages/commerce/src/catalog/inventory.ts`. Nothing in this spec invents an
availability concept; it reads the one the catalogue already has.

## Preorders on the card rail

Stripe is the priority rail and the US and EU are the markets, so this is the
case to design for first.

**Charge at checkout, like any other order.** That is the ordinary commerce
answer and what every Shopify preorder does. The alternative — authorise now,
hold, watch it expire in seven days, re-authorise, and decide what happens when
the re-authorisation fails after the buyer was promised the goods — is most of a
feature for very little.

What charging up front buys is a **duty**, not machinery, and it is the whole of
the risk:

- **The expected date is shown before the buyer commits, and recorded on the
  order.** A card payment for goods that arrive six weeks later is a chargeback
  waiting to happen if the buyer was never told six weeks.
- **Spec 44 already answers that dispute**, and it is in the tree: the policy the
  buyer agreed to (`policy_snapshots`), what they were told (`order_messages`),
  and when it arrived (`orders.delivered_at` with its source). Record the
  promised date the same way, so a `product_not_received` case can show what was
  *promised* rather than what was hoped.
- **The checkout must state that a refund policy exists** for a preorder that
  never ships. What it says is the seller's business; that it exists is not.

On the chat and manual rails this is simpler still — no money moves at checkout
there, so a preorder is an ordinary order with a promised date on it.

## Data model (migration, production first)

`drizzle/NNNN_preorders.sql` — the number is assigned in `HANDOFF-2026-08.md`.

```
stock_requests   id
                 shop_id      uuid → shops(cascade)      not null
                 product_id   uuid → products(cascade)   not null
                 -- Null only for a product sold as one thing.
                 variant_id   uuid → product_variants(cascade)
                 email        text
                 phone        text
                 locale       text
                 -- Where they were standing, for the notification's language
                 -- and for the seller to see the demand is real.
                 created_at   timestamp default now()
                 notified_at  timestamp
                 -- Set when the notification actually went. Null means owed.
                 unique (product_id, variant_id, email) where email is not null
                 unique (product_id, variant_id, phone) where phone is not null
                 idx (shop_id, created_at)
                 idx (product_id, variant_id) where notified_at is null

products
  preorder_enabled     boolean default false not null
  -- What the buyer is told before they commit. Null means "no date given",
  -- which is honest and must render as that rather than as blank.
  preorder_expected_at timestamp
  -- A ceiling on preorders, separate from stock. Null is uncapped.
  preorder_limit       integer

product_variants
  preorder_expected_at timestamp
  preorder_limit       integer

orders
  -- Set at checkout when any line was taken against absent stock. A flag on the
  -- order, not only the line, because the seller's list has to show it without
  -- a join and the confirmation email has to say it.
  is_preorder          boolean default false not null
```

### Two partial unique indexes, not one

Same reason `policy_snapshots` needed two in `0035`: Postgres treats NULLs as
distinct, so a single `unique (product_id, variant_id, email, phone)` lets one
person register five times by leaving phone null each time. A contact may hold
**one** open request per variant, and "contact" means whichever of the two they
gave.

### `variant_id` is the subject, not `product_id`

"Tell me when the blue medium is back" is the request. Notifying that person
because the **red** one arrived is the failure mode, and it is the one that
turns a helpful message into a complaint. Every read and every notification is
keyed on the variant; the product is there for the join and the seller's list.

## Back in stock

### Asking

On the storefront, where "Out of stock" is rendered today. One field — **email,
or phone where the shop takes chat orders.** Email is the common case on a card
shop and the notification below needs one; phone is accepted because a shop
running chat rails has buyers who never gave an address, and refusing them a
place in the queue is refusing a sale.

### Telling

The trigger is **stock crossing zero upward**, which happens in exactly one
place: a seller raising `stockQuantity`. Do not poll.

The claim is the same shape as every other claim in this codebase — conditional
UPDATE with the ceiling in the WHERE, `returning` to say who won:

```sql
update stock_requests set notified_at = now()
where product_id = $1 and variant_id is not distinct from $2
  and notified_at is null
returning id, email, phone, locale
```

`is not distinct from`, not `=`, because `variant_id` is null for a product sold
as one thing and `null = null` is null.

**One notification per request, ever.** The row is spent when it is claimed; a
buyer who wants telling again asks again. A seller who restocks on Monday,
sells out by lunch and restocks on Wednesday must not send the same person two
messages in three days — that is the behaviour that gets a sending domain
reported.

**Send order is oldest first**, and say so on the seller's screen. If 40 people
are waiting for 12 units, the fair reading of "I asked first" is the only one
that does not need explaining.

**It is not a reservation, and the message must not imply one.** Anybody can buy
the restocked unit; being told first is the whole of what was promised. Copy
that says "your item is ready" when it is not held for them is the lie this
paragraph exists to prevent.

### Channels

Email where there is an address. Where there is only a phone, **Sailo does not
send** — there is no WhatsApp Business API here and no SMS provider, and
pretending otherwise would be a promise the platform cannot keep.

Instead the seller's screen lists the phone-only requests with a **compose
link** — `wa.me` with the message pre-filled, exactly the handoff the checkout
already uses. The seller presses send, from their own number, in a thread the
buyer recognises. That reaches every country, costs nothing, needs no approval,
and is more likely to be read than any email.

## Preorder

### Buying

When `preorder_enabled` and stock is zero, the buy button says **"Preorder"**
and the expected date sits beside it, before the buyer commits. No date shown
means no date promised — render the absence, never a blank.

`reserveStock` must not be bypassed. The clean shape is to let it fail as it
does today and have the caller decide: a failed reservation on a preorder-
enabled product is a preorder, and everything else is out of stock. That keeps
one stock claim in the codebase rather than two, and the existing one is already
race-free.

`preorder_limit` is its own conditional claim, counted against open preorders
for that variant. Uncapped by default.

### After

The order is ordinary: it appears in the seller's list, on their dashboard,
against their revenue, with `is_preorder` set. **It is not a different order
type and it does not get a different status** — `ORDER_STATUSES` stays as it is.
The enum's own header records what happened last time a copy of it drifted, and
spec 44 declined to add `delivered` for the same reason. A preorder becomes an
ordinary fulfilment the day stock arrives.

The confirmation email says what was promised, including the date, and says it
in the language the buyer was shopping in.

## Details that must not be missed

- **Both writes are public and unauthenticated.** Decision B
  (`RELEASE-PLAN-2026-08.md` §0.6): the stock request is a public write and
  **fails closed** — `rateLimit(key, n, w, { onOutage: "closed" })`. Read
  `verdict.reason`: an outage refusal is not an answer about the product, and
  the copy must say "try again shortly" rather than anything about stock.
- **Neither surface is an existence oracle.** "You'll hear from us" is the
  answer whether or not the row was written, whether or not that contact was
  already waiting, and whether or not the variant exists. A response that
  differs is a way to test which of a seller's variants exist and who is
  watching them.
- **The seller's count is a number about their shop, not about people.** Show
  "23 waiting" and the contact list; do not show a buyer that 23 others are
  waiting, which is a nudge built out of somebody else's data.
- **`stock_requests` is not a marketing list.** These people asked to be told
  about one thing. Rolling them into `34`'s contacts as subscribers is consent
  laundering and the suppression rules in
  `packages/marketing/src/broadcasts/` exist to prevent exactly it. A separate,
  explicit opt-in on the same form is fine — pre-ticked is not.
- **Deleting a product takes its requests** (`cascade`) and that is correct: a
  notification about a product that no longer exists has nothing to link to.
- **Restock must not become a send loop.** The claim above is what prevents it;
  the daily ceiling in `packages/workflows/src/orders/notify-seller.ts` is the
  backstop. A seller adjusting stock in a spreadsheet-like screen may cross zero
  several times in a minute.
- **Plan gate:** none on back-in-stock. It costs a row and it is how a small
  seller keeps a sale they would otherwise lose; gating it would price the
  cheapest shops out of their own demand. Preorders may carry one if the owner
  wants it.
- **35 locales.** The storefront strings (ask, confirm, preorder button,
  expected date, no-date case) and the admin strings. `en.ts` first, then
  `npm run i18n:fill` — never hand-edit 34 files.

## Testing

**Unit:** the notification claim is idempotent; `is not distinct from` matches
a null variant; the ordering is oldest-first; a preorder line is detected from a
failed reservation rather than from a second stock read.

**Scenario:** two contacts waiting on different variants of one product, restock
one, exactly one is notified and the other row is untouched; a concurrent
restock notifies each waiting contact exactly once; a second restock notifies
nobody a second time; a preorder places an ordinary order with `is_preorder`
set and no stock movement; `preorder_limit` refuses the n+1th under
concurrency; the public write answers identically for a real and an invented
variant id.

**Browser:** the out-of-stock product shows the ask; the preorder product shows
the date before the button; a product with no date shows the absence and not a
blank.

## Done when

A buyer who finds the blue medium sold out can either be told when it returns or
buy it now with a date they were shown first; the seller sees who is waiting and
can reach the phone-only ones through WhatsApp in one tap; nobody is notified
twice; and nobody is told their item is ready when it is merely available.
