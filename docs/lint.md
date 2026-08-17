# Lint

One config at the repo root, `.oxlintrc.json`, and every workspace runs it:

```json
"lint": "oxlint src --config ../../.oxlintrc.json"
```

`apps/web` extends it and adds the React, JSX-a11y and browser half; `apps/mobile`
lints `app lib components tests` instead of `src`. Nothing else differs.

## The `|| true` that was there before

Twenty-three of twenty-six workspaces ran `oxlint src || true`. The exit code was
discarded, so `turbo lint` reported success no matter what oxlint found, and no
workspace except `apps/web` had a config at all — meaning the packages ran on
oxlint's bare defaults and then threw the result away.

What that hid: **53 unused imports and variables**, including eleven in a single
file. `knip` did not catch them because knip looks for unused *exports* and
*files*, and an unused import inside a file it can see is neither.

The `|| true` is gone. `turbo lint` fails the run now.

## `unicorn/no-array-sort` is off, and this is the reason

The rule wants `Array#toSorted()` instead of `Array#sort()`, on the grounds that
`sort` mutates. It fired twenty times, and among the files it fired in were
`@sailo/core/place/countries.ts` and `@sailo/core/catalog/variants.ts`.

Both are bundled into the phone. `toSorted` does not exist in Hermes.

This is not hypothetical — `packages/config/tsconfig.hermes.json` documents the
release it cost:

> `countriesByName` in `@sailo/core` was written as `.map(…).toSorted(…)`,
> typechecked clean, passed jest, passed the web build, shipped — and then threw
> `toSorted is not a function` the moment a seller opened the screen that picks a
> country, taking the Clients and Categories screens down with it.

So the lint rule, enabled, pushes code directly into the bug that
`lib: ["es2022"]` exists to catch. A guard that argues with another guard has to
lose, and this is the one that loses: the Hermes floor is a fact about a runtime
we ship to, and the mutation concern is a preference.

If a future rule wants an ES2023 array method, the same answer applies.

## Test files relax six rules

Drizzle mocks are the reason. Building a fake query builder means a chainable
object with a `then` on it (`unicorn/no-thenable`), method names that shadow the
outer `vi.fn()` holding them (`no-shadow`), and `expect(x?.y).toBe(…)` where the
optional chain is the assertion (`no-unsafe-optional-chaining`).

Every one of those is deliberate in a mock and a smell in source, so they are
switched off for `*.test.ts`, `*.scenario.ts` and `*.e2e.ts` only. `no-unused-vars`
stays on everywhere — an unused import in a test is dead code exactly as it is
anywhere else.

## Two overrides that are about file *identity*, not style

`unicorn/filename-case` wants kebab-case, and it is off under every app's routing
directory. `apps/mobile/app/checkin/[productId].tsx` and
`apps/web/src/app/[handle]/page.tsx` are not badly named files — the filename *is*
the route, brackets and camelCase param included, and renaming one changes a URL.
The rule stays on everywhere else, where a filename is only a filename.

Scripts under `scripts/` and `tooling/` may use `console` and non-null
assertions. They run on a laptop against a throwaway database, print to a
terminal on purpose, and a crash in one costs a re-run.

## What stays as a warning

`no-await-in-loop` fires 63 times and most of them are correct as written: a
batch of sends that must be sequential to respect a provider's rate limit is not
a `Promise.all` waiting to happen. `unicorn/consistent-function-scoping` is the
same shape of advice. Both are warnings, which `turbo lint` reports without
failing.
