# A14 — Apple + Google sign-in: mobile

**Wave:** deferred · **Effort:** M (1 week) · **Depends on:** A13, A06 ·
**Ships with:** A13 (same release, always)

> **Sign in with Apple is mandatory the moment Google ships.**
> App Store Review Guideline 4.8 requires an equivalent privacy-preserving
> login option wherever a third-party social login is offered. There is no
> version of this where Google lands first and Apple follows next sprint —
> the same binary carries both or it gets rejected.

## Mission

Put Apple and Google buttons on the sign-in screen, using native sheets, and
let a seller manage linked accounts from Settings.

## Owns — exclusive write access

- `apps/mobile/app/(auth)/_social/**`
- The social button slot A06 left in the sign-in screen (A06's PR names the
  exact file and region)
- `apps/mobile/app.json` — **auth keys only** (`ios.usesAppleSignIn`, the
  Google config plugin entry). Nothing else in that file.

## Never touches

`apps/web`. `packages/auth`. Any other mobile screen.

## Context you need

A00 reserved `ios.usesAppleSignIn: false` as a documented flag and enabled the
**Sign in with Apple capability** on the `store.sailo.app` App ID. You flip the
flag.

A06 built the sign-in screen with a labelled empty region below the email form,
sized so adding two buttons needs no relayout.

A13 configured the providers server-side. `trustedOrigins: ["sailo://"]` was
already set before either of you started.

`apps/mobile/lib/auth.ts` explains why `EXPO_PUBLIC_AUTH_URL` points at the web
origin and not the API origin — sessions are minted by `apps/web` only. Do not
change that.

## Tasks

1. **`expo-apple-authentication`** — the real native sheet, not a webview.
   Flip `ios.usesAppleSignIn` to `true`.

2. **Google via the native sign-in sheet**, not a browser redirect. Materially
   better conversion, and it is what sellers expect on a phone.

3. **Both native flows pass an `idToken` straight to better-auth** — no
   redirect leg, no browser hop, nothing for the user to dismiss.

4. **Register the Android SHA-1 for every EAS build profile.** Development
   working while release fails is the standard symptom of a missing
   fingerprint. `development`, `preview` and `production` each need theirs.

5. **Linked accounts** in Settings → Security, mirroring the web card A13
   builds. Connect and disconnect, and the same refusal to unlink the last
   credential.

6. Google needs **three OAuth clients** — web (A13 uses it), iOS, and Android.
   The iOS and Android client ids are public and belong under
   `EXPO_PUBLIC_`; the secret stays server-side.

## Details that must not be missed

- **Apple's button styling is enforced at review.** Wrong corner radius, wrong
  wording ("Sign in with Apple", not "Login with Apple"), wrong relative
  prominence — all get flagged. Follow Apple's Human Interface Guidelines for
  the button exactly, and use their provided component rather than drawing one.
- **Apple returns a name only on the first authorisation.** A13 handles
  persistence server-side, but the *client* must actually send it on that first
  call — it arrives in the credential and is absent on every subsequent
  sign-in. Dropping it client-side means it is gone forever.
- **Hide My Email is the case that breaks quietly.** A seller who uses it gets
  an `@privaterelay.appleid.com` address. If A13's relay-domain registration
  is missing, order notifications silently bounce and nothing in the app looks
  wrong. Your acceptance test is receiving a real email at a relay address.
- **An existing password seller signing in with Google on the same address must
  land in the same account**, not a duplicate. A13 configured linking; you
  verify it end to end from a device.
- **No ATT prompt.** There is no Facebook SDK in this scope and there must be
  no advertiser tracking. If anything you add triggers an App Tracking
  Transparency prompt, you have added the wrong dependency.
- The 2FA challenge screen A06 built must be reachable from the social path
  too — a 2FA-enrolled seller signing in with Google gets challenged.
- Sign-out ordering is unchanged and still matters: `forgetDevice()` **before**
  `signOut()`, then `queryClient.clear()`.
- Button order: Apple first on iOS. Do not use provider brand colours for
  anything other than the buttons themselves.

## Done when

- [ ] Sign up with Apple using **Hide My Email**, then **receive** a real order
      notification at the relay address. (This is the test that catches an
      unregistered sending domain — sending is not receiving.)
- [ ] Sign in with each provider on a clean device, then sign out and back in.
- [ ] An existing password seller signing in with Google lands in the same
      account, not a duplicate.
- [ ] A 2FA-enrolled seller is challenged on the social path.
- [ ] Android release build signs in — proving every SHA-1 is registered.
- [ ] Apple's name is captured on first sign-up and persists.
- [ ] **No ATT prompt appears anywhere in the app.**
- [ ] App Privacy questionnaire updated — you now collect data from third
      parties. Coordinate with A12's checklist.
- [ ] Sign-in screen needs no relayout from A06's slot.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

Ship in the same release as A13. Flag to A12 that the store listing's privacy
answers have changed.
