# Monorepo cutover — switching production to `apps/web`

Production (sailo.store, Vercel team **etheon**, project **sailo**) currently
deploys the **flat** layout from `main`: the Next app sits at the repo root.
The `monorepo` branch moves that app to `apps/web` and shares code through
`packages/*`. Cutover is the one-time switch of the production project from the
root to `apps/web`.

**Nothing about the database or the schema changes.** The monorepo runs the same
migrations (`apps/web/drizzle/0001…0021`) against the same Neon database that
`main` already uses. There is no migration to apply at cutover — prod is already
at 0021.

## State at time of writing

`monorepo` branch is fully green and pushed:

- `turbo typecheck` 9/9 · `turbo test` (db 5 + core 85 + web 1730) · `next build`
  (585 routes) · `oxlint` 0 errors · `knip` 0 · money-path scenario suite green.
- Packages: `@sailo/db`, `@sailo/i18n`, `@sailo/core`, `@sailo/auth` (bearer +
  Expo), `@sailo/api` (tRPC), plus `config`/`env`/`observability`.
- `apps/mobile` typechecks against all of them; the tRPC endpoint is live in the
  build at `/api/trpc/[trpc]`.

## The one coordination hazard

Vercel's **Root Directory** is a project setting that applies to the *next*
deploy. After `monorepo` merges into `main`, the repo root no longer holds a
Next app — so a deploy that runs with Root Directory still `.` **fails**.
Therefore the setting change and the merge must land together, in this order:

1. Change the setting first (no deploy is triggered by a settings change).
2. Then push the merged `main` (this is the deploy that uses the new setting).

Never push the merged `main` while Root Directory is still `.`.

## Cutover steps

### 1. Prove it on a preview first (no production risk)
- In Vercel → project **sailo** → Settings → Git, confirm preview deploys are on
  for branches.
- Temporarily set **Root Directory = `apps/web`** and trigger a preview build of
  the `monorepo` branch (redeploy from the dashboard, or push a trivial commit).
- Verify the preview URL: home, a storefront, `/admin`, `/api/v1/orders` → 401,
  `/api/trpc/shop.get` with a bearer token, and one card checkout in Stripe test
  mode. This is the real validation — a green preview means the layout builds and
  serves on Vercel exactly as it does locally.
- (If you don't want to flip the shared setting before merge, use a throwaway
  Vercel project pointed at the `monorepo` branch with Root Directory `apps/web`.)

### 2. Merge
```
git checkout main
git merge --ff-only monorepo    # or open a PR monorepo → main and merge it
```
Do **not** push yet.

### 3. Flip the production setting
- Vercel → **sailo** → Settings → Build & Deployment → **Root Directory =
  `apps/web`**. Leave Framework Preset = Next.js (auto-detected).
- Install command stays the default: Vercel runs `npm install` at the repo root,
  which links the npm workspaces. No `turbo`-specific build command is required —
  `next build` in `apps/web` transpiles the `@sailo/*` packages via
  `transpilePackages` (already configured in `apps/web/next.config.ts`).
- Environment variables are project-level and **carry over unchanged** (DATABASE_URL,
  Stripe keys, RESEND, BLOB, Redis, BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL …).

### 4. Deploy
```
git push origin main
```
Vercel builds from `apps/web` and promotes to production.

### 5. Verify production
- `curl -s -o /dev/null -w '%{http_code}' https://sailo.store` → 200; `/pricing`,
  a live storefront, `/admin` (redirects to login), `/api/v1/orders` → 401,
  `/api/mcp` POST initialize → 200.
- The 9 crons: `apps/web/vercel.json` is now the one Vercel reads (Root Directory
  = `apps/web`), and the paths are unchanged. Confirm they appear under
  Settings → Cron Jobs after the deploy.
- One real card checkout end-to-end.

## Rollback

If the production deploy misbehaves:
- **Fast:** Vercel → Deployments → promote the last known-good `main` deployment
  (the pre-cutover one) back to production. Instant, no code change.
- **Full:** set Root Directory back to `.` and `git revert` the merge on `main`,
  then push. The flat layout returns.

Because the database is untouched, either rollback is safe — no data migration to
undo.

## After cutover

- Point the mobile app's `EXPO_PUBLIC_API_URL` at `https://sailo.store` (already
  the default in `apps/mobile/lib/api.ts` and `lib/auth.ts`).
- Run `eas init` in `apps/mobile` (needs the Expo account login) to bind the EAS
  project id, then a `preview` EAS build to smoke-test auth + the tRPC read path
  against production.
- Retire this file once the switch is done.
