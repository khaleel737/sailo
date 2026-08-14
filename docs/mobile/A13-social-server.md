# A13 — Apple + Google sign-in: server

**Wave:** deferred · **Effort:** M (1 week) · **Depends on:** nothing ·
**Ships with:** A14 (same release, always)

> Can be built and merged at any time. The config is inert until A14 ships the
> buttons, so this is safe to land early.
>
> **Apple and Google only.** Facebook and Instagram are explicitly out of
> scope — see "Why only two" below.

## Mission

Add Apple and Google as identity providers on the better-auth server, with
account linking, and a place on the web to manage linked accounts.

## Owns — exclusive write access

- `apps/web/src/lib/auth.ts`
- `packages/auth/**`
- `packages/auth/src/keys.ts` (new)
- `apps/web/src/app/admin/settings/security/_components/linked-accounts-card.tsx` (new)

## Never touches

`apps/mobile` — A14 owns every mobile-side change.

## Context you need

`apps/web/src/lib/auth.ts` currently configures `emailAndPassword`,
`magicLink()`, `twoFactor()` and `bearer()`, with `trustedOrigins: ["sailo://"]`
already set for the mobile app. **There are no social providers today.**

`packages/db/src/schema/auth.ts` — the `account` table is stock better-auth:
`accountId`, `providerId`, `userId`, plus `accessToken`, `refreshToken`,
`idToken`, expiry columns and `scope`. **Multiple providers per user already
works. There is no migration in this work order.**

`user.name` is `notNull`.

`packages/env/src/index.ts` documents the pattern: each package declares its own
variables through a `keys()` export, and each app composes the ones it depends
on. Follow it — `packages/auth/src/keys.ts` is new and is where these belong.

## Why only two

Both Apple and Google **verify email addresses**, which means account linking
has one policy instead of two — there is no untrusted-provider branch and no
takeover vector to reason about. Both **always return an email**, so there is
no emailless-account case to design around. Neither requires App Review for
basic profile scopes or business verification.

If a non-verifying provider is ever added, the linking policy below must be
revisited. **Say so in a comment where you enable it.**

## Tasks

1. **`socialProviders`** for `apple` and `google` in `apps/web/src/lib/auth.ts`.

2. **`packages/auth/src/keys.ts`** with the zod schema for:
   - `APPLE_CLIENT_ID` (the **Services ID**, not the App ID)
   - `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`
   - `APPLE_APP_BUNDLE_IDENTIFIER` (`store.sailo.app`, for native token
     verification)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

   Compose it into `apps/web`. Add placeholders to `.env.example`.

3. **Account linking**, enabled, with both providers trusted because both
   verify email. Comment the reasoning.

4. **Persist Apple's name on first callback.** Apple returns the user's name
   **only on the very first authorisation, once, ever**. `user.name` is
   `notNull`. If it is absent, derive a placeholder — never write an empty
   string and never fail the sign-up.

5. **Register the Resend sending domain with Apple's private email relay**
   (Apple Developer → Certificates, IDs & Profiles → Sign in with Apple for
   Email Communication). Without it, every email to a
   `@privaterelay.appleid.com` address **silently bounces** — which means a
   seller who used Hide My Email gets no order notifications and no password
   resets, and nothing in the app looks broken.

6. **Document Apple client-secret rotation.** The secret is a JWT you generate
   from the `.p8` key with a **maximum six-month life**. Write the procedure
   down and put a dated reminder somewhere real. This is the classic "auth
   broke on a Tuesday for no reason" outage.

7. **Verify the 2FA interaction.** A seller with `twoFactorEnabled` signing in
   with Google must still be challenged. better-auth answers with
   `twoFactorRedirect` rather than a session — confirm that holds for the
   social path and **write the test**.

8. **Linked accounts card** at `/admin/settings/security`, beside the existing
   sessions and two-factor cards. Connect and disconnect.

## Details that must not be missed

- **Refuse to unlink the last credential.** A seller with only Google linked
  who disconnects it has an account they can never reach again. The card must
  refuse, and say why.
- **Decide and document the collision policy**: an existing password account,
  then "Continue with Google" on the same address. Linking is the right answer
  here because Google verifies the address — but it must be a decision written
  in a comment, not an accident of configuration.
- The `hooks` block in `auth.ts` blocks staff addresses from reaching sign-up.
  **Confirm the social path honours it** — a provider callback that bypasses
  that hook is a hole.
- Rate limiting applies to the social callback too. Throttled is *unknown*,
  never a negative answer.
- Do not remove or weaken `emailAndPassword`. Social is additive; sellers who
  signed up with a password keep working exactly as before.
- Apple's Services ID and App ID are **different identifiers**. The web flow
  uses the Services ID; native token verification uses the bundle identifier.
  Getting these crossed is the most common Apple setup failure.

## Done when

- [ ] **Zero database migrations.** The `account` table already supports this.
- [ ] Every existing auth test passes untouched.
- [ ] A seller with password + Google + Apple can unlink any two and still
      sign in; unlinking the last one is refused with an explanation.
- [ ] A 2FA-enrolled seller signing in with Google is challenged. Tested.
- [ ] Staff-address blocking holds on the social path. Tested.
- [ ] Apple client-secret rotation documented with a dated reminder.
- [ ] Resend sending domain registered with Apple's relay, and a test email to
      a relay address **received**, not just sent.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

PR states: the exact provider ids configured, the linking policy and its
reasoning, the client-secret expiry date, and confirmation that the relay
domain is registered.
