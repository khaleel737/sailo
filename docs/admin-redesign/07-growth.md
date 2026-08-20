# 07 · Growth (Discounts · Broadcasts · Affiliates · Attribution)

**0.5s shape:** verbs, not reports. Create a discount, send a campaign, pay a
partner — each creation flow is a two-column form with a live summary rail.

## Digested captures
- **Discounts index:** empty card w/ scissors illustration; Create discount →
  **type-picker dialog**: 4 rows (Amount off products / Buy X get Y / Amount
  off order / Free shipping), each icon + title + one line + ›; Cancel.
- **Discount create (the model creation form):** LEFT: Method segmented
  [Discount code | Automatic] → code input + "Generate random code" link +
  helper line → Discount value (Percentage ▾ + % input) → Applies to
  (collections search + Browse) → Eligibility ▾ → Minimum purchase radios →
  Maximum uses checkboxes → Combinations → Active dates (date+time inputs,
  TZ named, Set end date checkbox). RIGHT RAIL: **summary card** that
  restates the config as it's built ("No discount code yet / Type / Details:
  • All customers • No minimum…"), Sales-channel access card, Tags card.
  TOP: dirty save bar. BOTTOM: right-aligned Save.
- **Growth hub:** Early-access hero (dismissable), Performance 3-tiles row w/
  date range + View details, Campaign waitlist row, Recent campaigns row.
- **Attribution:** date/grain/model pickers, top-channels line chart, channel
  table (Sessions/Sales/Orders/CR/Cost/ROAS/CPA/CTR/AOV/new-vs-returning).
- **Campaigns:** explainer card + Create campaign.

## Sailo mapping
Growth door = Broadcasts · Coupons · Affiliates (+ Flows from parallel work).
Broadcasts composer is already strong (editor/preview/schedule/audience).
Coupons: single-column form (the gap). Affiliates ✓. Attribution: our
TrafficPanel + funnel move to 08; a full ROAS table needs cost data we don't
have — OUT, honestly.

## Coupon create v2 (P4 — the model for every create form)
- Entry: Create coupon → **type dialog**: Percentage off / Fixed amount off /
  Free delivery (3 rows, icon+line+›) — maps to existing coupon kinds.
- Form: LEFT cards = Code (input + Generate random link) → Value → Applies to
  (all/categories/products) → Minimum spend → Usage limits (total / per
  customer) → Active window (from/to, shop TZ named). RIGHT RAIL = summary
  card restating in sentences (reuses the truth the storefront enforces) +
  status card (Active toggle). Dirty save bar + bottom Save.
- Broadcasts composer: adopt the same right rail (audience count + schedule
  summary + test-send) — P4 stretch.

## Tasks
- [ ] P4: type dialog + 2-col coupon form + summary rail (live restatement)
- [ ] "Generate random code" helper (client, 8-char, unambiguous alphabet)
- [ ] Broadcast right-rail summary (stretch)
- [ ] Growth hub page? NO — the door already opens Broadcasts; a hub page adds
      a click between the seller and the verb. Re-evaluate when campaigns exist.
