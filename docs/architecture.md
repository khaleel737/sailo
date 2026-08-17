# Architecture

How Sailo is split, and the rule that decides where a new file goes.

## Topology

```
                       packages/*
              every business rule, framework-free
                    ↑                  ↑
                    │                  │
               apps/web            apps/api
        RSC + server actions    tRPC · REST v1 · webhooks · cron
        (direct import, no                ↑
         HTTP hop, keeps                  │
         `use cache` tagging)        apps/mobile
```

`apps/web` renders. `apps/api` transports. Neither owns a rule.

**Why web does not call the API over HTTP.** It would put a network round-trip between two
Vercel deployments on every page render, lose Next's data cache and `use cache` tagging, and
force token plumbing into a surface that already has a session cookie. Sharing the *package*
gives the same single-source-of-truth guarantee with none of that cost. The thing that must
not be written twice is the rule — not the transport.

**Why the API app exists at all.** The phone cannot import TypeScript from a Next app, and
neither can a third party. `apps/api` is the adapter that hands those clients the same
packages the web app imports directly.

## When something becomes a package

> A package exists when logic is **framework-free** *and* (**consumed by two or more apps**
> *or* **wraps an external vendor**).

Everything else stays in the app that owns it, under `apps/web/src/server/<context>/`. This
is why the internal back-office (`hq`) and the marketing site's blog and SEO helpers are not
packages: one consumer, no vendor, no second implementation possible.

The trigger to promote something is a *second* consumer appearing — which in practice means
the mobile app reaching for it. Promote at that moment, not in anticipation.

### `apps/web/scripts` stays where it is, and this is the measurement

The restructure plan had these 59 files moving to a `tooling/` workspace, on the
grounds that "the web app stops shipping its own seed data". Measured, that reason
does not hold and two others argue the other way:

| Question | Answer |
|---|---|
| Do they import app internals (`@/…`)? | **0 files** — 17 import `@sailo/*` packages only |
| Does `next build` ship them? | No. Nothing under `app/` imports them; they are never in a bundle |
| What do they read at runtime? | `apps/web/.env.local` — where the keys already are |
| How are they invoked? | 27 entries in `apps/web/package.json`, run daily |

So they are already decoupled — the thing the move was meant to achieve. What a move
*would* change is 27 commands the user types and the path every one of them resolves
its environment from, in exchange for a shorter `package.json`. That is a worse trade
than it looked when the plan was written, so it was not taken.

What was wrong there was real duplication, and that is fixed: nine of them had
hand-written the same assertion harness, now `scripts/lib/expect.ts`.

## Layers

Every workspace declares one layer tag in its own `turbo.json`. A layer may only import
downwards:

```
app  →  transport  →  workflow  →  domain  →  capability  →  foundation
```

| Layer | Owns | Packages |
|---|---|---|
| `foundation` | Primitives and vendor-free seams. Knows nothing above it. | `config` `env` `db` `core` `i18n` `observability` `design-system` `storage` |
| `capability` | One external capability behind a seam. No business rules. | `auth` `payments` `billing` `rate-limit` `events` `security` |
| `domain` | Sailo's rules, built on capabilities. Each one is about **one** subject. | `commerce` `analytics` `customers` `partners` `marketing` `email` `notifications` `webhooks` `security` `account` |
| `workflow` | Work that spans contexts and belongs to none of them. | `workflows` |
| `transport` | Shape only — validation, serialisation, status codes. | `api` |
| `app` | Routes, components, wiring. Deployable, never imported. | `apps/web` `apps/api` `apps/mobile` |

`app` also denies `app`: an app is deployed alone, so importing another one is a dependency
the deploy cannot satisfy. Two apps share code only through a package.

**This is enforced, not documented.** The rules live in the root `turbo.json` under
`boundaries.tags`, written as `deny` on the layers above rather than `allow` on those below —
so adding a package to a layer does not mean editing every other layer's list.

```bash
npx turbo boundaries    # must report 0 issues
```

To confirm the check is live rather than decorative, retag any foundation package as
`domain` and re-run: it should report violations from every capability package that imports
it.

### The workflow layer, and the measurement that produced it

Domain packages were importing each other: 18 sideways imports across 12 edges.
Hashing where they came from gave one answer — a function that was not *about* the
package holding it.

