import { vi } from "vitest";

/**
 * Tiny shared test doubles.
 *
 * Each of these existed four or five times, byte-identical or nearly, across
 * the workspaces' unit tests — the comments even cross-cited each other as
 * "the same stand-in". They live beside the vitest preset because that is
 * the one module every test config already reaches for.
 */

/**
 * An object that awaits to `result` — the smallest stand-in for a drizzle
 * query builder tail. `extra` carries whichever chained members the code
 * under test goes on to call (`returning`, `onConflictDoNothing`, …).
 */
export function thenable<T>(result: T, extra: Record<string, unknown> = {}) {
  return { ...extra, then: (resolve: (value: T) => unknown) => resolve(result) };
}

/**
 * A `window` with just enough localStorage, backed by the map handed in so
 * the test can seed and inspect it.
 *
 * The module under test reads `window.localStorage`, so the window is what
 * needs standing in — stubbing a bare `localStorage` global leaves every
 * write going nowhere and every read returning null, which reads as
 * "declined". `dispatchEvent` and `CustomEvent` are stubbed too for the
 * modules that announce their writes; they are never read, only constructed.
 *
 * Callers pair this with `afterEach(() => vi.unstubAllGlobals())`.
 */
export function stubLocalStorageWindow(store: Map<string, string>): void {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  });
  vi.stubGlobal("CustomEvent", function CustomEventStub() {});
}
