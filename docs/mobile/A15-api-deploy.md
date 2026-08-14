# A15 — Deploy apps/api

**Wave:** 1 · **Effort:** S–M (2–4 days) · **Depends on:** nothing ·
**Blocks:** A06–A10 testing against anything real

> `apps/api` has never been deployed. There is no `.vercel` directory in it,
> and the root `.vercel/project.json` points at project `sailo`, which is
> `apps/web`. **Today the mobile app has no server to talk to.**
>
> Local development works — `pnpm --filter @sailo/api-server dev` serves on
> :3002 — so Wave 1 is unblocked. Wave 2 agents need a real origin.

## Mission

Stand up `apps/api` as its own deployment with its own origin, and point the
mobile app at it.

## Owns — exclusive write access

- `apps/api/**` (deployment config only — not `src/`, which is A02/A03/A04's
  router surface reached through `@sailo/api`)
- `apps/mobile/lib/api.ts` (the `BASE` default only)
- `.env.example`
- The Vercel project, its domain and its environment variables

## Never touches

`packages/api/src/**`. Any router file. Any screen.

## Context you need

`apps/api/next.config.ts` says what this app is: route handlers and nothing
else. No `cacheComponents`, no image pipeline, no CSP — it serves JSON to the
mobile client and to machines.

Its routes today:

| Route | Purpose |
|---|---|
| `src/app/api/trpc/[trpc]/route.ts` | the entire mobile read/write surface |
| `src/app/health/route.ts` | health check, already tested |
| `src/app/api/partner/events/route.ts` | partner webhook |

`apps/mobile/lib/api.ts` documents the architecture and is worth reading in
full before you change its one line:

> The *api* origin — apps/api, which serves `/api/trpc` and nothing that issues
> a session. Separate from `EXPO_PUBLIC_AUTH_URL` on purpose: the two halves
> answer on different hosts in every environment except the one where a single
> dev server happens to serve both.

**Its fallback is currently `https://sailo.store`, which is the web origin and
returns 404 for `/api/trpc`.** That default was written anticipating a cutover
that put both on one host. It is wrong for a split deployment and must change.

`apps/mobile/lib/auth.ts` explains the other half: sessions are minted by
`apps/web` only. `apps/api` carries a **verify-only** better-auth instance that
can read a session and never mint one. Pointing sign-in at this app would reach
a server with no such route. Do not "helpfully" add auth routes here.

## Tasks

1. **Create the Vercel project** for `apps/api` with Root Directory
   `apps/api`. Framework preset Next.js, auto-detected.

2. **Domain.** `api.sailo.store` is the obvious choice. Record whatever you
   pick; three things then reference it.

3. **Environment variables.** Compose from what the app's packages declare via
   their `keys()` exports — `DATABASE_URL` (`@sailo/db`), `REDIS_URL`
   (`@sailo/rate-limit`), `BETTER_AUTH_SECRET` (`@sailo/env`), plus whatever
   `@sailo/events` needs.

   Also `API_ALLOWED_ORIGINS` — read by the tRPC route's CORS allowlist. Leave
   it **empty** for now: the only client is the native app, which is not subject
   to CORS at all. Populate it only when a browser client appears.

4. **Point the app at it.** Set `EXPO_PUBLIC_API_URL` for each EAS build
   profile in `eas.json`, and change the `BASE` fallback in
   `apps/mobile/lib/api.ts` from `https://sailo.store` to the new origin.

5. **Document the mobile variables in `.env.example`** — `EXPO_PUBLIC_API_URL`
   and `EXPO_PUBLIC_AUTH_URL` are absent from it today, with only
   `BETTER_AUTH_URL` present in `.env.local`.

6. **Verify end to end**: `/health` returns 200, and a tRPC call with a real
   bearer token returns that shop's data — and only that shop's.

## The thing that will silently break everything

**`BETTER_AUTH_SECRET` must be byte-identical between `apps/web` and
`apps/api`.** `packages/env/src/keys.ts` documents the failure mode exactly:

> Those two must be configured with the *same* secret: a session signed by one
> and read by the other is only valid because the HMAC matches. Configure them
> apart and apps/api rejects every token apps/web issues, which presents as
> "the mobile app can't log in" rather than as a mismatched secret.

Set it by copying the value, not by generating a new one. Then verify by
actually signing in on a device — a matching-looking dashboard field is not
proof.

## Details that must not be missed

- **Do not add session-issuing routes here.** The verify-only instance is
  deliberate. Sign-in, sign-up, 2FA, magic link and their email and rate
  limiting all live in `apps/web` and stay there.
- **Crons stay in `apps/web`.** `apps/web/vercel.json` holds all nine; this app
  has no `vercel.json` and should not grow one for scheduled work.
- **Rate limiting needs `REDIS_URL`.** Without it `@sailo/rate-limit` degrades,
  and a throttled answer must remain *unknown* rather than becoming a negative
  — check what the degraded path actually does before shipping without Redis.
- **CORS is already correctly implemented — do not touch it.** The tRPC route
  carries an explicit origin allowlist driven by `API_ALLOWED_ORIGINS`, with
  `Vary: Origin` on every response so a shared cache cannot leak an allowed
  origin's headers to an unlisted caller, and `*` deliberately unsupported.
  Read the comment block; it explains why an origin reflected back from the
  request is not an allowlist. **Empty is the correct value today.**
- **The session travels as either carrier.** `apps/api/src/lib/context.ts`
  calls `getSession({ headers })`, which accepts `Authorization: Bearer` *or*
  the `Cookie` header the Expo client keeps in the keychain — the mobile client
  currently sends the latter. Both work; do not "fix" one to match the other.
  That context module is the authorisation boundary in its entirety, which is
  why it lives outside the route file. Leave it alone.
- `transpilePackages` in `next.config.ts` is the transitive closure of what
  this app imports, deliberately not a superset. **When A02 adds
  `@sailo/analytics`, that list needs the entry** — a missing package fails at
  build time with an import error that reads like a bug in the package. Tell
  A02.
- Preview deployments: give the mobile `development` and `preview` EAS profiles
  a stable preview origin, or agents will be rebuilding to change a URL.

## Done when

- [ ] `https://<api-origin>/health` returns 200.
- [ ] A tRPC call with a real bearer token returns that shop's data.
- [ ] A tRPC call with another shop's id in the input returns `NOT_FOUND`, not
      that shop's data.
- [ ] Signing in on a device and reading the dashboard works end to end —
      proving the shared secret matches.
- [ ] `EXPO_PUBLIC_API_URL` set per EAS profile; the `lib/api.ts` fallback no
      longer points at the web origin.
- [ ] `.env.example` documents both mobile variables.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

PR states the API origin, confirms the shared-secret verification was done by
signing in on a real device, and tells A02 to add `@sailo/analytics` to
`transpilePackages`.
