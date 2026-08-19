# 50 — Event depth: tiers, sessions, transfer, calendar, venue, policy

**Priority:** P1 · **Effort:** L · **Depends on:** 43 (sell windows, reused
per tier) · **Blocks:** nothing

## What

Events are three columns — `eventStartsAt`, `eventEndsAt`, `eventJoinUrl` — on
top of a genuinely good ticketing engine. Everything an event *seller* configures
is missing.

## Where it stands, and why Easytools is not the benchmark here

Sailo is **ahead of Easytools on events** and it is not close. Theirs is: turn on
QR codes, get one code per order, scan it from the account menu, see if it was
used. Ours is `tickets` (code, status, `usedAt`, `attendeeName`,
`attendeeEmail`, `tier`, `checkedInBy`), `door_passes` for staff credentials, a
scanner with an undo button and offline replay, `event_reminders` claimed per
(order, product, lead) so a basket with two events reminds for both, capacity as
ordinary stock with a conditional-UPDATE claim, and `eventJoinUrl` withheld until
`downloadReleasedAt`.

So the benchmark for this spec is **event ticketing platforms**, where the
standard set is tiered tickets with per-tier price, capacity and sale window;
ticket transfer; per-attendee details; calendar attachments; and time-slot or
session selection. Sailo has the engine for all of it and the configuration for
none.

## 1. Ticket tiers — the biggest gap

`tickets.tier` **already exists** as a column. Nothing writes a meaningful value
because there is no tier to name: a product has one price and one stock count, so
"Early bird / General / VIP" is three separate products with three separate
checkouts and no shared capacity.

```
event_tiers   id, product_id → products(cascade),
              name text not null,
              description text,
              price_cents integer not null,
              capacity integer,              -- NULL = share the product's stock
              sold integer default 0 not null,
              sell_from timestamp, sell_until timestamp,
              max_per_order integer,
              position integer default 0,
              is_hidden boolean default false,
              created_at, updated_at
              idx (product_id, position)
```

- **Reuse variants, or add tiers?** Variants exist and carry price, stock, SKU.
  But a variant is an *option combination* (size × colour) with `options` on the
  product driving it, and forcing a tier into that shape means an event's tiers
  become a fake option group that renders in the option picker and appears in
  every variant matrix. Tiers are their own list with their own sale windows.
  **Add the table.** Where a tier maps onto an existing variant for pricing,
  reuse the line-item path rather than the option path.
- **Capacity is two-level and both must hold.** A room of 200 with 30 VIP seats
  is a product stock of 200 and a tier capacity of 30. A claim must succeed
  against **both** or fail — one conditional UPDATE per level in one transaction,
  and the tier claim first because it is the narrower one. Getting this wrong
  oversells the room, which is the one failure an event seller cannot forgive.
- `sell_from` / `sell_until` per tier is spec 43's window mechanism reused
  verbatim — early-bird expiring while General keeps selling is the case, and
  it is why 43 puts windows on variants too.
- `is_hidden` for a comp or press tier reachable only by direct link — the same
  shape as Easytools' hidden price variants.
- **`tickets.tier` finally gets written**, and the scanner shows it. A volunteer
  at the door needs to know whether this code is VIP.

## 2. Sessions and recurring events

A weekly class, a three-day conference with day tickets, a workshop running four
times — today each is a separate product, so the seller re-types everything and
the attendee list is split.

```
event_sessions  id, product_id → products(cascade),
                starts_at timestamp not null, ends_at timestamp,
                capacity integer, sold integer default 0 not null,
                location text, join_url text,
                is_cancelled boolean default false,
                position integer default 0
                idx (product_id, starts_at)

order_items
  session_id → event_sessions(set null)
products
  session_mode text   -- NULL = single (today) | 'pick_one' | 'all_access'
```

- `NULL` session_mode reproduces today exactly. `pick_one` = the buyer chooses a
  session (a class on Tuesday **or** Thursday); `all_access` = the ticket admits
  every session (a conference pass).
- **Capacity is per session under `pick_one`** and per product under
  `all_access`. Same two-level claim discipline as tiers, and a `pick_one`
  purchase claims the session's capacity, not the product's.
- **Do not build a recurrence rule engine.** No RRULE, no infinite series. A
  "generate weekly for 8 weeks" button that writes 8 rows the seller can then
  edit individually is the whole feature, and it never has to answer "what does
  editing the series do to the one you already sold tickets for".
- Reminders (`event_reminders`) key on the **session** where one exists — its
  unique index is `(order, product, lead)` and needs the session added, or a
  conference pass reminds once for eight days.
- A cancelled session must tell its ticket-holders. That is a claimed bulk send
  against the broadcast quota, like spec 33's notify.

## 3. Attendee details, per ticket

`tickets.attendeeName` and `attendeeEmail` exist and nothing collects them — a
buyer purchasing four tickets creates four rows with the purchaser's own details,
so the door list is one name four times.

- **Collect per ticket at checkout** where the seller asks for it:
  `products.collect_attendee_details boolean`. Reuse spec 34's `contact_fields`
  with a `scope = 'checkout'` and a per-ticket repeat, rather than a second
  custom-field system.
- **Each ticket becomes individually sendable.** A buyer forwards one code to one
  guest instead of a screenshot of four. That is what makes the door list real.
