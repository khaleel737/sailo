import { defineConfig } from "vitest/config";

/**
 * Node, not jsdom, and `.ts` only.
 *
 * What is testable here without a device is the part with no React in it: the
 * palette's contrast, the type scale's ratios, the icon registry's coverage.
 * Rendering a `Pressable` under jsdom would prove that a mock renders, not that
 * a phone draws — so the components are checked on a device and the data they
 * are built out of is checked here, where a regression is a red test rather
 * than a screenshot somebody has to look at.
 */
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
