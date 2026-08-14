import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const nativeStub = fileURLToPath(new URL("./src/native-stub.ts", import.meta.url));

/**
 * Running this package's own code off a phone, which takes two accommodations.
 *
 * **`inline`** — `@better-auth/expo` publishes a `dev-source` export condition
 * pointing at its uncompiled TypeScript (`./src/client.ts`). Vite resolves that
 * condition and then declines to transform what it found, because it came out
 * of `node_modules`: raw TypeScript handed to a JavaScript parser, failing as
 * `SyntaxError: Unexpected token 'typeof'` in a file this package never names.
 * Pinning `resolve.conditions` instead would work today and break the next time
 * better-auth adds a condition, and Metro reads `dev-source` on purpose, so the
 * condition itself has to stay. Inlined, the source resolves *and* is
 * transformed — which is what the phone's bundler does with it.
 *
 * **`alias`** — that client then imports three native modules at module scope,
 * and `react-native` ships Flow-typed source that no Node parser accepts. None
 * of them is reachable from the cookie serialiser under test. See
 * `src/native-stub.ts`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: { deps: { inline: [/@better-auth[/\\]expo/] } },
    alias: {
      "react-native": nativeStub,
      "expo-constants": nativeStub,
      "expo-linking": nativeStub,
    },
  },
});
