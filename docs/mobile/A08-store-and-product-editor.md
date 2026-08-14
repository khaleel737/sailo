# A08 — Store & product editor

**Wave:** 2 · **Effort:** L (2 weeks) · **Depends on:** A00, A01, A03, A04, A05

## Mission

Let a seller build and edit their catalogue from a phone, including taking the
product photo with the camera they are already holding.

## Owns — exclusive write access

- `apps/mobile/app/(tabs)/store/**`

## Never touches

`index/`, `orders/`, `insights/`, `settings/`, `(auth)/`, `checkin/`.
`@sailo/design-native` — request components, don't build them.

## Context you need

`products.save` (A03) is the extracted domain write behind the web form. A
product created here must be **row-identical** to one created on web.

`uploads.token` (A04) issues a scoped, short-lived Vercel Blob client token.
**Bytes go device → Blob directly.** They never pass through tRPC — the web
route accepts files up to 100 MB.

`packages/core/src/variants.ts` owns variant resolution: a blank variant price
means "same as the product", a blank stock means "nobody is counting". The
router returns variants **raw** and documents why — resolving them a second
time here would be a copy that can disagree with the storefront.

The existing `app/(tabs)/products/` screens move under `store/` (A00 did the
move); build on them rather than starting over.

## Screens

- **Store** — segmented control: Products / Design.
  - Products: FlashList, `expo-image` thumbnails, published badge, price.
  - Design: shop name, description, avatar/logo, accent colour, socials
    (via `shop.update`).
- **Product editor** — a sheet with detents. Title, description, price,
  images, variants, files, publish toggle.

## Details that must not be missed

- **Uploads must survive a backgrounded app.** A seller who switches away
  mid-upload and comes back must find it resumed or cleanly failed — never a
  half-written product with three of five images. Show progress and offer
  cancel.
- **Camera and library permission denial is a rendered state, not a crash.**
  A00 added the `infoPlist` strings; you handle the "no" answer. Ask just in
  time with a rationale, and when blocked, send the seller to system settings
  rather than showing a button that silently does nothing. `lib/push.ts`
  models this exact pattern for notifications — copy its shape.
- **Do not resolve variants.** Render what the router returns; use
  `@sailo/core/variants` if you need a resolved value for display.
- **Delete goes behind a native `Alert`**, not a custom modal. Destructive
  style, and the product name in the message.
- **Empty state carries one clear action.** Stan draws a hand-drawn squiggly
  arrow pointing at their "New Product +" button — that is hierarchy
  compensating for itself. One heading, one line, one button.
- Images need a stable order (`productImages.position`) and drag-to-reorder is
  the expected affordance. If you ship without reordering, say so in the PR.
- Price input must respect the shop's currency and locale — decimal separator,
  symbol placement, and no assumption of two decimal places.
- A draft product still counts for the onboarding `product` step. Do not gate
  the tick on publishing.
- The publish toggle writes immediately (`products.togglePublished`), like the
  settings screen's toggles. No save button on a switch.

## Done when

- [ ] A product created on the phone is row-identical to one created on web,
      compared field by field including images and variants.
- [ ] Backgrounding mid-upload resumes or fails cleanly — never a partial
      product.
- [ ] Denying camera permission shows a state that explains the next step.
- [ ] Deleting asks first, names the product, and is irreversible only after.
- [ ] The list holds 60fps at 200 products with images.
- [ ] Adding the first product ticks the Home checklist without a manual
      refresh.
- [ ] Every string from `@sailo/i18n/native`; Arabic RTL correct including
      price formatting.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.
