# 02 — Login Session History

**Priority:** P0 · **Effort:** S · **Depends on:** nothing (same tab as 01)

## What

A "Login Sessions" table in Settings → Security: location, device, IP, login
time, a "Current Session" badge, a per-row terminate action, and a
"Sign out all other sessions" button. Reference: Stan's Security tab shows
exactly this (e.g. "Zagreb, HR · Chrome - Mac OS X · 188.129.80.212 ·
5 minutes ago").

## The data already exists

`session` in `src/db/schema/auth.ts` already stores `ipAddress` (line 30),
`userAgent` (line 31), `createdAt`, `expiresAt`, and `token`. BetterAuth ships
the APIs: `auth.api.listSessions`, `revokeSession` (by token),
`revokeOtherSessions`. `revokeSessionsOnPasswordReset: true` is already set in
`src/lib/auth.ts:73`, so the revocation path is exercised in production today.
This spec is UI + two small helpers, **no migration**.

## Build

- Server component at `/admin/settings/security` (shared page with spec 01)
  listing sessions for the signed-in user, newest first.
- **Device column:** parse `userAgent` with the existing `parseUserAgent` in
  `src/lib/analytics.ts` (already used by the visits pipeline) — do not add a
  new UA library.
- **Location column:** IP geolocation needs a source. Vercel gives
  `x-vercel-ip-city` / `x-vercel-ip-country` per *request* — that helps only
  for the current session. For stored sessions either (a) store city/country
  at session creation via a BetterAuth `databaseHooks.session.create.before`
  hook reading those headers, or (b) ship column "Location" as "—" for old
  rows and only populate new ones. Option (a) + backfill-as-unknown is
  correct; add nullable `city`, `country` columns to `session` (migration,
  production first).
- **Current session badge:** compare each row's token with the caller's.
- Server actions: `revokeSession(token)` — must verify the token belongs to
  the caller before revoking (IDOR guard; never trust the row index), and
  `revokeOtherSessions()`.

## Details that must not be missed

1. Never render the session token into the page. The terminate action should
   take an opaque row id (session `id`), and the server resolves id → token
   after an ownership check.
2. Terminating the *current* session is sign-out — either disable the action on
   that row (Stan does) or redirect to sign-in after.
3. Expired sessions linger in the table until BetterAuth prunes them — filter
   `expiresAt > now()` in the query.
4. Relative timestamps ("5 minutes ago") must be locale-aware:
   `Intl.RelativeTimeFormat` with the admin locale, not a hand-rolled English
   string. All labels in all 35 `src/i18n/admin/*.ts` files.
5. The revoke actions need a rate limit (light, e.g. 30/min per user) and are
   POST-only server actions.
6. A revoked session must fail *immediately*, not at cookie expiry — verify
   BetterAuth's session cache settings honour revocation (if `cookieCache` is
   enabled, a revoked session can outlive revocation by the cache TTL; check
   the config and shorten or disable the cache if so). This is the one place
   the feature can silently lie.

## Testing

- Scenario: create two sessions (two sign-ins), revoke one, assert the revoked
  token no longer resolves and the other still does; "sign out others" leaves
  exactly the caller.
- Unit: ownership guard — revoking a session id belonging to another user
  refuses without disclosing whether it exists.

## Done when

The table renders real sessions with device + time (+ location for new rows),
terminate works and is immediate, sign-out-all leaves only the caller, and the
IDOR guard has a test proving a foreign session id is refused.
