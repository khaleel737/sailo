# Maestro — the flows a build has to survive

Three flows, run against a **real build on a real device or simulator**. Maestro
drives the installed app; it does not bundle, so `expo run:ios` (or an EAS
build installed on the device) has to have happened first.

```sh
brew install maestro                     # not a repo dependency; it is a binary
maestro test apps/mobile/maestro         # reads config.yaml
maestro test apps/mobile/maestro/flows/sign-in.yaml   # one flow
```

## Credentials

Every flow reads its account from the environment — nothing is committed, and
nothing defaults. A missing variable fails the flow rather than silently
signing in as somebody else.

| Variable | What it is |
|---|---|
| `MAESTRO_SELLER_EMAIL` / `MAESTRO_SELLER_PASSWORD` | A seller with at least one order. |
| `MAESTRO_SHOP_NAME` | That seller's shop name, exactly as drawn. |
| `MAESTRO_OTHER_EMAIL` / `MAESTRO_OTHER_PASSWORD` | A **different** seller, different shop. |
| `MAESTRO_OTHER_SHOP_NAME` | Their shop name. |
| `MAESTRO_TARGET_STATUS` | A status to move an order to, in the app's language. |

**`order-status.yaml` mutates real data.** `orders.updateStatus` calls
`applyOrderStatus`, which restocks units and voids tickets on a cancellation.
There is no dry run. Point these at a test shop.

## Selectors

By `testID` where a screen publishes one, by accessibility label where it does
not, and by visible text only for the native tab bar — which is the one
surface still drawing its own English.

This is not a stylistic preference. Screen copy resolves through
`@sailo/i18n/native`, so a text selector pins the flow to one locale and breaks
the moment somebody runs it in Arabic. Driving off the accessibility label has
a second effect worth having: a regression that strips a label fails here, so
the E2E suite is also a floor under the VoiceOver work.

## What these flows do not cover, and why

Written against the app as it exists. Each gap below is a missing screen or a
missing procedure, not a missing test.

- **Sign up → create shop → add product.** The work order asks for this as one
  flow. None of the three steps can be driven today: sign-up and the shop
  screens are A06/A07 work in flight, and `packages/api` exposes
  `products.list` and `products.get` with **no product mutations at all** — so
  "add a product" has no server call behind it, on any surface. `store/[id].tsx`
  documents that absence at the top of the file. Until `products.create` exists
  this flow cannot be written, only imagined.
- **Receive an order.** Not a UI step on this app at all — a buyer places it on
  the storefront. Driving it needs a seeded order or a webhook fired from the
  test harness, which is a fixture decision rather than a flow.
- **Two-factor.** `sign-in.tsx` routes a `twoFactorRedirect` to `/two-factor`.
  That route does not exist yet, so a 2FA-enrolled account cannot complete a
  sign-in and no flow here uses one.
- **Frame-exact tenancy.** `handover-clears-the-cache.yaml` proves the query
  cache is cleared between two sellers on one handset. It cannot prove *no
  frame ever* paints the first seller's data: Maestro polls the view hierarchy
  rather than sampling frames, so a single-frame flash between the session
  resolving and the first fetch landing could fall between two polls. Catching
  that needs an instrumented render assertion, which needs a mobile unit test
  harness — see the note on `jest-expo` in the A11 report.
- **VoiceOver, Dynamic Type and RTL.** Maestro reads the accessibility tree; it
  does not run VoiceOver, does not resize text, and does not mirror the layout.
  All three are manual passes on a device.
