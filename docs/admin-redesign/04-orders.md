# 04 · Orders

**0.5s shape:** a table you triage — tabs, counts, badges, money right-aligned.
Detail page = the story of one sale, told in full: what was bought, where it
is, where the money stands, who bought it, and what happened when.

## Digested captures
- Orders empty: illustrated card + Create order (**More actions** dropdown in
  header: import/export live there, not as two buttons).
- **Abandoned checkouts** = child of Orders in the nav; page = explainer card +
  "Recover sales" recovery-email card w/ Review email button.
- Order ID format (#1001) from General; order rows use it everywhere.
- From saved Orders page: tabs (All/Unfulfilled/Unpaid/Open/Archived),
  **bulk checkboxes + selection action bar**, column sort, fulfillment chips.
- Shopify order detail: fulfillment is a **card with a primary act** ("Fulfill
  item" / "Add tracking"), never a quiet toggle; timeline runs down the page;
  the right rail holds Notes, Customer, Contact, Shipping address, Billing
  address, Conversion summary — every recorded fact has a home.

## Sailo status
Built & verified: tabs w/ DB counts + sliding pill, search, 6-col table→cards,
detail page (items/fulfilment/payment+chase/customer/delete), abandoned page
(parallel agent). KEEP the frame.

## Why the detail page is thin — the audit (2026-08)
The detail page was carved out of the old inline list and shows what the list
showed. The schema outgrew it. Recorded on every order and **shown nowhere**:

| Fact | Column(s) | Where it should live |
|---|---|---|
| Shipped / delivered **dates** | `shippedAt`, `deliveredAt`, `deliverySignedBy` | Fulfilment card + timeline |
| Checkout question answers | `customFields` (jsonb Q&A) | Customer card — sellers ask, then can't read the answers |
| Confirmation email fact | `confirmationSentAt` | Timeline |
| Terms agreement | `termsAcceptedAt` + snapshot ids | Customer card footer |
| Statement descriptor | `statementDescriptor` | Payment card — the "unrecognized charge" answer |
| Buyer tax ID / reverse charge | `buyerTaxId`, `buyerTaxIdType`, `taxReverseCharge` | Payment card (reverse-charge notice is a legal fact) |
| Preorder promise | `isPreorder`, `preorderExpectedAt` | Items card chip |
| Restock outcome | `restockedAt`, `restockDeclined` | Refund row footnote |
| Membership linkage | `subscriptionId`, `membershipPeriodEnd`, `stripeInvoiceId` | Header chip → "renewal · covers until {date}" |
| Per-line arithmetic | `unitPriceCents` × qty, `sku`, line `kind` | Items card lines |
| Full postal address | address columns (now collapsed to one line) | Fulfilment card, multi-line + copy |
| Stripe trail | `stripePaymentIntentId` | Payment card link-out to the Stripe dashboard |

**The tracking bug (the literal complaint):** `OrderActions` offers Add
tracking only when `order.deliveryMethod === "shipping"`. Orders written
before delivery methods existed — and shops that never configured one — carry
`deliveryMethod = null` on physical goods, so a seller with a parcel to send
has no way to record the shipment. Gate must be
`productKind === "physical" || deliveryMethod === "shipping"`, and the act
must be promoted: an unfulfilled physical order shows the carrier/number/link
fields as the card's **open primary form** (Shopify's fulfill card), not
behind a small toggle.

**Known dead column:** `paymentProofUrl` has no writer (buyer upload never
shipped; wire excludes it deliberately). Do NOT build a surface for it —
flagged as a product gap, follow-up owns the upload flow first.

**No `paidAt` column exists.** Timeline shows only facts with real
timestamps; "paid" renders from `paymentStatus` without a date until a
migration adds one (NOT in this phase — migrations are the peer's lane).

## Order detail v2 — the scope
Header: human number `#{invoicePrefix}-{n}` when the invoice exists, short id
fallback; title becomes the secondary line. Status + payment chips (have).
Prev/next record arrows (shared primitive with products P5). ⋯ menu: evidence
pack + delete move here (delete leaves the page bottom).

Main column:
1. **Items v2** — thumbnail, `sku`, `{unit} × {qty}` math per line, kind icon
   for digital/service lines, preorder chip w/ promised date. Money summary
   unchanged; refund row gains restock footnote (`restockedAt` /
   `restockDeclined` → "not restocked — seller's call").
2. **Fulfilment v2** — gate fix + promoted form (above); `shippedAt` /
   `deliveredAt` dates beside their facts, `deliverySignedBy` when present;
   full multi-line address with copy button; digital release/expiry dates;
   `serviceLocation` on bookings. Boxes panel stays.
3. **Timeline** — quiet vertical list assembled from real timestamps only:
   placed → confirmation sent → terms accepted → shipped → delivered (+source)
   → refunded → restocked → files released → membership covers-until. No new
   table, no synthetic events.

Rail:
4. **Payment v2** — statement descriptor line; buyer tax ID + reverse-charge
   notice when `taxReverseCharge`; Stripe payment link-out on card orders;
   transfer ref + confirm + chase (have); invoice (have).
5. **Customer v2** — contact (have) + **checkout answers** Q&A block from
   `customFields` (label: the seller's own question text, snapshotted) +
   terms-accepted footer line.
6. **Membership chip** — when `subscriptionId`: renewal badge in header meta,
   "covers until {membershipPeriodEnd}" in payment card.

## Bulk actions — the scope
List page grows a checkbox column (rows + select-page-all). Selection swaps
the tabs row for a **selection bar**: `{n} selected · [Mark as paid] [Mark as
shipped] [Mark completed] [Export] · Clear`. Shopify's grammar: the bar
replaces, never stacks.

- **Mark as paid** — only counts orders on manual rails still awaiting
  transfer; card orders are Stripe's to settle and are skipped with a count
  ("2 skipped — card orders settle themselves"). MUST run per-order through
  the same writer as ConfirmPaymentButton (membership extension, download
  release and emails are per-order side effects; a bare UPDATE would skip
  them).
- **Mark as shipped** — physical lines only; ships **without tracking** after
  a confirm that says so and that buyers are emailed. Tracking numbers are
  per-parcel facts and stay on the detail page.
- **Mark completed** — the seller's own workflow mark; no side effects; safe
  in bulk.
- **Export selected** — the existing CSV shape, filtered to the selection.
- **Never bulk:** refund, delete. Money-out and destruction stay one order at
  a time behind their confirms.
- Implementation notes: one new action file `bulk-order-actions.ts`, each
  action claims `requireShop("orders:write")` → **pin bump + history
  paragraph in session.test.ts** (peer tripwire). Every id re-checked against
  the shop inside the transaction — a POST body is a claim.

Header ⋯ menu: deferred until Orders has a second header action that is real
(import does not exist; Export alone is a button, not a menu).

## Tasks
- [x] Fulfilment gate fix (shipped 2026-08-20 immediately) + promoted tracking form: unshipped parcels open with the carrier/number/link fields as the card's primary act (browser-verified on #CLAY-0004)
- [x] Detail v2 cards 1–6 + timeline (real timestamps only; hides under 2 events) — thumbnails, unit×qty, SKU, preorder/renewal chips, restock footnote, multi-line address + copy, ship/deliver dates + signed-by, statement descriptor, buyer tax ID + reverse-charge notice, Stripe link-out, covers-until, checkout answers, terms-agreed footer
- [x] Human numbers everywhere via one `orderNumber()` helper — #CLAY-0004 verified on list rows (bold identity, title demoted), detail title, palette labels
- [x] Bulk select + ink selection bar replacing the tabs row + Mark paid / Mark shipped / Mark completed (each per-order through the same commerce writer as its single button; skips counted in the tally) + Export selected via ?ids= on the existing route; pins 167→170; Escape clears
- [x] Prev/next arrows (RecordNav shared with products; list's own desc(createdAt) order)
