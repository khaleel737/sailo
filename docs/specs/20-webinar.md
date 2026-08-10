# 20 — Webinar Product

**Priority:** P3 · **Effort:** M · **Depends on:** 17 (Zoom) recommended

## What

A scheduled one-to-many event with capacity: buyers register (free or paid),
receive the join link, get a reminder, and optionally a replay afterwards.
Reference: Stan's "Webinar — host exclusive coaching sessions or online
events with multiple customers".

## How it differs from the existing service booking

A service booking is one buyer claiming a *slot* (exclusion constraint,
`bookingClaims`). A webinar is many buyers sharing one *event* — the
constraint is a capacity counter, not slot exclusivity. Do not overload the
booking tables.

## Data model (migrations, production first)

- `products`: new kind `"event"`, plus `eventStartsAt timestamp`,
  `eventDurationMinutes int`, `eventCapacity int nullable` (null =
  unlimited), `eventJoinUrl text nullable`, `eventReplayUrl text nullable`.
  (If a product needs multiple sessions, that's v2 — one event per product
  keeps checkout unchanged.)
- Registration is just an order line — no new table. Capacity enforcement
  reuses the atomic-claim shape: a conditional UPDATE against a
  `eventSeatsTaken` counter (`WHERE seats_taken < capacity`), exactly like
  `reserveStock` — never read-then-write. Abandoned card checkouts release
  seats through the existing sweep (`releaseAbandonedCheckouts`), so wire
  seat release into `abandonOrder`'s giveback path alongside stock and
  slots.

## Flow

1. Seller creates the event product with date/capacity; join URL either
   pasted (any platform) or auto-created via Zoom (spec 17) at publish.
2. Buyer checkout is standard (`createOrderIntent`); free events allow the
   no-payment path the lead product uses if priceCents = 0 — decide: v1 can
   require at least the manual rail to keep one code path.
3. Confirmation email includes the join link **only after settlement** (card:
   webhook; manual: seller confirm) — an unpaid registration must not leak
   the link. Add the link to the buyer portal page too.
4. Reminder: a cron pass emails registrants T-24h and T-1h (idempotent —
   stamp `reminded24At`/`reminded1At` on the order or a side table).
5. After `eventStartsAt + duration`, the product stops selling
   (render "event ended"; if `eventReplayUrl` set, deliver it to registrants
   via the download-token idiom).

## Details that must not be missed

- Timezone: the event instant is stored UTC; render in the *buyer's* local
  time on the storefront (client-side Intl) and the shop's timezone in
  admin — label both explicitly, this is the #1 webinar support ticket.
- Cancellation by seller: bulk email registrants + refund path guidance (the
  existing refund flow per order; a one-click "refund all" is v2 — say so).
- Capacity edge: capacity shrink below seats_taken is refused in the edit
  action.
- Income/analytics: event orders are normal orders; nothing special.
- 35-locale strings both dictionaries (storefront register button, "starts
  in", ended state; admin editor).

## Testing

Scenario: two concurrent registrations for the last seat → exactly one
succeeds (the throughput-suite pattern); abandoned card checkout releases
the seat via the sweep; link absent before settlement, present after;
reminders stamp idempotently; ended event refuses new orders.

## Done when

Capacity is race-proof, links leak only after money, reminders fire once,
and time renders correctly on both sides.
