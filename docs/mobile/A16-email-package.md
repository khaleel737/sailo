# A16 — Extract the transactional email seam

**Wave:** 1 · **Effort:** M–L (1–1.5 weeks) · **Depends on:** nothing ·
**Blocks:** A03's commit 1b (the booking-decision email)

> Split out of A03 once the numbers were counted. `apps/web/src/lib/email/` is
> **3,267 lines** — a 1,062-line message catalogue, 520 lines of HTML markup, a
> Resend transport and four test files. That is not a sub-task of a commerce
> lift, and email templates do not belong inside `@sailo/commerce`.

## Mission

Move transactional email into a package so `apps/api` can send the same mail
`apps/web` sends, with the same templates and the same transport.

## Owns — exclusive write access

- `packages/email/**` (new)
- `apps/web/src/lib/email/**`

## Never touches

`packages/commerce` (A03). Any router file. Any mobile screen. Lifecycle email
scheduling — `lifecycle-messages.ts` moves as a file, but the cron that drives
it stays in `apps/web`.

## Context you need

The current tree:

| File | Lines | What it is |
|---|---|---|
| `messages.ts` | 1,062 | the transactional catalogue |
| `markup.ts` | 520 | HTML building, with its own 302-line test |
| `lifecycle-messages.ts` | 525 | lifecycle campaigns, with a 196-line test |
| `seller-messages.ts` | 254 | seller-facing notifications |
| `transport.ts` | 190 | Resend, and saying plainly when mail didn't go |
| `index.ts` | 6 | barrel |

`transport.ts` opens with `import "server-only"` and reads `RESEND_API_KEY`
lazily, returning `null` when it is absent — so a missing key degrades rather
than throws. **Preserve that.** It is what lets tests and preview environments
run without a mail provider.

`email/preview.test.ts` renders the catalogue; it is your regression net for
the markup move and must pass unmodified.

## Tasks

1. **Create `packages/email`** and move `transport.ts`, `markup.ts`,
   `messages.ts`, `seller-messages.ts`, `lifecycle-messages.ts` into it. Web
   imports back through a re-export shim so no caller changes.

2. **Keep `server-only` semantics.** The package is server-only; nothing in it
   may reach a browser or a React Native bundle. Do not let it become a
   dependency of anything the mobile app imports.

3. **Declare `RESEND_API_KEY`** through a `keys()` export on the package,
   following the pattern `packages/env/src/index.ts` documents — each package
   declares its own variables and each app composes what it depends on.

4. **Tell A15** that `apps/api` needs `RESEND_API_KEY` in its environment.
   Without it the booking email silently does not send from mobile, which is
   the exact bug A03 is trying to close.

5. **Publish the send seam A03 needs**: a typed function that takes a booking
   decision and a recipient and sends the same mail web sends today. A03 calls
   it from `@sailo/commerce`; you own what it does.

## Details that must not be missed

- **Do not change a single template's wording or markup.** This is a move, not
  a redesign. `markup.test.ts` and `preview.test.ts` passing unmodified is the
  proof.
- The catalogue references admin URLs (`admin("/settings/billing")` and
  similar). Those resolve against `NEXT_PUBLIC_APP_URL` today — make sure the
  package reads a value both apps can supply, and that `apps/api` supplies it.
  A link in an email that points at the API origin is a broken email.
- Lifecycle scheduling stays in `apps/web`. Only the message bodies move.
- `emailSuppressions` and `marketingOptOuts` are consulted before sending.
  Confirm the moved code still consults them from both apps — a package that
  can send without checking suppression is a compliance problem, not a bug.
- Nothing here is allowed to make `@sailo/commerce` depend on Resend. A03
  depends on your seam, not on your transport.

## Done when

- [ ] `markup.test.ts`, `preview.test.ts` and `lifecycle-messages.test.ts` pass
      **unmodified**.
- [ ] Web sends byte-identical mail before and after — verify against the
      preview renders, not by eye.
- [ ] A missing `RESEND_API_KEY` still degrades rather than throwing.
- [ ] Suppression and opt-out checks run on the path both apps use.
- [ ] Nothing in `packages/email` is reachable from the mobile bundle.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

PR states the send-seam signature A03 will call, and confirms A15 has been told
about `RESEND_API_KEY` and the app-URL variable for `apps/api`.
