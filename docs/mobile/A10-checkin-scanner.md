# A10 — Check-in scanner

**Wave:** 2 · **Effort:** L (2 weeks) · **Depends on:** A00, A01, A03, A05

> The native capability Stan has no answer to. A laptop cannot work a venue
> door; a phone can.

## Mission

Let door staff admit ticket holders by scanning a QR code, fast, and keep
working when the venue has no signal.

## Owns — exclusive write access

- `apps/mobile/app/checkin/**`
- `apps/mobile/lib/scan-queue.ts`

## Never touches

Any tab screen. `@sailo/commerce` (A03).

## Context you need

`apps/web/src/app/admin/checkin/` is the web equivalent — read it for the
domain model before designing anything.

`apps/web/src/lib/door-pass.ts` holds `readDoorPass`, `touchDoorPass`,
`createDoorPass`, `revokeDoorPass` and a `DoorSession` type. A03 lifts the
domain half into `@sailo/commerce`.

A03 exposes `events.list`, `events.door`, `tickets.admit`,
`tickets.undoAdmission`, `tickets.addWalkUp`. **`tickets.admit` takes an
idempotency key** — A03's PR states its shape and dedupe window. That key
exists specifically for your offline queue.

`tickets` and `doorPasses` are the tables. `DOOR_FILTERS` and `DoorRow` in
`apps/web/src/lib/queries/tickets.ts` define the list shape.

## Screens

- **Event picker** — the shop's events, from `events.list`.
- **Scanner** — full-screen, presented (not pushed). Camera, torch, live
  admitted-of-total, manual code entry.
- **Attendee list** — search by name, filter, admit manually, undo.
- **Walk-up** — sell at the door.

## Details that must not be missed

- **The offline queue is the feature.** Venues have concrete walls and no
  signal. A scan must be accepted, confirmed to the operator, persisted
  locally, and synced later. Every queued scan carries A03's idempotency key
  so a replay admits exactly once.
- **Present full-screen, do not push into a tab.** This is a self-contained
  task with a start and an end, and door staff should not be able to swipe
  into Insights by accident.
- **Speed is the requirement.** Scan-to-feedback under 300ms. Door staff scan
  a person every few seconds with a queue behind them. Anything slower and they
  stop using it.
- **Haptics carry the outcome**, because the phone is often not being looked at
  in a dark venue. Distinct patterns for admitted, already-admitted, and
  invalid — and a sound option, since gloves defeat haptics.
- **Undo must exist and must be fast.** Mis-scans happen; without undo the
  only fix is a laptop.
- **Keep the screen awake** while the scanner is open (`expo-keep-awake`).
- **Camera permission is requested just in time with a rationale.** Denial is a
  rendered state with a route to system settings, never a crash and never a
  dead button. `lib/push.ts` models this pattern for notifications — copy its
  shape, including the distinction between "not yet asked" and "asked and
  refused, cannot ask again".
- Battery: the camera is expensive. Pause the preview when the app
  backgrounds, and do not hold the torch on across a background.
- Already-admitted is **not an error**. It is a legitimate, common answer
  ("this person came back in") and needs its own clear visual, distinct from an
  invalid ticket.
- The queue must survive an app kill, not just a background.

## Done when

- [ ] 200 scans taken in airplane mode all sync on reconnect, admitting each
      **exactly once**.
- [ ] Scan-to-feedback under 300ms, measured on a mid-range device.
- [ ] Killing the app with a full queue loses nothing.
- [ ] Screen stays awake while scanning.
- [ ] Denying camera permission shows a state that explains the next step.
- [ ] Admitted / already-admitted / invalid are three visually distinct
      outcomes, each with its own haptic.
- [ ] Undo reverses an admission and the count updates.
- [ ] Every string from `@sailo/i18n/native`; Arabic RTL correct.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.
