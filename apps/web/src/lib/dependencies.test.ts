import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * `npm audit` reports moderate advisories against this project, and the
 * assessment that they don't reach production is only true while two things
 * stay true. A note saying so would rot; these fail instead.
 *
 * The whole chain is drizzle-kit -> @esbuild-kit/esm-loader -> esbuild, and
 * the advisory (GHSA-67mh-4wv8-2f99) is esbuild's development server letting
 * any website read its responses. It needs `esbuild serve` running, which
 * drizzle-kit never starts — it uses esbuild to transpile the config file.
 * We are already on the latest drizzle-kit; there is no upstream fix to take.
 */

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** Packages whose known advisories are tolerable only in the build toolchain. */
const TOOLCHAIN_ONLY = ["drizzle-kit"];

describe("dependency boundaries", () => {
  it.each(TOOLCHAIN_ONLY)(
    "%s stays a devDependency, so it is never installed on the server",
    (name) => {
      expect(pkg.devDependencies).toHaveProperty(name);
      expect(pkg.dependencies).not.toHaveProperty(name);
    },
  );

  it.each(TOOLCHAIN_ONLY)("%s is never imported from application code", (name) => {
    // A single import would pull it into the bundle regardless of which
    // section of package.json it sits in.
    const hits = execSync(
      `grep -rl "${name}" src/ --include="*.ts" --include="*.tsx" || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      // This file names it on purpose.
      .filter((f) => !f.endsWith("dependencies.test.ts"));

    expect(hits).toEqual([]);
  });

  it("keeps the secret-bearing packages out of anything client-side", () => {
    /*
     * `stripe` is the server SDK and carries the secret key. Importing it from
     * a "use client" file would be a build error in most cases, but a shared
     * module reached from both sides is the way it actually happens.
     *
     * Type-only imports don't count: `import type` is erased before anything
     * is bundled, so a client component naming the Shop type ships nothing.
     */
    const clientFiles = execSync(
      `grep -rl '"use client"' src/ --include="*.tsx" --include="*.ts" || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);

    const leaks = clientFiles
      .filter((f) => !f.endsWith("dependencies.test.ts"))
      .filter((file) => {
        // Whole blocks, not lines: `import type {` often opens three lines
        // above the `from` clause, and a line-based filter reads the tail of
        // one of those as a value import.
        const runtime = readFileSync(file, "utf8").replace(
          /import\s+type\s+\{[^}]*\}\s+from\s+"[^"]*";/g,
          "",
        );
        return /from "stripe"|from "@\/lib\/stripe"|from "@\/db/.test(runtime);
      });

    expect(leaks).toEqual([]);
  });
});