`notifySellerOfOrder` is the clearest. It reads an order, checks a notification
preference, sends an email, sends a push. Ask which package owns it: not commerce,
which knows nothing about push; not email, which knows nothing about orders; not
notifications, which knows neither. Sitting inside commerce, it made commerce
depend on the other two.

Seven such functions moved to `@sailo/workflows`. Two other causes were fixed at
the source:

- **`@sailo/email` was two things.** The messages are domain — they know about
  orders and sellers. The Resend client and the HTML kit are a *capability*, and
  holding them here forced `marketing`, `security` and `webhooks` to depend on the
  package that also holds an order receipt. They are `@sailo/mailer` now, and
  those three reach *downwards* for a capability instead of sideways.
- **Two primitives were in the wrong home.** `normalizeTag` is the same class of
  thing as `slug` and `handle` — one right normalisation of a typed string — and
  `isPublicAddress` is address arithmetic with no opinion about Sailo. Both are in
  `@sailo/core`, which is what removed `marketing → customers` and
  `webhooks → security`.

**Result: 2 sideways imports across 2 edges**, and both are the same deliberate
case — `changeOrderStatus` calling `emitOrderWebhook`, and `broadcasts/subscribe`
raising `contact.created`. Those announcements have to happen *inside* the write,
after it and never before; lifting them out would make announcing something a
caller has to remember.

The test for whether something is a workflow: **is the function about its
package?** An order write that announces itself is about the order. A function
whose whole body is "tell three other systems" is about none of them.

### Deviation from next-forge, stated on purpose

next-forge says packages should not depend on each other. That holds for capability packages
— a vendor seam that reaches for another vendor seam is a design error — and Sailo satisfies
it there. It cannot hold for a domain layer: an order genuinely is made of a catalogue, a
payment and a delivery. So the constraint is replaced with a stricter, checkable one:
dependencies must flow one way. An upward import fails the build; a sideways import inside a
layer is allowed.

## Package subpaths

Packages are entered by responsibility, not by one barrel:

```ts
import { formatMoney }   from "@sailo/core/currency";
import { saveProduct }   from "@sailo/commerce/catalog";
import { verifyEvent }   from "@sailo/payments/stripe";
import { isRailUsable }  from "@sailo/payments/offline";
import { orderReceipt }  from "@sailo/email/transactional";
import { Button }        from "@sailo/design-system/web";
import { Button }        from "@sailo/design-system/native";
```

A subpath is a promise about what a file may reach for. `@sailo/design-system/native` is the
only entry that resolves React Native, which is what keeps `apps/web` and `apps/api` from
ever pulling it into a server bundle.

The subpath is also where a miscategorisation shows up first. `formatBytes` and
`formatDuration` lived in `@sailo/core/currency`, so a file uploader printing
"1.5 KB" imported from *currency* — the call site announced the mistake every time
it was read. They are `@sailo/core/format` now. If an import line reads oddly at the
call site, the file is in the wrong place.

`@sailo/api` gained `./webhooks` and `./streams` for the same reason: an inbound
provider webhook and an SSE endpoint are transport, and both were sitting in route
files that had to be copied between the two apps to keep answering.

## Environment variables

Each package that needs configuration exports `keys()` — a Zod schema over just its own
variables (`packages/db/src/keys.ts`, `packages/payments/src/keys.ts`). Each app composes the
ones it depends on in its own `env.ts` (`apps/web/src/env.ts`, `apps/api/src/env.ts`). No app
is asked for a variable it has no use for, and a missing key fails at build, not at 2am.

`packages/env` holds only what is genuinely shared: the secret both servers must agree on,
and the public values a browser and a native bundle both read under different prefixes.

## Where tests live

**A package's tests sit beside the code they cover.** Not as a preference — as
the only arrangement that survives a move. A test in one workspace asserting on
code in another either breaks when the code moves or, worse, keeps passing while
silently covering nothing, which is what happened to four `vi.mock` calls and
six source scans during this restructure.

So the rule is: **the test moves with its subject.** Where a file turned out to
be two tests sharing a name, it was cut in half rather than dragged along —
`consent.test.ts`, `emit.test.ts` and `notify-seller.test.ts` each left their
behavioural half in the package and their "which files in this app do X" half in
`apps/web`, because a source scan cannot follow its subjects across a package
boundary.

Every package runs the same preset, `@sailo/config/vitest`:

```ts
import { sailoTest } from "@sailo/config/vitest";
export default sailoTest();
```

