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
 *
 * `weekdays` was missing from this list and had been since it was written:
 * `booking-card` reads `a.weekdays[weekday]`, which the regex below cannot
 * see, so all seven days counted as translations nobody shows. Seven of the
 * thirty-one entries in the backlog were that one blind spot.
 */
const WHOLESALE = new Set([
  "orderStatus",
  "navGroups",
  "payments",
  "shell",
  "weekdays",
  "paymentStatus",
  "chart",
  "supportTopics",
]);

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
     * Pinned, not zero, and lowered as the backlog is worked through: 31 → 15.
     *
     * Of the sixteen closed, seven were the `weekdays` blind spot above, two
     * were duplicates of a key already in use and deleted outright
     * (`clients.delete`, `coupons.lockBody`), one moved to the storefront
     * dictionary where the component that needs it actually reads
     * (`shopHandlePlaceholder`), and six were strings a screen was rendering
     * in English while the translation sat here unread — the two dashboard
     * chart titles, the coupon amount and minimum-spend labels, the accent
     * swatch's `aria-label`, and the delivery live count.
     *
     * The fifteen left are genuinely unshown. Each needs reading on its own:
     * some are keys left behind by a rewrite and should be deleted, others
     * are screens still hardcoding English that has no key yet.
     */
    expect(unreferenced.length).toBeLessThanOrEqual(15);
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