- Attendee email is **not** a marketing contact. Same invariant as everywhere:
  consent is a thing a person gave, and the purchaser cannot give it for their
  guest. `clients` is not written from an attendee row.

## 4. Ticket transfer

Standard everywhere and cheap here, because a ticket is already its own row with
its own code.

```
tickets
  transferred_from_ticket_id → tickets(set null)
  transferred_at timestamp
```

- Transfer **voids the old code and mints a new one.** Not a name change: the old
  screenshot must stop working, or two people arrive with one admission and the
  scanner is right to show amber for both.
- Buyer-initiated from the delivery page (signed token, no account), rate-limited,
  and refused once `usedAt` is set — a used ticket is spent.
- The seller sees the chain. A ticket transferred three times is a resale pattern
  worth seeing.

## 5. Calendar attachment (.ics)

Nothing generates one. This is the highest ratio of "buyer expects it" to "lines
of code" in the whole plan.

- An `.ics` on the confirmation email and a link on the delivery page, per
  session, carrying `DTSTART`/`DTEND` in **UTC with a VTIMEZONE**, the venue in
  `LOCATION`, the join URL in `URL`, and a stable `UID` per (order, session) so a
  reissue **updates** the calendar entry rather than adding a second one.
- `SEQUENCE` increments on a change, which is what makes a rescheduled event move
  in the attendee's calendar instead of sitting there wrongly.
- Sailo already reads iCal for booking (spec 17's feed). This is the write
  direction for one object, which is far smaller than the calendar-write the
  booking spec deferred.

## 6. Venue, timezone, and the online/in-person split

`eventJoinUrl` implies online; `serviceLocation` is on the service kind. An event
has neither an address nor a timezone of its own.

```
products
  event_mode text            -- online | in_person | hybrid
  event_venue_name text
  event_address text
  event_time_zone text       -- falls back to shops.timeZone
```

- **A time zone per event, not per shop.** A seller in Dubai running a webinar for
  a London audience is the normal case, and `shops.timeZone` — which exists to
  make opening hours mean anything — is the wrong answer for it.
- Display in the **buyer's** zone with the event's zone named beside it. "19:00
  GST (16:00 your time)" prevents more support mail than any other line here.
- `in_person` requires an address before publishing; `online` requires the join
  URL. Refuse at publish, not at checkout.
- Address feeds the `.ics` and the reminder emails.

## 7. Event policy: refunds, cancellation, no-shows

An event sells a moment, so its policy is different from a physical good's and
`refund_policy_disclosure` is a real Stripe evidence field.

```
products
  event_refund_policy text        -- prose, disclosed at checkout
  event_refund_cutoff_hours integer
  event_allow_self_cancel boolean default false
```

- Snapshot to `policy_snapshots` (spec 44) at purchase, so a dispute months later
  cites what the buyer saw.
- Self-cancel inside the cutoff releases capacity back — which is exactly the
  conditional-UPDATE restock path the sweep already uses — and **notifies the
  waitlist** (spec 33). A released seat that nobody is told about is a lost sale.
- A no-show is not a refund. Record it (`tickets.usedAt` staying null after the
  event) and leave it at that.

## Details that must not be missed

- **Capacity claims stay in SQL, always.** Two-level (tier × product) or
  (session × product), narrower first, one transaction, conditional UPDATE with
  the ceiling in the WHERE. `PRODUCTION-PLAN.md`'s concurrent-double-booking
  defect was exactly this class and was only found by a scenario test.
- **`admitAnyCode` must stay unambiguous.** It tries a ticket, then a pass, on
  `not_found`, and the lengths disambiguate by arithmetic with a test that fails
  if anyone shortens one. Transfer mints new codes and seats (spec 49) mint pass
  codes — neither may produce a string the other could claim.
- **Sales close at `eventStartsAt`** today. With sessions that becomes per
  session, and a `pick_one` product whose last session has passed is unavailable —
  which is spec 33's waitlist trigger.
- **The scanner is not rebuilt.** Tiers, sessions and transfers all resolve to a
  ticket row, which is what it already scans. It gains display fields only.
- Plan gate: tiers on Pro; sessions, transfer and seats on Business. `.ics` and
  venue/timezone free — they are correctness, not upsell.
- 35-locale strings: tier and session pickers, attendee fields, transfer flow,
  cancellation copy, `.ics` summary lines, four emails.

## Testing

Unit: two-level capacity arithmetic (tier full but product open, product full but
tier open, both open, both full); `.ics` generation with a VTIMEZONE across a DST
boundary and a stable UID with an incrementing SEQUENCE; refund-cutoff arithmetic
in the event's zone not the shop's; transfer refused on a used ticket.

Scenario: 200-seat room with a 30-seat VIP tier — 31 VIP buyers get 30 tickets and
the 31st is refused while General still sells; an early-bird window closing does
not close General; `pick_one` claims session capacity and not product stock; a
conference pass reminds once, not once per session; transfer voids the old code and
the scanner refuses it; self-cancel inside the cutoff restocks and notifies the
waitlist; four tickets with four attendees produce four distinct door-list rows; a
cancelled session mails its holders once under two ticks.

## Done when

A seller sells Early bird / General / VIP against one room's capacity, runs the
same workshop four Tuesdays, collects each attendee's name, lets a buyer pass a
ticket to a friend in a way the scanner honours, puts the event in everyone's
calendar in the right timezone, and states a refund policy the checkout captured.