It aliases `server-only` to a stub — the real package throws on import outside a
React Server Component, which is exactly what would stop a server module being
unit-tested. That alias used to be copied into nine packages with nine stub
files. `@sailo/auth` is the one package that extends the preset, for two
accommodations its own header explains.

### A package with no `test` script is a package with no tests

`@sailo/observability` had no `test` script, so `turbo test` skipped it silently —
and what it skipped was `scrub`, the function that keeps a seller's customer list out
of a third-party error tracker, which existed in two copies and was covered by
neither. A missing script does not fail any gate; it just quietly removes a workspace
from the run. Worth checking against the task count: `turbo test` runs **26** tasks
across 29 workspaces today, and the three without one own no testable code.

### Untestable code stays untested, so take the world as an argument

The basket's `localStorage` store reached for `window` directly, and `apps/web` runs
vitest in a node environment with no jsdom — so the code holding a buyer's basket
across a page load could not be unit-tested at all, and was not. Taking the storage
and the event target as parameters, defaulting to the real ones, made every rule in
it checkable in plain node with no new dependency. If something important has no
test, ask whether it is *possible* to write one before concluding nobody bothered.

### Guard a duplicate you are choosing to keep

`/api/v1/*` is mounted in both apps on purpose, and the nine route bodies are the
endpoints' parameter surface — worth keeping readable rather than lifting into the
package behind an indirection. That leaves nine duplicates, so
`apps/api/src/dual-mount.test.ts` compares every shared route across the two trees
with comments stripped. A deliberate duplicate needs a test that it stays a copy;
otherwise the divergence ships to whichever origin a caller happened to reach.

**Each app owns its end-to-end layer**, and each app's is shaped by what it
actually is:

| App | Unit | End-to-end |
|---|---|---|
| `apps/web` | `src/**/*.test.ts` — its own actions, handlers, i18n, proxy | `e2e/*.spec.ts` (Playwright, a real browser) and `e2e/scenarios/*.scenario.ts` (against a real Postgres — `./e2e/scenarios/up.sh`) |
| `apps/api` | `src/**/*.test.ts` | `e2e/*.e2e.ts` — every route driven through its real handler over real `Request` objects (`pnpm test:e2e`) |
| `apps/mobile` | `lib/*.test.tsx`, `components/*.test.tsx` | `tests/*.test.tsx` — screens driven through `@testing-library/react-native`, plus a cold-launch check |

`apps/api`'s suite is new and deliberately does not reach the database: a route's
job there is to decide *who is asking* and refuse if the answer is nobody, and
that happens before any query. What a procedure does with a valid `shopId` is
covered where that logic lives.

A note on writing them, learned the hard way in that suite: the first version of
its "refuses an unauthenticated call" test asserted *any* 4xx and passed on a
405, because it sent a POST to a query. **Assert the reason, not the shape** — a
test that cannot tell "we refused you" from "you used the wrong verb" is not
testing authorisation.

## Checks

A change is done when all five are clean. **Run them in this order**, and one at a
time:

```bash
nvm use 22.22.1        # vitest will not start on the default v20.10
set -a; source .env.local; set +a   # knip loads apps/web/drizzle.config.ts

npx turbo build        # must come first — see below
npx turbo typecheck
npx turbo test
npx knip               # 0 unused files, exports, dependencies
npx turbo boundaries   # 0 layer violations
```

Build first because `apps/web`'s `typecheck` is `next typegen && tsc`, and its
tsconfig includes `.next/types/**/*.ts` — files that only `next build` writes.
Run in one `turbo typecheck build` invocation the two race, the build clears
`.next/types` while tsc is reading it, and typecheck fails with `TS6053: File
'.next/types/cache-life.d.ts' not found` on a tree that is perfectly fine.

`npx turbo …` rather than `pnpm …`: `pnpm build` at the root is interpreted
recursively and dies on the first workspace with no `build` script.

If typecheck fails inside `.next/dev/types/routes.d.ts` with a syntax error, the
generated file is corrupt from an interrupted dev server — `rm -rf
apps/web/.next/dev/types` and run again.

If it fails with `EPERM: operation not permitted, open '.next/types/routes.d.ts'`
in **both** apps at once, that is the two `next typegen` runs racing, not a
problem with the tree — the same command passes 34/34 with
`npx turbo typecheck --concurrency=1`. Re-run it that way before believing it.
