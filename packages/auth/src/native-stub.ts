/**
 * The three native modules `@better-auth/expo/client` imports at module scope,
 * reduced to the shape its import statement needs and nothing more.
 *
 * The plugin pulls `react-native`, `expo-constants` and `expo-linking` in order
 * to watch app state, read the deep-link scheme and open a browser — none of
 * which the cookie serialiser under test touches. Off a device those three
 * modules cannot even be parsed (`react-native` ships Flow-typed source), so
 * without this the import fails before a single assertion runs.
 *
 * Stubbed rather than mocked per-test: these are resolved at import time by the
 * bundler, and `vi.mock` runs too late to matter for a module-scope import.
 * `vitest.config.mts` aliases all three here.
 *
 * Deliberately minimal. If a future test needs one of these to *behave*, that
 * is a test about the plugin's native integration, and it belongs on a device
 * in `apps/mobile` rather than here.
 */

/** `import { AppState, Platform } from "react-native"` */
export const AppState = {
  addEventListener: () => ({ remove: () => {} }),
  currentState: "active" as const,
};

export const Platform = { OS: "ios" as const, select: <T,>(spec: { ios?: T; default?: T }) => spec.ios ?? spec.default };

/** `import * as Linking from "expo-linking"` */
export const createURL = (path: string) => `sailo://${path}`;
export const openURL = async () => true;
export const addEventListener = () => ({ remove: () => {} });

/** `import Constants from "expo-constants"` — a default import, so a default export. */
export default { expoConfig: { scheme: "sailo" } };
