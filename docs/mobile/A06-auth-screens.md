# A06 — Auth & onboarding screens

**Wave:** 2 · **Effort:** L (2 weeks) · **Depends on:** A00, A02, A04, A05 ·
**Blocks:** A14

> **Everything in this work order is net new.** Today `app/index.tsx` calls
> only `signIn.email`. A new seller cannot create an account, claim a handle,
> or make a shop from the app at all.

## Mission

Take a person from a fresh install to a working shop without them touching a
browser.

## Owns — exclusive write access

- `apps/mobile/app/(auth)/**`
- `apps/mobile/lib/auth.ts`

## Never touches

Any tab screen. `apps/web/src/lib/auth.ts` — the server config is A13's, and
you need no server change.

## Context you need

`packages/auth/src/index.ts` already wires `expoClient`, `twoFactorClient` and
`magicLinkClient`. **The 2FA and magic-link clients have no UI behind them** —
that is your job.

`apps/mobile/lib/auth.ts` explains why `EXPO_PUBLIC_AUTH_URL` is deliberately
not `EXPO_PUBLIC_API_URL`: sessions are issued by `apps/web` only. `apps/api`
carries a verify-only better-auth instance that can read a session and never
mint one. Read that comment before changing anything about the client.

`apps/web/src/lib/auth.ts` sets `requireEmailVerification: false` — sign-up is
instant and a banner nags until confirmed. Mirror that; do not gate the app
behind verification.

`shops.handle` is the storefront address. `checkHandle` returns a
`HandleStatus`; A02 exposes it as `shop.checkHandle`.

## Screens

| Screen | Notes |
|---|---|
| Welcome | Brand, sign in / create account |
| Sign in | Email + password, and "email me a link" |
| Magic link sent | Waiting state, resend with a cooldown |
| 2FA challenge | TOTP code + backup code fallback |
| Sign up | Name, email, password (min 8) |
| Verify email | Non-blocking; nags, does not gate |
| Claim handle | Live availability as they type |
| Create shop | Name, currency, country |
| Get paid *(optional)* | Stripe Connect, skippable |

After create-shop, land on Home with the checklist at 0 of 4.

## Details that must not be missed

- **Leave a social button slot.** A labelled, empty region below the email
  form that A14 fills with Apple and Google buttons. Do not build the buttons
  and do not lay out the screen so adding two buttons forces a redesign.
- **The Connect step must not repeat Stan's mistake.** Open
  `payments.connectLink` with `WebBrowser.openAuthSessionAsync` and the
  `sailo://` return URL A04 provides, so the sheet **dismisses itself**. Stan
  ships copy reading "please click close in the top left corner to get back to
  the app" — that is the exact failure this avoids. Refetch `shop.setup` on
  return so the tick lands while the seller is watching.
- **Handle availability is debounced and cancellable.** A keystroke that
  outraces a response must not paint a stale answer. Show taken/available/
  checking as three distinct states, never a silent empty.
- **2FA is a *challenge*, not an error.** better-auth answers a 2FA-enrolled
  sign-in with `twoFactorRedirect` rather than a session. Handle that response
  shape explicitly; treating it as a failure is the bug here.
- **Magic link must deep-link into the app**, not Safari. `sailo://` is already
  in `trustedOrigins`; A00 configured `associatedDomains`. Test on a device
  with the app backgrounded and with it killed.
- Sign-out already has a correct order in the existing code: `forgetDevice()`
  **before** `authClient.signOut()`, then `queryClient.clear()`. Read the
  comments in `app/index.tsx` and `settings/index.tsx` — both explain why, and
  the cache clear prevents a cross-tenant paint on a shared handset. Preserve
  all of it.
- Rate limiting is server-side and already in place. A throttled answer is
  *unknown*, never a negative — do not render "wrong password" for a 429.
- `keyboardType`, `autoComplete` and `textContentType` on every field, so
  iOS offers the right keyboard and the password manager works.

## Done when

- [ ] A brand-new person reaches a working shop without touching a browser.
- [ ] A 2FA-enrolled seller can sign in on a device.
- [ ] A magic link opens the app from both backgrounded and killed states.
- [ ] Handle collisions surface before submission, not after.
- [ ] The Connect sheet dismisses itself and the checklist tick appears without
      a manual refresh.
- [ ] Signing out then signing in as a different seller shows no trace of the
      first seller's data, at any point.
- [ ] Every string comes from `@sailo/i18n/native`; Arabic renders RTL.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

PR names the exact file and region where A14 adds the social buttons.
