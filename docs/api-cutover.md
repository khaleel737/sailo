# Moving the API surface onto `api.sailo.store`

`apps/api` now answers `/api/v1/*`, `/api/mcp` and `/api/resend/webhook` as well
as `apps/web`. Both origins serve them from the same code — `@sailo/api/rest`,
`@sailo/api/mcp` — so there is no second implementation to drift.

What Sailo *publishes* has switched over — the documentation, and the MCP URL
in the seller admin, both quote `api.sailo.store` now (step 4). Nothing has been
deleted, so every caller already pointed at the web origin keeps working; the
rest of the switch is a handful of settings changes, in the order below, at
whatever pace you want.

## Why dual mount instead of moving

Each of these three is addressed by configuration we do not control:

| Route | Who holds the URL |
|---|---|
| `/api/v1/*` | integrators, Zapier steps, shell scripts |
| `/api/mcp` | whatever assistant a seller connected |
| `/api/resend/webhook` | the Resend dashboard |

Deleting the web copy in the same deploy that adds the API copy would 404 all of
them at a moment of our choosing rather than theirs. A dropped Resend
notification in particular is a bounce or complaint nobody sees, which is a
sending reputation degrading silently.

### Two mounts, one handler

`/api/mcp` and `/api/resend/webhook` were each a *full copy* of their handler —
353 and 206 lines, byte for byte identical between the apps. Dual mount requires
two route files; it never required two implementations, and a duplicated Svix
signature check is the worst version of the pattern: whichever copy a fix lands
in is the only one that is safe, while the other keeps answering on a URL that is
still live in somebody's dashboard.

Both handlers now live in `@sailo/api` — `@sailo/api/mcp` and
`@sailo/api/webhooks` — and each route file is the mount and nothing else. So
step 4 below is a four-line deletion per route, and until then the two origins
cannot answer differently. `apps/api/e2e/edge.e2e.ts` drives both mounts.

Serving both is safe because all three authenticate from a **bearer credential or
a signature over the body** — an API key, or Svix's signature — and never from
the better-auth session cookie. A second origin therefore cannot force
`SameSite=None` on a real session. `apps/api/src/app/api/partner/events/route.ts`
wrote that rule down first and it is the test every route here was held to.

`apps/docs/src/lib/contract.test.ts` walks **both** `v1` trees, so a route added
to one mount and not the other fails the suite rather than 404ing depending on
which host a caller used. It was `apps/web/src/lib/rest-contract.test.ts` until
the documentation became its own app and took the gate with it — the test has to
live where the pages it holds to the route tree live.

## What you change, in order

### 1. Give `sailo-api` the environment it now needs

`apps/api/src/env.ts` composes `@sailo/email/keys` and `@sailo/security/keys`,
which are new. On the **sailo-api** Vercel project, set:

| Variable | Why |
|---|---|
| `RESEND_API_KEY` | the webhook handler sends nothing, but the package it imports validates the key |
| `RESEND_WEBHOOK_SECRET` | verifies Svix's signature over the raw body |
| `SAILO_MAIL_DOMAIN`, `SAILO_MKT_DOMAIN`, `SAILO_TX_DOMAIN` | sending domains |
| `SAILO_STAFF_EMAILS` | the internal allowlist |
| `CRON_SECRET` | only needed if you later move cron — see below |

Every one is optional in the schema, so a missing value does not stop a boot. It
degrades the feature instead, which is the point: get it wrong and the webhook
refuses deliveries rather than the deployment refusing to start.

**Measured on 2026-08-17, and this is step 1 for a reason:** `RESEND_WEBHOOK_SECRET`
exists on the **sailo** project (production only) and does **not exist on sailo-api
at all**, in any environment. A preview of this branch answers
`POST /api/resend/webhook` with

```json
{"error":"RESEND_WEBHOOK_SECRET is not set"}
```

and a `500`. That is the handler failing closed exactly as designed — an absent
secret on an endpoint that writes reads as "no", never as "yes to everyone" — and
500 is the right code for Resend to see, because Resend retries. But it means step 3
must not happen before step 1: point the dashboard at the API origin today and every
bounce and complaint retries forever against a handler that cannot verify anything.

`scripts/check-deployment.sh` catches this. It is the only check that can: locally
the secret comes from `.env.local`, so every test suite passes with it present.

### 2. Prove it on the API origin before switching anything

```bash
scripts/check-deployment.sh https://api.sailo.store api
```

Nineteen cases over real HTTP, and each asserts *which* refusal it got rather than
"not a 500" — an unsigned webhook must be a 400 and not a 500, a keyless read must be
a 401 and not a 405. For a preview, pass the project's automation-bypass secret as a
third argument; previews are behind SSO and answer 302 to everything without it.

Then the authenticated reads, which need a real key:

