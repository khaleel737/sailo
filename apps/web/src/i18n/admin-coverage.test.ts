import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminEn } from "@sailo/i18n/admin/en";

/*
 * The admin locale files live in @sailo/i18n now, not under this app. The
 * usage scan below still reads this app's source (that is the point — a key is
 * "shown" only if a screen here reads it), but the section-parity check reads
 * the locale files themselves, so it resolves the package's own admin folder
 * rather than a path that used to sit inside apps/web.
 */
const ADMIN_DIR = dirname(createRequire(import.meta.url).resolve("@sailo/i18n/admin/en"));

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
  // Handed to the range picker whole — `labels={a.range}`.
  "range",
  // Read by bracket — `a.payoutStatus[payout.status]` — like paymentStatus.
  "payoutStatus",
  /*
   * Both read by bracket off a status string: `a.broadcastStatus[row.status]`
   * on the broadcast list, `a.deliveryStatus[key]` on the progress tiles. The
   * regex below sees neither, so every member would count as a translation
   * nobody shows — the same blind spot `weekdays` had.
   */
  "broadcastStatus",
  "deliveryStatus",
  /*
   * `a.memberStatus[subscription.status]` on the members list — the same
   * bracket read, for the same reason: Stripe hands us the status as a string
   * and the row renders whichever one arrives.
   */
  "memberStatus",
  /*
   * Handed to the door console whole — `labels={a.checkin}` — because that
   * component renders on two routes and only one of them has the admin i18n
   * context around it: a volunteer on `/door/[token]` has no admin shell.
   * Inside, every read is `a.tabScan`, which the regex below cannot see.
   */
  "checkin",
]);

/*
 * The boundary matters: without it, `schema.products.slug` matches on its own
 * tail and reports a dictionary read that isn't one.
 *
 * Both surfaces are scanned, not just this app. The admin dictionary stopped
 * being this app's private property when the phone grew screens that read it —
 * `apps/mobile` calls `useT()` and reads the same `a.*` keys — so a key shown
 * only there is shown, and counting it as backlog would have pushed a real
 * translation gap and a mobile-only string into the same number. This test runs
 * with apps/web as its cwd, hence the relative hop, the same way
 * `replica.test.ts` reaches the packages it pins.
 */
const files = execSync(
  `grep -rl 'a\\.' src/app src/components src/lib ../../apps/mobile/app ../../apps/mobile/lib ../../apps/mobile/components --include='*.ts' --include='*.tsx' || true`,
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

  it("keeps every language carrying the same sections as English", () => {
    /*
     * A language missing a section falls back to English mid-screen, which
     * reads as a bug rather than as a missing translation.
     *
     * Every language, not a sample. This list was four spot-checked files, so
     * the support page shipped translated into exactly those four and rendered
     * English in the other thirty — the drift this test exists to catch.
     * Section-level on purpose: a new key in an existing section still merges
     * over English quietly, but a whole new screen must land everywhere.
     */
    const en = readFileSync(join(ADMIN_DIR, "en.ts"), "utf8");
    const sections = [...en.matchAll(/^ {2}([a-zA-Z]+): \{/gm)].map((m) => m[1]);
    const languages = readdirSync(ADMIN_DIR)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .filter((f) => !["en", "index", "coverage.test"].includes(f));
    for (const file of languages) {
      const other = readFileSync(join(ADMIN_DIR, `${file}.ts`), "utf8");
      for (const section of sections) {
        expect(other, `${file} is missing the ${section} section`).toContain(
          `${section}: {`,
        );
      }
    }
  });
});
