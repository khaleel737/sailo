/**
 * The mobile app's tests, which until now did not exist.
 *
 * `jest-expo` rather than a hand-rolled config: it is the preset that knows
 * what a React Native module graph looks like — the platform-extension
 * resolution (`.ios.tsx` before `.tsx`), the mocks for the native modules that
 * have no JavaScript implementation off-device, and the transform for the
 * large number of packages under `node_modules` that ship untranspiled ESM.
 * Every one of those is a thing this file would otherwise get wrong once and
 * then re-get wrong on the next Expo upgrade.
 *
 * `apps/web` runs vitest, and the split is deliberate rather than drift. A
 * React Native bundle is not a browser bundle: it resolves through Metro, not
 * Vite, and the thing worth testing about a mobile screen is how it behaves
 * under Metro's resolver. Running it under a second bundler would test a graph
 * that never ships.
 */

/**
 * One React, resolved from this app.
 *
 * pnpm's strict layout gives three copies of React to a mobile test run: the
 * app's own 19.1.0, one nested under `react-test-renderer`, and one nested
 * under `@testing-library/react-native`. Each is a separate module instance
 * with its own dispatcher and its own act queue — so Testing Library's `act`
 * belongs to a React that has never heard of the renderer holding the tree,
 * and every `render()` fails with "not wrapped in act" followed by an
 * immediately unmounted renderer.
 *
 * Mapped rather than deduped in the lockfile because the versions genuinely
 * differ — the workspace root is on 19.2.8 for the web app while this app is
 * pinned to 19.1.0 by Expo SDK 54 — and forcing one of those onto the other
 * would change what ships to fix what tests. This is scoped to Jest, which is
 * the only place the three-way split matters.
 *
 * The `jsx-runtime` entries are not optional: the automatic JSX transform
 * imports them by name, so leaving them unmapped hands the components back a
 * second React through the back door.
 */
const react = {
  "^react$": require.resolve("react"),
  "^react/jsx-runtime$": require.resolve("react/jsx-runtime"),
  "^react/jsx-dev-runtime$": require.resolve("react/jsx-dev-runtime"),
};

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",

  /*
   * Only the React entries. Jest merges `moduleNameMapper` from the preset
   * rather than letting the config replace it, so the preset's own mapping —
   * `react-native-vector-icons` onto `@expo/vector-icons` — survives without
   * being restated. Restating it also made it *this* package's problem: knip
   * reads the values in this file as dependency references, and naming a
   * package apps/mobile does not declare is an unlisted dependency.
   */
  moduleNameMapper: react,

  /*
   * `.test.tsx` only. Colocated beside what they describe wherever that is
   * allowed — a separate tree puts the test a directory away from its subject,
   * and the first casualty is always the test nobody noticed had stopped
   * covering anything.
   *
   * `tests/` is the exception the next rule forces: a screen's test cannot sit
   * beside the screen, because the screen lives under `app/`. Everything that
   * renders a route goes there; everything else stays next to its module.
   */
  testMatch: ["**/*.test.tsx"],

  /*
   * Everything under `app/` is a route. Expo Router builds its route table by
   * requiring the whole directory, so a `foo.test.tsx` left in there is not
   * only a test — it is the route `/foo`, shipped. Tests live beside `lib/` and
   * `components/` for that reason, and this makes leaving one in `app/` fail
   * here rather than in the store.
   */
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/app/"],

  /*
   * `transformIgnorePatterns` is deliberately NOT set here.
   *
   * The preset ships one, and it is a single negative lookahead listing every
   * package that has to be transformed — so overriding it replaces the list
   * rather than extending it, and the app stops booting on whichever Expo
   * internal was left out. Adding a second pattern does not help either: the
   * entries are OR'd and each one only *adds* an exclusion, so there is no way
   * to widen the allowlist by appending to it.
   *
   * Nothing needs widening in any case. The `@sailo/*` packages are workspace
   * symlinks into `packages/`, and Jest resolves them to their real paths —
   * which contain no `node_modules` segment, so they are transformed without
   * anybody having to ask.
   */

  clearMocks: true,
};
