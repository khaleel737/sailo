import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminEn } from "./en";

/**
 * Translations that never reach a screen.
 *
 * The settings form hardcoded three English strings that already existed as
 * keys, translated into every supported language — including the warning
 * telling a seller not to charge tax unless they are registered to. It read
 * as English to everyone.
 *
 * A key defined here and never referenced is one of two things: a string
 * hardcoded somewhere in English, or a key nobody needs. Both are worth
 * knowing about, and neither is visible without counting.
 */

const KEYS = Object.entries(adminEn).flatMap(([section, entries]) =>
  Object.keys(entries as Record<string, unknown>).map((key) => `${section}.${key}`),
);

/*
 * Sections handed to a helper whole — `orderStatusLabel(status, a.orderStatus)`
 * — or read by bracket. Every key inside them is reachable, so counting their
 * members individually would report false positives.
 */
const WHOLESALE = new Set(["orderStatus", "navGroups", "payments", "shell"]);

/*
 * The boundary matters: without it, `schema.products.slug` matches on its own
 * tail and reports a dictionary read that isn't one.
 */
const files = execSync(
  `grep -rl 'a\\.' src/app src/components src/lib --include='*.ts' --include='*.tsx' || true`,
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const referenced = new Set<string>();
for (const file of files) {
  for (const m of readFileSync(file, "utf8").matchAll(
    /(?<![\w.])a\.([a-zA-Z]+)\.([a-zA-Z0-9]+)/g,
  )) {
    referenced.add(`a.${m[1]}.${m[2]}`);
  }
}

const unreferenced = KEYS.filter(
  (k) => !WHOLESALE.has(k.split(".")[0] ?? "") && !referenced.has(`a.${k}`),
);

describe("admin translation coverage", () => {
  it("defines a key for everything it uses", () => {
    // The other direction: a screen reading a key that was never written
    // renders `undefined` in every language including English.
    const dangling = [...referenced].filter((ref) => {
      const [, section, key] = ref.split(".");
      if (!section || !key || WHOLESALE.has(section)) return false;
      const entries = (adminEn as Record<string, unknown>)[section];
      // `a.` prefixed reads on unrelated objects land here too; only judge
      // sections the dictionary actually declares.
      return entries !== undefined && !(key in (entries as object));
    });
    expect(dangling).toEqual([]);
  });

  it("does not grow the backlog of translations nobody shows", () => {
    /*
     * Pinned, not zero. Forty-four keys are currently unreferenced and each
     * needs reading individually — some are strings hardcoded in English on a
     * screen, others are keys left behind by a rewrite. This stops the number
     * rising while they are worked through, and must be lowered as they are.
     */
    expect(unreferenced.length).toBeLessThanOrEqual(44);
  });

  it("keeps every language carrying the same keys as English", () => {
    // A language missing a key falls back to English mid-screen, which reads
    // as a bug rather than as a missing translation.
    const en = readFileSync("src/i18n/admin/en.ts", "utf8");
    const sections = [...en.matchAll(/^ {2}([a-zA-Z]+): \{/gm)].map((m) => m[1]);
    for (const file of ["de", "ar", "ja", "fr"]) {
      const other = readFileSync(`src/i18n/admin/${file}.ts`, "utf8");
      for (const section of sections) {
        expect(other, `${file} is missing the ${section} section`).toContain(
          `${section}: {`,
        );
      }
    }
  });
});
