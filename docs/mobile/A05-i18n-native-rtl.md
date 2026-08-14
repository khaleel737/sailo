# A05 — i18n native entry & RTL

**Wave:** 1 · **Effort:** S (3–4 days) · **Depends on:** A00 ·
**Blocks:** A06, A07, A08, A09, A10

> **Sequence this first in Wave 1 despite being the smallest package.**
> Retrofitting localisation means reopening every screen.

## Mission

Make 35 locales and RTL available to the mobile app without shipping 35
dictionaries in the launch bundle, and publish the layout rule every other
agent has to follow.

## Owns — exclusive write access

- `packages/i18n/**`
- `apps/mobile/lib/i18n.tsx` (new)

## `@sailo/i18n` stays a zero-dependency package

**Do not add `react`, `react-native` or `expo-secure-store` peers** — not even
optional ones. The package has no dependencies today and that is load-bearing:
`@sailo/core` imports it for the `Dictionary` type in `plans.ts`, and core is
imported by `packages/api` and by `apps/web` server code. A react-native peer on
i18n means **`apps/api` — a headless JSON server — inherits a React Native peer
requirement.** It also drags a lockfile importer block into scope, which is how
this turns into a shared-tree problem it never needed to be.

Split by purity instead:

**`@sailo/i18n/native` — pure, no framework.**
- the dynamic-import map, locale → `() => import("../dictionaries/xx")`
- locale negotiation: given candidate tags, return a supported `Locale`
- the RTL locale set — which locales are RTL is data, not behaviour

**`apps/mobile/lib/i18n.tsx` — the wiring, where the framework already lives.**
- the `useT()` hook (React)
- `I18nManager` setup (React Native)
- reading the device locale (`expo-localization`)
- persisting an override (`expo-secure-store`)

`apps/mobile` already declares all three. Nothing new enters the workspace, the
lockfile is untouched, and `pnpm install --frozen-lockfile` keeps passing.

If a hook genuinely has to be shared rather than app-local, its home is
`packages/design-native` — which already depends on react and react-native —
never here.

## Never touches

Any screen. Any other package.

## Context you need

`packages/i18n/src/index.ts` loads **all 35 dictionaries eagerly**, with a
comment explaining why:

> Every locale is loaded eagerly. The dictionaries are small plain objects and
> the alternative — dynamic import per request — costs a promise on the render
> path for no real benefit at this size.

That is **correct for a Node server** rendering any locale per request. It is
wrong for a React Native bundle, where 35 × ~1,071 admin keys is dead weight
on every cold start. Both facts are true at once; the server behaviour must
not change.

`packages/i18n/src/admin/en.ts` is 1,361 lines and the typed source — missing
keys in other locales are compile errors. Use that.

The mobile app currently has **hardcoded English strings** in every screen.

## Tasks

1. **Add a `@sailo/i18n/native` export.** Static import of `en`; dynamic
   `import()` for the other 34, resolved on demand. The existing root export
   and its eager loading stay exactly as they are.

2. **Locale resolution**, falling back to `en`, overridable from Settings and
   persisted.

   Read the device locale **without a new dependency for now** — a single
   `deviceLocales()` function over `I18nManager.localeIdentifier` on Android
   and `Intl` elsewhere. Adding `expo-localization` means editing
   `apps/mobile/package.json` (A00's), regenerating the lockfile in a shared
   tree, and forcing every agent to rebuild their dev client mid-flight.

   **`expo-localization` rides along with A01 instead.** A01 is already adding
   Unistyles/Nitro, Reanimated, FlashList and SVG, and already forces one
   dev-client rebuild. Batch it there so the rebuild happens once. After A01
   lands, swapping `deviceLocales()` to read
   `Localization.getLocales()` is a one-function change.

   Until then the gap is real and must be documented in both the README and
   next to `deviceLocales()`: the platform APIs return **one** locale, not the
   seller's ordered preference list, so someone whose first language Sailo does
   not ship falls to English rather than to their second choice.

   **Verify `Intl` on a real device before relying on it.** Hermes has had
   partial `Intl` support historically; a simulator agreeing is not proof. If
   it returns something useless on iOS, say so rather than shipping a silent
   fallback to `en` for everyone.

3. **RTL setup.** `I18nManager` configuration, and the documented rule that
   *all* layout uses logical properties. Publish that rule — A01 and every
   screen agent needs it before they write a style.

4. **Audit the admin dictionary** for keys that assume a browser (anything
   naming a tab, a window, a right-click, a hover, a URL bar). Flag them in
   your PR; do not silently reuse them on mobile and do not rewrite them —
   that's a product decision.

5. **A `useT()` hook** for mobile mirroring the web's `getAdminT()` shape, so
   screens read keys the same way both sides of the codebase do.

## Details that must not be missed

- **RTL is not just mirroring.** Numbers stay LTR inside RTL text, currency
  symbol placement is locale-dependent, and `formatMoney` already handles
  locale — route through it rather than string-concatenating a symbol.
- **Changing locale must not require an app restart.** If it does, say so
  explicitly in the PR; `I18nManager.forceRTL` historically needs a reload to
  flip direction, and if that's unavoidable the Settings screen must warn the
  user rather than appearing broken.
- Arabic (`ar`) is the RTL locale that matters most for Sailo's markets. Test
  with it specifically, not with a pseudo-locale.
- Do not add a translation-management dependency. The dictionaries are typed
  TS objects and that is the system.
- The dynamic `import()` must work under Metro's bundler. Verify a locale
  actually loads on a device, not just in a test — Metro's handling of dynamic
  imports differs from Node's and a passing unit test proves nothing here.
- Keep `getDictionary()`'s existing signature. Web calls it; do not break it.

## Done when

- [ ] Cold-start bundle grows by **one** dictionary, not 35. **State the
      measured before/after number in the PR** — this is the acceptance
      criterion, not a vibe.
- [ ] Switching to Arabic mirrors layout with no clipped or overlapping text.
- [ ] Switching to a non-bundled locale loads it on a real device.
- [ ] The web server's locale behaviour is byte-identical to before.
- [ ] `getDictionary()` signature unchanged; all existing i18n tests pass.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

PR publishes, as a short section other agents will be handed:

1. How a screen reads a string (the `useT()` call shape).
2. The logical-properties rule, with a correct/incorrect example.
3. The measured bundle delta.
4. Whether a locale change requires a reload.
