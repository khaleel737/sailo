# 51 — Service and physical depth: staff, classes, intake, reschedule, inventory

**Priority:** P2 · **Effort:** L · **Depends on:** 34 (custom fields, for
intake forms) · **Blocks:** nothing

## What

The other two product kinds. `service` has a real booking engine and no operating
model around it; `physical` has real stock and nothing that helps a seller run it.

## Where they stand

**service** — `durationMinutes`, `serviceMode`, `serviceLocation`,
`bookingEnabled`, `bookingLeadHours`, `bookingBufferMinutes`, plus
`shops.bookingHours` / `bookingSlotMinutes` / `timeZone` / `calendarFeedUrl`,
`booking_claims` with an exclusion constraint, and iCal subtraction at display
time. That engine is good — better than anything Easytools has, which is nothing.

**physical** — variants with options, `sku`, `trackInventory`, `stockQuantity`,
`maxPerOrder`, shipping zones (`0019`), tracking columns, restock on cancel.

## Service — five gaps

### 1. One calendar, many people

`shops.bookingHours` is the *shop's* hours, so a salon with three stylists or a
clinic with two practitioners has one calendar and can take one appointment at a
time. This is the gap that stops Sailo serving anyone with staff.

```
staff_resources   id, shop_id → shops(cascade), name text,
                  email text, avatar_url text,
                  hours jsonb,              -- WeeklyHours, falls back to shop
                  time_zone text,           -- falls back to shop
                  calendar_feed_url text,   -- their own iCal, same SSRF guard
                  is_active boolean default true,
                  position integer default 0
                  idx (shop_id, is_active)

product_staff     product_id → products(cascade),
                  staff_id → staff_resources(cascade),
                  primary key (product_id, staff_id)

order_items
  staff_id → staff_resources(set null)
booking_claims
  staff_id → staff_resources(set null)
```

- **The exclusion constraint is the load-bearing part.** `booking_claims` already
  prevents double-booking; it must now exclude on **(staff, time range)** rather
  than (shop, time range), or two stylists cannot work at once. This is a change
  to the constraint that guarantees Sailo never double-books, so it is the single
  riskiest line in this spec — and `PRODUCTION-PLAN.md` records the concurrent
  double-booking defect being found only by a scenario test. Write that test
  first.
- **`staff_id` nullable everywhere** means "any available", which is today's
  behaviour and must stay the default. A shop with no `staff_resources` rows
  behaves exactly as it does now.
- Availability = the union of eligible staff's windows minus their own busy time
  minus each one's own iCal feed. The feed reader is spec 17's, per staff, under
  the same SSRF guard and 60s cache.
- **`staff_resources` is not `shop_members` (spec 37).** A stylist is a
  bookable *resource*; a team member is a *login*. Some people are both, and the
  tables may reference each other, but a resource with no account is the common
  case (a contractor) and a member who takes no bookings is equally common (a
  bookkeeper). Two tables, and say why in the header.

### 2. Group bookings and classes

`durationMinutes` plus one slot = one buyer. A yoga class of twelve, a workshop
of six, a tour of twenty cannot be sold.

```
products
  booking_capacity integer     -- NULL = 1 (today)
booking_claims
  seats_taken integer default 1 not null
```

- The exclusion constraint becomes a **capacity check** for capacity > 1: the
  claim is a conditional UPDATE summing `seats_taken` for the overlapping range
  against `booking_capacity`, in one statement, with the ceiling in the WHERE.
  Do not read-then-insert.
- A class is close to a session (spec 50) and deliberately not the same thing: a
  session is a fixed datetime the seller published, a class slot is generated from
  hours. Where a seller wants fixed dates, `event` with sessions is the right kind
  and the product form should say so.

### 3. Reschedule and cancel, by the buyer

Today only the seller can move an appointment. A buyer who needs to move a
haircut emails, and the seller does it by hand.

```
products
  reschedule_cutoff_hours integer   -- NULL = not allowed (today)
  cancel_cutoff_hours integer
order_items
  rescheduled_from timestamp
```

- From the buyer's existing signed delivery/order link, rate-limited, refused
  inside the cutoff. Reschedule is **release-then-claim in one transaction** — a
  buyer must never lose their slot to a failure to get the new one.
- Cancel inside the window releases the slot and notifies spec 33's waitlist,
  same as an event seat.
- Both write `order_messages` (spec 44), because "the buyer moved this themselves
  on the 3rd" is exactly what answers a `product_not_received` dispute on a
  service.

### 4. Intake forms

A consultation, a treatment or a tattoo needs answers before the appointment.
Spec 34's `contact_fields` with `scope = 'checkout'` covers the collection; what
is missing is that the **answers reach the appointment**: shown on the order, in
the seller's day list, and in the reminder email. No new field system.

### 5. Reminders

