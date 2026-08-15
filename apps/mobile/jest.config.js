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

/**
 * `victory-native`, added to the list of packages Babel is allowed to compile.
 *
 * The package points its `react-native` entry at `src/index.ts` — raw
 * TypeScript — and that is correct rather than sloppy: the chart's gestures are
 * worklets, and a worklet only becomes one when the *consumer's* Babel runs
 * `react-native-worklets/plugin` over it. Shipping compiled code would ship
 * gestures that silently run on the JS thread. Metro does exactly what the
 * package asks for, and `apps/mobile/babel.config.js` is the other half of it.
 * (Its `dist/` is no escape either — that build is type-stripped but still full
 * of JSX, so it needs a transform just the same.)
 *
 * So this is the one case the note below did not anticipate: a dependency that
 * genuinely has to be transformed. The note is still right that the pattern
 * cannot be *appended* to — the entries are OR'd, and each one only adds an
 * exclusion — and still right that restating it hard-codes a list that an Expo
 * upgrade will change underneath us.
 *
 * The way through is neither: read the preset's pattern and inject one name
 * into the allowlist it already has. Anything Expo adds later survives, because
 * the list is still theirs. The assertion is what makes that safe — if the
 * preset ever stops being a single negative lookahead, this fails loudly at
 * config time instead of quietly reverting to a run where the chart cannot be
 * imported.
 */
function allowTransform(patterns, names) {
  const [allowlist, ...rest] = patterns;
  const widened = allowlist.replace("(?!(", `(?!(${names.join("|")}|`);

  if (widened === allowlist) {
    throw new Error(
      `jest-expo's transformIgnorePatterns no longer looks like a negative ` +
        `lookahead, so ${names.join(", ")} were not added to it. Re-read the ` +
        `preset and update jest.config.js — do not restate its list here.`,
    );
  }

  return [widened, ...rest];
}

/**
 * The packages Babel is allowed to compile, beyond the preset's own list.
 *
 * `victory-native` for the reason above. The rest are what it is built out of:
 * d3 has shipped ESM-only since v4 and has no CommonJS build to fall back to,
 * and `internmap` is `d3-array`'s own dependency. They arrive here rather than
 * being avoided because the alternative is a chart that computes its scales
 * differently in tests than on a device.
 *
 * `d3-[a-z]+` rather than nine names spelled out: the family is pulled in
 * transitively — `d3-scale` alone reaches `-array`, `-format`, `-interpolate`,
 * `-time` and `-time-format` — and a list would be a list to extend every time
 * the library reached for one more.
 */
const NEEDS_TRANSFORM = ["victory-native", "d3-[a-z]+", "internmap"];

/**
 * The preset's own setup, plus the two native modules that have to be replaced
 * rather than transformed.
 *
 * Jest does not merge a config key with its preset's — naming `setupFiles` here
 * *replaces* the preset's two entries, and dropping React Native's own
 * `jest/setup.js` breaks every test in the app with an error that names none of
 * this. So the preset's list is read and appended to rather than restated,
 * which also means an Expo upgrade that adds a third entry is picked up.
 *
 * **Why these two are setup files and not transform targets.** Both ship
 * untranspiled ESM, and the obvious fix — widening `transformIgnorePatterns` —
 * is the one the note further down explains cannot be done safely. It does not
 * need doing: each package ships a `jestSetup` that `jest.mock`s itself whole,
 * so the real ESM is never required and never parsed. Skia's replaces the
 * canvas with a component tree that renders nothing, which is exactly right
 * here — what these tests assert is which figures reach the card, and a test
 * that could read pixels off a canvas would be asserting the drawing rather
 * than the decision. What the chart *draws* is verified by photographing it;
 * `maestro/flows/charts.yaml` is where that lives.
 *
 * `victory-native` needs neither: it ships CommonJS and is pure JavaScript over
 * the two below.
 */
const preset = require("jest-expo/jest-preset");

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",

  setupFiles: [
    ...preset.setupFiles,
    require.resolve("@shopify/react-native-skia/jestSetup.js"),
    require.resolve("react-native-gesture-handler/jestSetup.js"),
  ],

  /*
   * React Native's own environment with CanvasKit added — see `jest/skia-env.js`
   * for why it cannot be a setup file and why it cannot be Skia's own.
   */
  testEnvironment: require.resolve("./jest/skia-env.js"),

  /* After the framework, because it registers `beforeAll`. One known
     third-party warning, matched by name — the file argues its own case. */
  setupFilesAfterEnv: [require.resolve("./jest/quiet-known-warnings.js")],

  /*
   * Only the React entries. Jest merges `moduleNameMapper` from the preset
   * rather than letting the config replace it, so the preset's own mapping —
   * `react-native-vector-icons` onto `@expo/vector-icons` — survives without
   * being restated. Restating it also made it *this* package's problem: knip
   * reads the values in this file as dependency references, and naming a
   * package apps/mobile does not declare is an unlisted dependency.
   */
  moduleNameMapper: react,

  transformIgnorePatterns: allowTransform(preset.transformIgnorePatterns, NEEDS_TRANSFORM),

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
   * `transformIgnorePatterns` is set above, through `allowTransform`, and the
   * indirection is the whole point.
   *
   * The preset ships one, and it is a single negative lookahead listing every
   * package that has to be transformed — so writing a literal here replaces the
   * list rather than extending it, and the app stops booting on whichever Expo
   * internal was left out. Adding a second pattern does not help either: the
   * entries are OR'd and each one only *adds* an exclusion, so there is no way
   * to widen the allowlist by appending to it. `allowTransform` therefore edits
   * the preset's own pattern rather than replacing it, and throws if the shape
   * it is editing ever changes.
   *
   * Only one package needs this, and only because it deliberately ships source
   * — see the note on `allowTransform`. Nothing else does: the `@sailo/*`
   * packages are workspace symlinks into `packages/`, and Jest resolves them to
   * their real paths, which contain no `node_modules` segment, so they are
   * transformed without anybody having to ask.
   */

  clearMocks: true,
};
