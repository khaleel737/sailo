# 01 — Two-Factor Authentication

**Priority:** P0 · **Effort:** S · **Depends on:** nothing · **Blocks:** 02 (ships in the same Security tab)

## What

TOTP two-factor auth for seller accounts: a toggle in a new **Settings → Security**
tab that walks through QR enrolment, verifies one code before enabling, issues
backup codes once, and then requires a code on every password sign-in.
Reference: Stan shows a single "Two-Factor Verification" switch at the top of
its Security tab.

## How

- Auth is BetterAuth (`src/lib/auth.ts`). Add the official plugin:
  `import { twoFactor } from "better-auth/plugins"` in the `plugins` array
  (next to the existing `magicLink`), and `twoFactorClient()` in
  `src/lib/auth-client.ts`.
- The plugin needs new tables/columns (a `twoFactor` table with encrypted
  `secret` + `backupCodes`, and `user.two_factor_enabled`). Write the SQL by
  hand into `drizzle/NNNN_two_factor.sql` mirroring what
  `npx @better-auth/cli generate` outputs, and mirror the columns in
  `src/db/schema/auth.ts`. **Apply to production before pushing code** (see
  README rule 1).
- Sign-in flow: password sign-in returns `twoFactorRedirect` when the user has
  2FA on; add a `/verify-2fa` step to the auth pages under `src/app/(auth)/`
  accepting TOTP or a backup code.

## Details that must not be missed

1. **Magic links bypass passwords — decide their relationship to 2FA and
   document it in code.** BetterAuth's magic link is possession-of-inbox auth;
   by default it does not prompt for TOTP. Either gate `magicLink` sign-ins for
   2FA-enabled users too, or leave it and say why in a comment where the two
   plugins meet. Do not leave it implicit.
2. Enabling requires the current password AND one valid TOTP code — never flip
   the toggle on an unverified secret, or the user locks themselves out at next
   sign-in.
3. Backup codes are shown exactly once, stored hashed, and each is single-use.
   Offer regeneration (invalidates the old set).
4. Disabling 2FA requires password + a current code (or backup code).
5. Rate-limit verification attempts: reuse `rateLimit` from `src/lib/redis.ts`,
   keyed on the user id, not the IP (an attacker with the password is the
   threat). Something like 5 per 15 minutes. Follow the repo rule: a throttled
   attempt is *unknown*, not *wrong* — return "try again later", never
   "invalid code".
6. TOTP verification must accept ±1 time-step drift (plugin default) and must
   be constant-time on the comparison (plugin handles it — do not hand-roll).
7. When 2FA is enabled or disabled, revoke all *other* sessions (the API from
   spec 02) and send a notification email via `src/lib/email/messages.ts` — a
   silent 2FA change is what an account thief does.
8. HQ staff sign-in (`sendHqSignInLink`) is a separate surface — out of scope,
   note it in the PR.

## UI

New tab in `src/app/admin/settings/_components/settings-nav.tsx`
(`/admin/settings/security`, label key `a.settings.tabSecurity`). Every string
needs keys in **all 35** `src/i18n/admin/*.ts` files — the `Translated<T>` type
makes a missing key a compile error, so add to `en.ts` first and let `tsc` list
the rest.

## Testing

- Unit: enrolment state machine (cannot enable without verify; backup code is
  single-use; disable requires proof).
- Scenario (`scripts/scenarios/`): password sign-in with 2FA on requires the
  second step; magic-link behaviour matches whatever was decided in (1).
- Mutation check: remove the verify-before-enable guard and prove a test fails.

## Done when

A seller can enrol, sign in with TOTP, recover with a backup code, and disable;
all other sessions die on enable/disable; email notice sent; gate green.
