# 09 · Payments — "Stripe number one, then the manual ones, super clean"

**0.5s shape:** one hero provider card, then everything else in quiet rows.

## Digested captures (settings-payments + manual-methods)
- **Card 1 — the hero:** "Shopify Payments" title + subtitle line ("No
  transaction fees · Card rates set by Shopify Payments"); right: Learn more ·
  **Complete setup** (primary dark). Inset gray panel: bold benefit heading +
  3 ✓ benefit lines. Footer link: "See all other providers".
- **Card 2 — Additional payment providers:** subtitle line; PayPal row (name,
  fee line "0.6% transaction fee · PayPal processing fees apply", brand logo,
  **`Setup incomplete` status chip** + ›; info banner "Complete your PayPal
  account setup…"); `⊕ Add provider` row.
- **Card 3 — Payment configuration:** pure chevron ListRows: Payment capture
  method / **Manual payment methods** / Payment method customizations / Gift
  card expiration / Apple Wallet passes.
- **Manual methods sub-page:** breadcrumb `💳 › Manual payment methods`;
  explainer card ("Payments made outside your online store. Orders paid
  manually must be approved before being fulfilled."); `⊕ Manual payment
  method` row opening a **menu**: Create custom / Bank Deposit / Money Order /
  Cash on Delivery.

## Sailo mapping
Our /admin/payments already lists rails (Stripe card rail + manual rails:
bank transfer, cash, WhatsApp-handoff etc.) but as one flat list. The capture's
lesson is the HIERARCHY: card first as a hero with benefits + setup state,
manual second, plumbing third.

## Target (P3) — /admin/payments restructure
1. **Hero: Card payments (Stripe)** — states:
   - not connected: benefits panel (✓ instant card + wallets, ✓ your plan's
     rate {formatFeeBp}, ✓ chargeback evidence built-in) + **Connect Stripe**
     primary (existing connect action); Learn more → docs.
   - connected-incomplete: `Setup incomplete` amber chip + Continue on Stripe.
   - live: `Active` green chip + payout schedule line + Manage on Stripe.
2. **Manual rails card** — each configured rail as a row: icon, name, its
   handoff line (e.g. bank details / wa.me number), enabled Toggle (our
   switch), › to edit sheet. Footer `⊕ Add payment method` → menu of rail
   types not yet configured (from PAYMENT_METHOD_DEFS) + "Custom".
3. **Configuration card** — chevron rows: Payment reference check (existing
   transfer-ref rule) / Invoice & receipts (→ settings Invoicing) / Fees &
   payouts (→ Stripe dashboard link). Only rows that exist — no costume rows.
4. Settings-room cross-link (done) points here; breadcrumb only INSIDE the
   room; the standalone page keeps PageHeader.

## Tasks
- [ ] Reorder page into hero/manual/config cards; Stripe state chips
- [ ] Add-method menu (Popover) from unconfigured rail types
- [ ] Rail row edit → sheet (existing forms relocated)
- [ ] LearnMore + empty states (no rails yet → hero only + explainer)
