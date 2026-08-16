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

## Layers

Every workspace declares one layer tag in its own `turbo.json`. A layer may only import
downwards:

```
app  →  transport  →  domain  →  capability  →  foundation
```

| Layer | Owns | Packages |
|---|---|---|
| `foundation` | Primitives and vendor-free seams. Knows nothing above it. | `config` `env` `db` `core` `i18n` `observability` `design-system` `storage` |
| `capability` | One external capability behind a seam. No business rules. | `auth` `payments` `billing` `rate-limit` `events` `security` |
| `domain` | Sailo's rules, built on capabilities. | `commerce` `analytics` `customers` `partners` `marketing` `email` `notifications` `webhooks` |
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

## Environment variables

Each package that needs configuration exports `keys()` — a Zod schema over just its own
variables (`packages/db/src/keys.ts`, `packages/payments/src/keys.ts`). Each app composes the
ones it depends on in its own `env.ts` (`apps/web/src/env.ts`, `apps/api/src/env.ts`). No app
is asked for a variable it has no use for, and a missing key fails at build, not at 2am.

`packages/env` holds only what is genuinely shared: the secret both servers must agree on,
and the public values a browser and a native bundle both read under different prefixes.

## Checks

A change is done when all five are clean:

```bash
nvm use 22.22.1        # vitest will not start on the default v20.10
pnpm typecheck
pnpm test
pnpm build
npx knip               # 0 unused files, exports, dependencies
npx turbo boundaries   # 0 layer violations
```