```bash
curl -i -H "Authorization: Bearer $KEY" https://api.sailo.store/api/v1/shop
curl -i -H "Authorization: Bearer $KEY" https://api.sailo.store/api/v1/orders
```

The OpenAPI document should name `https://api.sailo.store` in `servers` — it is
derived from the request rather than configured, so it names whichever host
answered. If it says the web host, you are talking to the web deployment.

### 3. Point Resend at the API origin

Resend dashboard → Webhooks → change the endpoint to
`https://api.sailo.store/api/resend/webhook`.

Send a test event and confirm it lands. Delivering to both at once would be
harmless — the handler is idempotent per event id — so there is no rush and no
window to coordinate.

### 4. Move the integrators, then delete the web copies

**The first half is done.** Everything Sailo publishes now quotes
`api.sailo.store`: every `curl` and base URL in the documentation, the MCP
endpoint on `/mcp/connect`, the OpenAPI generator commands, and the MCP URL a
seller copies out of Settings → Integrations. `apiOrigin()` in
`@sailo/core/origin` is where that decision lives, and no page or component
spells a host itself.

It was brought forward deliberately, out of the order the rest of this list
implies, because the cost of waiting is asymmetric. The documentation moved to
its own deployment with **no existing readers**, so quoting the old host would
have manufactured a migration for people who had not arrived yet — every one of
them a caller to chase in the deprecation window below. Publishing the
destination costs nothing while both mounts answer, and it shrinks the
population that step 4's second half has to wait for.

Nothing was deleted and nothing broke: `sailo.store/api/v1` and
`sailo.store/api/mcp` still answer, so every key, script and connected assistant
already pointed at them keeps working.

**What is left** is the deletion. Give the integrators still on the web host a
deprecation window, then delete `apps/web/src/app/api/{v1,mcp,resend}`. That is
a code change; ask for it when the window has passed. Note that `resend` there
is gated on step 1 — see the measurement below, which was still true on
2026-08-18.

## What is staying on `apps/web`, and why

Six routes are **tied to `apps/web`'s Next cache** — they call `revalidateTag`,
`updateTag` or `revalidatePath`, and a cache tag cannot be invalidated from
another deployment. Moving them would mean a card payment landing and the
storefront serving a stale catalogue until something else happened to bust it:

```
cron/sitemap · export/[type] · hq/export/[type] · referral
stripe/webhook · stripe/connect/webhook
```

The Stripe webhooks are the ones worth restating, because the original plan had
them moving. A confirmed payment changes stock, releases downloads and raises an
invoice, and the storefront has to reflect that immediately. The handler itself is
already in packages — `@sailo/payments/stripe` verifies the event and
`@sailo/commerce` acts on it — so nothing is duplicated by the route staying
here. Only the trigger location differs, and this is the deployment whose cache
must be told.

Another six stay for reasons that are not about caching:

| Route | Why |
|---|---|
| `auth/[...all]` | it *issues* sessions. `apps/api` holds a verify-only auth instance by design; moving this would make the API able to grant one |
| `admin/events`, `hq/events` | authenticate from the session cookie. Cross-origin would mean widening a real session to `SameSite=None` — trading a CSRF defence for a routing convenience |
| `download/[token]/[fileId]`, `unsubscribe/[token]`, `unsubscribe/marketing/[token]` | these URLs are in emails already sent. Moving them breaks links in inboxes we cannot edit |
| `booking/[productId]` | an iCal feed a seller pasted into their calendar app. Same problem, longer memory |
| `track` | a beacon called from storefront pages. Same-origin means no preflight and no CORS surface |
| `upload` | web's takes a session cookie from a browser; `apps/api` already has its own bearer-authenticated copy for the phone. Two correct routes, not a duplicate |

## Cron is deliberately not moved

Nine of the ten cron routes could move — only `cron/sitemap` touches the web
cache. They have not been, and the reason is worth writing down rather than
leaving as an omission.

**Cron cannot be dual-run.** Two deployments both on `*/5 * * * *` send every
broadcast twice, pay every partner twice and mail every reminder twice. So unlike
the routes above, it has to be an atomic switch: routes and `vercel.json` entries
move in one commit, and the schedule follows the code on deploy.

That is safe *if* `sailo-api` has `CRON_SECRET` and database access at the moment
that deploy lands. If it does not, every scheduled job 401s and nothing says so
except work quietly not happening — no broadcast, no payout, no reminder.

The architectural benefit is also small: the *work* is already in packages
(`@sailo/marketing/lifecycle`, `@sailo/partners/payouts`,
`@sailo/commerce/memberships`), and the routes are thin `cronAuthFailure` guards
over them. Only the trigger host would change.

So: worth doing, not worth doing casually. When you want it, set `CRON_SECRET` on
`sailo-api`, confirm a deployed preview can reach the database, and ask — it is
one commit that moves nine route files and nine `vercel.json` entries together.
