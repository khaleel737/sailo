# A07 — Home & Orders

**Wave:** 2 · **Effort:** L (2 weeks) · **Depends on:** A00, A01, A02, A03, A05

## Mission

The two screens a seller opens the app for: what needs doing, and what just
came in.

## Owns — exclusive write access

- `apps/mobile/app/(tabs)/index/**`
- `apps/mobile/app/(tabs)/orders/**`
- `apps/mobile/app/preview.tsx`

## Never touches

`store/`, `insights/`, `settings/`, `(auth)/`, `checkin/`.
`@sailo/design-native` — request components, don't build them.

## Context you need

The existing `app/(tabs)/orders/[id].tsx` already implements an **optimistic
status write** with `onMutate` rollback. Keep it — it is the reference pattern
for every write in the app. Read it before writing anything.

`packages/core/src/onboarding.ts` derives four steps — photo, product, paid,
social — from live shop data. Nothing is stored, so a tick can never be stale.
Read its header comment; it explains why "publish your shop" and "share your
link" are deliberately *not* steps.

The web dashboard (`apps/web/src/app/admin/page.tsx`) opens with the store link
in a full-width `bg-ink-950` block, with a comment explaining why it is ink and
not brand green. Mirror that treatment.

## Home

- **Store-link block** on ink-950: the URL as the brightest element, a live
  dot, copy and system share sheet. Tapping opens the Preview sheet.
- **Setup checklist**: four derived rows, progress bar, count. Dismissible per
  shop, persisted locally. Disappears when complete.
- **Today**: revenue, orders, visits.
- **Recent orders**: five, tapping through into the Orders stack.
- Pull to refresh. Skeletons, not spinners.

## Orders

- FlashList, cursor pagination (A03's cursor), status filter chips, search.
- Row: product title, customer, status pill, amount, relative time.
- Swipe actions: fulfil, cancel. Haptic on the **outcome**, not the swipe.
- Detail: line items from `items`, customer, delivery, payment, status changer
  in a native action sheet.
- The deep-link target for order push notifications (A00 wired the listener).

## Preview sheet

Live WebView of `sailo.store/{handle}` in the seller's real theme. Share,
copy, open in browser.

## Details that must not be missed

- **All four checklist rows visible at once.** This is the direct answer to
  Stan's swipe carousel, which shows one step at a time behind a dot pager and
  reduces progress to the text "1/4 tasks completed". A completed row stays on
  the list — "2 of 4" has to be countable on the screen that says it — but
  stops being a link. Web's `setup-checklist.tsx` gets this exactly right;
  read it.
- **The checklist is derived, so there is nothing to invalidate.** Completing a
  step on a laptop ticks it here on next focus. Do not cache the steps
  separately or add a "refresh" affordance for them.
- **`orderItems` is authoritative.** The header's `productTitle`/`quantity`
  are a summary of the first line. A detail screen showing what was bought
  reads `items`.
- **Empty is a state, not an absence.** `ListEmptyComponent` must render only
  after the query has answered — the existing code gets this right and
  documents it. A seller must never read "No orders yet" about a request still
  in flight.
- Preview is a **WebView, not a mockup**. Stan's Preview tab is a static phone
  frame with an avatar in it; the whole reason we demoted it from a tab is that
  it showed almost nothing.
- Swipe actions need an undo path or a confirm — a mis-swipe that cancels a
  real order is unrecoverable from the row.
- Relative time ("2h ago") must be localised and must not re-render the whole
  list every minute.
- `refreshing` should reflect `isFetching && !isPending`, as the existing
  dashboard does, so the spinner is honest about background refreshes too.

## Done when

- [ ] Completing a step on another device ticks it here on next focus, with no
      cache to clear.
- [ ] The orders list holds 60fps scrolling at 500 rows on a mid-range device.
- [ ] A failed status change rolls the row back and says why.
- [ ] Tapping an order notification opens that order (cold and warm start).
- [ ] A brand-new shop shows a checklist at 0 of 4 and an empty-orders state
      that names the next action.
- [ ] Preview renders the seller's actual storefront theme.
- [ ] Every string from `@sailo/i18n/native`; Arabic renders RTL correctly,
      including the money and time formats.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.
