# 17 — Booking Integrations (Google Calendar + Zoom)

**Priority:** P3 · **Effort:** L · **Depends on:** nothing (booking engine
exists: `src/lib/booking/`, GiST no-overlap constraint in `drizzle/0004`)

## What

Two upgrades to service bookings, mirroring Stan's integration cards:

- **Google Calendar (two-way):** external busy time blocks Sailo slots;
  confirmed Sailo bookings appear in the seller's calendar.
- **Zoom:** a confirmed booking auto-creates a Zoom meeting and puts the
  join link in the buyer's confirmation email and the order.

## Why the read direction matters most

Sailo's exclusion constraint makes *Sailo* double-bookings impossible — but a
dentist with a Tuesday funeral in Google Calendar is bookable in Sailo today.
Busy-time sync closes the seller's biggest real-world booking failure.

## Data model (migrations, production first)

- `calendarConnections`: id, shopId, provider (`google | zoom`),
  `accessToken`, `refreshToken` (both **encrypted at rest** — add a small
  AES-GCM sealed-box helper keyed from a new env secret; tokens in plaintext
  columns is the classic breach multiplier), `externalCalendarId`, scopes,
  `expiresAt`, createdAt. One row per provider per shop.
- `bookingClaims` / orders need nothing; the Zoom join URL lands on the
  order row: `meetingUrl text` (nullable) on orders.

## Google flow

1. OAuth (offline access, `calendar.readonly` + `calendar.events` scopes) —
   callback route stores tokens; refresh on 401 via the refresh token; a
   failed refresh marks the connection broken and emails the seller
   (spec 04 transport).
2. **Availability read:** when computing free slots (the weekly-hours logic
   in `src/lib/booking/`), also query Google FreeBusy for the window and
   subtract busy ranges. Cache per shop for 60s (Redis, fail-open to
   Sailo-only availability — a Google outage must not close the shop's
   calendar; log the degradation).
3. **Event write:** when the seller confirms a booking
   (`src/lib/actions/order-admin.ts`, the `confirmed` transition), insert a
   calendar event (buyer name, product title, Sailo order link). Store the
   event id so a cancellation deletes it. Idempotent: one event per order.

## Zoom flow

Server-to-server OAuth app (account-level, no per-user consent screen).
On booking confirmation, `POST /users/me/meetings` with the slot's start and
duration; save `join_url` to `orders.meetingUrl`; include it in
`sendBookingDecision`'s accepted branch (`src/lib/email/messages.ts:327`).
Zoom failure degrades to a confirmed booking without a link plus a seller
notice — never block the confirmation.

## Details that must not be missed

- FreeBusy subtraction happens at *display* time; the write-time guard is
  still the exclusion constraint. A race (Google event created between
  display and booking) resolves the same way it does today — seller declines
  — so no new write-path complexity.
- Timezones: FreeBusy returns UTC instants; Sailo slots are computed from
  `WeeklyHours` in the shop's timezone (`src/lib/booking/time-zone.ts`) —
  convert once, test the DST boundary week explicitly (the classic
  double-booking bug).
- Token revocation by the seller on Google's side surfaces as 400
  `invalid_grant` — treat as broken connection, not a retry loop.
- Disconnect buttons delete the row and revoke the token upstream.
- Settings UI: an Integrations card set (Settings tab or its own page);
  plan-gate both behind `pro`. 35-locale admin strings.
- Secrets: new env vars documented in the PR (`GOOGLE_OAUTH_*`, `ZOOM_*`,
  `TOKEN_SEAL_KEY`); never logged, never in NEXT_PUBLIC.

## Testing

Unit: busy-range subtraction (overlap algebra, DST week, empty calendar).
Scenario with a stubbed Google client: slot hidden when busy; Sailo-only
availability when the stub errors (fail-open); confirm → one event id stored,
re-confirm idempotent. Zoom: link lands on order + email; failure degrades.

## Done when

Busy time hides slots, confirmations create events/meetings exactly once,
everything fails open to today's behaviour, and tokens are sealed at rest.