Events remind at T-24h and T-1h (`event_reminders`). Bookings do not, and a
no-show costs a service seller a whole slot. Reuse `event_reminders` — it is
keyed `(order, product, lead)` and needs no change beyond being written for
`service` too. This is the cheapest revenue-protecting line in the spec.

## Physical — four gaps

### 1. Low-stock alerts

`lowStock` matches **0 files**. A seller finds out they are out of stock from a
buyer.

```
products
  low_stock_threshold integer      -- NULL = no alert
  low_stock_notified_at timestamp  -- claimed, reset on restock
```

Claimed conditional UPDATE so one alert per crossing, through the existing
`notificationPrefs`. Reset when stock rises back above the threshold, or a single
restock-and-resell cycle goes silent forever.

### 2. Weight and dimensions, so shipping can be priced

`0019_shipping_zones` made per-rate country zones real. Rates cannot vary by what
is in the box because nothing records it.

```
products / product_variants
  weight_grams integer
  length_mm, width_mm, height_mm integer
delivery_methods
  rate_mode text        -- flat (today) | by_weight
  weight_bands jsonb    -- [{ upToGrams, priceCents }]
```

Grams and millimetres as integers — minor units, for the same reason money is:
a float weight compared against a band boundary is a rounding argument with a
carrier. **No live carrier rate API.** Bands are a seller-configured table, which
reaches every carrier and needs no credential at rest.

### 3. Partial fulfilment and multiple shipments

`trackingCarrier` / `trackingNumber` / `shippedAt` are **on the order header**, so
a three-item order shipping in two boxes can record one tracking number. This is
the "header-vs-lines" bug shape the repo already names as recurring.

```
shipments      id, order_id → orders(cascade),
               carrier text, tracking_number text, tracking_url text,
               shipped_at, delivered_at, delivered_source text,
               created_at
shipment_items shipment_id → shipments(cascade),
               order_item_id → order_items(cascade),
               quantity integer not null,
               primary key (shipment_id, order_item_id)
```

- **The header columns stay and keep working** — they are read by emails, exports,
  the API resource shape and every existing test. Populate them from the *first*
  shipment and treat them as a denormalised convenience, or migrate every reader
  in one pass. Pick one and write down which; half-migrating is the defect.
- Spec 44's `delivered_at` moves here per shipment, and spec 45's fulfilment
  document lists all of them. An order half-delivered is a real dispute posture
  and the pack must be able to say so.
- Order status: `shipped` when the first shipment goes, `completed` when every
  line is covered. No new status (spec 44's rule).

### 4. Restock destination on refund

`restockedAt` exists and returns units to `stockQuantity`. A refund for a damaged
item should not put it back on the shelf. `refundReason` is free text; add
`restock boolean` to the refund action, defaulting to true, so the seller decides
at the moment they know.

## Details that must not be missed

- **The exclusion-constraint change is the highest-risk item in the plan** after
  spec 37's `requireShop`. It is the guarantee that Sailo never double-books.
  Change it, then run the concurrency scenarios *first* and read the count.
- **Every claim stays in SQL** — staff slots, class seats, low-stock crossing,
  shipment coverage. `PRODUCTION-PLAN.md` §2 items 4, 12, 13 are all this shape.
- **Nothing here changes behaviour for a shop that does not configure it.** No
  staff rows → shop hours. `booking_capacity` NULL → one seat. No weight → flat
  rate. Null cutoffs → no self-service. The `0034` discipline.
- **A physical order's evidence improves for free.** Per-shipment delivery with a
  source is what spec 45's `shipping_documentation` needs to stop saying "marked
  by the seller" for everything.
- Plan gate: staff resources and classes on Pro; multi-shipment and weight bands
  on Business; low-stock alerts and booking reminders free (they prevent loss).
- 35-locale strings: staff picker, class capacity copy, reschedule/cancel flow,
  intake display, low-stock email, shipment UI, weight bands.

## Testing

Unit: availability union across three staff with different hours, timezones and
iCal feeds; class capacity arithmetic at the boundary; reschedule cutoff in the
shop's zone across DST; weight-band selection at exact boundaries; shipment
coverage (when is an order fully shipped) with partial quantities.

Scenario — the concurrency ones are the point: two buyers, two stylists, one time
→ **both succeed**; two buyers, one stylist, one time → one succeeds; twelve
buyers on a ten-seat class → ten succeed; a reschedule that fails to claim the new
slot leaves the old one intact; low-stock alerts once per crossing under two
ticks; two shipments cover an order and status moves to `completed` only on the
second; a refund with restock off does not return stock; a shop with no staff rows
books exactly as it does today.

## Done when

A salon with three stylists takes three appointments at once, a studio sells a
ten-person class, a buyer moves their own appointment, a seller is told before they
run out, and a three-box order records three tracking numbers that the evidence
pack can print.
