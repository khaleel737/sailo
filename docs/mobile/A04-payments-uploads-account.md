# A04 — Payments, uploads, account

**Wave:** 1 · **Effort:** M (1 week) · **Depends on:** A00 ·
**Blocks:** A06, A08, A07

## Mission

Three small, unrelated seams the app cannot ship without: getting a seller paid,
getting bytes off the device, and letting a seller delete their account.

## Owns — exclusive write access

- `packages/payments/src/connect.ts`
- `apps/web/src/lib/connect.ts` (extract only)
- `apps/web/src/lib/queries/checkout.ts` (move `getCheckoutMethods`)
- `apps/web/src/lib/notification-prefs.ts` → package (move out)
- `apps/web/src/lib/account-deletion.ts` → package (move out)
- `packages/api/src/routers/{payments,uploads,account}.ts`

## Three things settled

**`plans.ts` has already moved.** A02 landed it — `apps/web/src/lib/plans.ts` is
now a re-export shim and the real file is `packages/core/src/plans.ts`. Import
`can` from `@sailo/core/plans`. `payments.connectLink` ships **with** its
`cardRails` gate; a free-plan seller must not be able to open a Connect account
from the phone.

**`lib/payments/rails.ts` — do not touch it, and not for the reason it looks
like.** Those edits are not another agent's. `rails.ts`, `rails.test.ts`,
`payments/index.ts`, `connect.ts` and the admin payments components were all
already modified *before any work order existed* — they are pre-existing
uncommitted work in the tree. Moving `rails.ts` would sweep an unreviewed
refactor into your commit. `payments.methods` stays blocked until the owner of
those edits commits or stashes them; that is a human decision, not yours.

**`connect.ts` is in your Owns and already has ~187 lines of uncommitted
changes in it.** Read the working copy before you edit, not the last commit.

## account-deletion.ts

Lift it, but it has two dependencies that do not travel:

- **email** — blocked on `docs/mobile/A16-email-package.md`, exactly as A03's
  booking email is. Wire the seam A16 publishes; until then, report the
  omission rather than reimplementing a sender.
- **`lib/cache`** — Next request scope, which does not exist off-server. Take it
  as an **optional injected callback** that web passes and `packages/api` does
  not, the same seam A03 uses for `revalidatePath`.

`notification-prefs.ts` is 48 lines importing only `zod` and a db type — move
it as-is. Its schema rejects unknown keys and absence-means-ON is deliberate;
change neither.

## Never touches

`packages/commerce` (A03). Any mobile screen. Any web component.

## Context you need

`shops` carries the Connect state: `stripeAccountId`, `stripeChargesEnabled`,
`stripeDetailsSubmitted`, `stripeAccountCountry`, `stripeConnectedAt`.

`getCheckoutMethods` in `apps/web/src/lib/queries/checkout.ts` answers "can this
shop be paid" — enabled, configured, and within the plan. The admin dashboard
calls it for the onboarding step with a comment explaining why a second opinion
written elsewhere would be "the twin that drifts". Honour that.

`apps/web/src/app/api/upload/route.ts` accepts images up to 8 MB and product
files up to 100 MB, with a MIME allowlist that deliberately excludes anything
a browser would execute (html, svg, javascript) because those files are served
from Sailo's own domain.

`apps/web/src/lib/account-deletion.ts` already implements deletion with its
obligations refusal and ledger retention. It has tests.

## Tasks

1. **Lift Connect account-link creation** into `@sailo/payments`. Web imports
   back.

2. **`payments.methods`** → `getCheckoutMethods`, moved to `@sailo/commerce`
   or `@sailo/payments` (your call — state it in the PR). Same function the
   storefront checkout asks.

3. **`payments.connectLink`** → returns a Stripe account-link URL for the
   in-app "get paid" step. **The return URL must be `sailo://`.**

4. **`uploads.token`** → issues a scoped, short-lived Vercel Blob client token.
   **Bytes never pass through tRPC.**

5. **`account.notificationPrefs`** → read + write the `notificationPrefs`
   column. Write only through the zod schema in
   `apps/web/src/lib/notification-prefs.ts`, which rejects unknown keys.
   Absence of a key means ON — read that file's comment before touching it.

6. **`account.delete`** → reuse `lib/account-deletion.ts` wholesale.

## Details that must not be missed

- **The `sailo://` return URL is the whole point of the Connect step.** Stan's
  app tells the user "please click close in the top left corner to get back to
  the app" — that is an unmanaged webview leaking through at the payment step.
  A06 will open this with `WebBrowser.openAuthSessionAsync`, which dismisses
  itself when the return URL fires. `trustedOrigins: ["sailo://"]` is already
  set in `apps/web/src/lib/auth.ts`.
- **The Blob token must carry the same constraints as the web route**:
  shop-scoped path prefix, the same MIME allowlist, the same size ceilings.
  A token that permits an `.html` upload reopens a stored-XSS hole that route
  closed deliberately.
- Token lifetime should be minutes, not hours. A08 requests one per upload.
- `account.delete` is an **App Store hard requirement** (Guideline 5.1.1(v))
  for any app offering sign-up. It is not optional and it is not phase two.
- Deletion must produce the identical outcome to web deletion — same
  obligations refusal, same ledger retention. Verify against the existing test
  rather than writing a parallel one.
- Notification prefs on mobile are **not** the same thing as the push toggle.
  The push toggle in `lib/push.ts` answers "will this phone buzz" from the OS;
  these prefs answer "which seller emails are on". Both belong on the Settings
  screen and they are different rows. Read the comment on `usePushSettings`.

## Done when

- [ ] `payments.connectLink` returns a URL whose return leg is `sailo://`, and
      opening it in a browser sheet dismisses the sheet.
- [ ] Blob token is shop-scoped, short-lived, and refuses a MIME type the web
      route refuses. Test the refusal.
- [ ] Deletion from mobile produces the identical outcome to web deletion,
      verified by the existing test.
- [ ] `payments.methods` returns the same rails the storefront checkout offers
      for the same shop.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

PR states where `getCheckoutMethods` landed, the Blob token's TTL and scope
shape, and the exact `sailo://` return path so A06 can register the handler.
