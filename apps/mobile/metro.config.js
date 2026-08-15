// Metro, configured for the pnpm-workspaces monorepo.
//
// The whole reason this file is hand-written: Metro resolves modules by
// walking real node_modules trees, and in a workspace the mobile app's deps
// are hoisted to the repo root while the shared @sailo/* packages live two
// directories up. Without telling Metro about both, an EAS build fails with
// "unable to resolve @sailo/core" — the classic monorepo-Expo wall. So:
//   - watch the whole workspace, so edits to a shared package are seen;
//   - resolve from both the app's and the root's node_modules.
//
// The hoisting is pnpm's, and deliberate: `.npmrc` sets `node-linker=hoisted`,
// which lays out a flat root `node_modules` the way npm would. That is what
// lets the app bundle a package it does not declare — `better-auth` and
// `@better-auth/expo` are declared by `@sailo/auth`, which is where the app
// reaches them from, and they resolve at the root. Flipping the linker to
// pnpm's default isolated layout breaks that contract along with the @sailo/*
// resolution below, so the two move together or not at all.
/*
 * A note that belongs next to the resolver rather than in package.json, where
 * there is nowhere to write it: `expo-network` is declared as a dependency of
 * this app and imported by nothing in it.
 *
 * It is a *peer* of `@better-auth/expo`, which reaches the app through
 * `@sailo/auth`. Expo's autolinking builds its native module list from this
 * app's own dependencies and does not traverse into a workspace package's, so
 * an undeclared native peer is simply absent from the binary — and the failure
 * is a runtime `Cannot find native module 'ExpoNetwork'` on the first screen
 * that signs anybody in.
 *
 * Expo Go hid this completely: it ships every `expo-*` module pre-built, so the
 * app ran there for weeks. The first custom build is where it surfaces, and a
 * production EAS build would have failed the same way. `knip.json` ignores it
 * for this app for the same reason it exists.
 */
/*
 * TWO THINGS THAT WILL BITE A FIRST LOCAL BUILD, both verified on a simulator
 * rather than guessed at:
 *
 * 1. **Sentry fails the build, it does not warn.** The `@sentry/react-native`
 *    plugin in `app.json` adds a source-map upload phase, and with no org
 *    configured `sentry-cli` exits non-zero and takes `xcodebuild` with it —
 *    after every pod has compiled. Build with `SENTRY_DISABLE_AUTO_UPLOAD=true`
 *    locally, or set the org in `sentry.properties`.
 *
 * 2. **A stale Metro cache outlives an install.** Adding a native dependency
 *    and rebuilding without `--clear` leaves the resolver certain the module
 *    does not exist: `Unable to resolve react-native-gesture-handler` from a
 *    file that imports it, while `require.resolve` finds it happily. Start with
 *    `npx expo start --clear` after any dependency change.
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
/*
 * Every `@sailo/*` package, mapped to its real path.
 *
 * This exists because of a resolution failure that only a device could show,
 * and the two ways of fixing it are not equivalent.
 *
 * pnpm does not hoist a *workspace* link, however `node-linker=hoisted` is set:
 * a package depended on by another package is linked inside that package. So
 * `@sailo/tokens`, which only `@sailo/design-native` depends on, lives at
 * `packages/design-native/node_modules/@sailo/tokens` — a path neither entry in
 * `nodeModulesPaths` covers. The bundle failed with "Unable to resolve module
 * @sailo/tokens" while `tsc`, the tests, the lint and knip all stayed green,
 * because every one of those resolves by walking up and only Metro had been
 * told not to.
 *
 * The obvious fix — turning `disableHierarchicalLookup` off so Metro can walk —
 * is wrong, and wrong in a way that takes a while to read. Walking up also
 * finds the *nested* copies of React that pnpm leaves under packages like
 * `react-test-renderer`, and a second React is a second hooks dispatcher: the
 * app boots and dies on `Cannot read property 'useId' of null`. `jest.config.js`
 * carries the same story about the same three copies.
 *
 * So the lookup stays disabled, and the workspace is resolved by name instead.
 * Read off disk rather than listed, so a new `@sailo/*` package is resolvable
 * the moment it exists rather than the moment somebody remembers this file.
 */
const packagesDir = path.resolve(workspaceRoot, "packages");
config.resolver.extraNodeModules = Object.fromEntries(
  fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [`@sailo/${entry.name}`, path.join(packagesDir, entry.name)]),
);

// pnpm hoists third-party deps to the root; don't let Metro walk up and find a
// second copy of React under a nested `node_modules`.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
