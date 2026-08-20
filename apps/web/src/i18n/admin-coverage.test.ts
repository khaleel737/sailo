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

/**
 * Strip comments before looking for key reads.
 *
 * A comment *about* a key is not a use of one, and reading it as a use fails
 * this suite in both directions: `a.legal.kinds` was reported dangling because
 * `legal-pages-screen.tsx` explains in prose why it uses a lookup **instead
 * of** `a.legal.kinds[kind]`. The fix that suggests itself — reword the comment
 * — makes the file worse to read in order to satisfy a regex, and the next
 * person writes the same sentence again.
 *
 * The same trap caught `migrations.test.ts`, which counted the words
 * `ADD CONSTRAINT` inside a comment describing an unguarded one.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

const referenced = new Set<string>();
for (const file of files) {
  for (const m of withoutComments(readFileSync(file, "utf8")).matchAll(
    /(?<![\w.])a\.([a-zA-Z]+)\.([a-zA-Z0-9]+)/g,
  )) {
    referenced.add(`a.${m[1]}.${m[2]}`);
  }
}

/**
 * Keys whose screen is specified and paid for, but not yet written.
 *
 * A third category the ceiling below has no way to express. The test's premise
 * is that an unreferenced key is either a string a screen is hardcoding in
 * English or a key nobody needs — both of which should be acted on. These are
 * neither: the table, the arithmetic and the scenario tests exist and the admin
 * screen does not, so the translation is correct, wanted, and waiting.
 *
 * Named one by one rather than folded into a larger ceiling, because a number
 * hides what it is covering. Eleven free slots would absorb the next accidental
 * hardcoded string in silence; this list absorbs exactly these eleven and fails
 * on the twelfth.
 *
 * **Spec 50's fifteen are gone.** The tier repeater and the sessions editor are
 * built — `event-tier-editor.tsx` and `event-session-editor.tsx` inside the
 * event card, writing through `ProductInput.tiers` / `.sessions` and
 * `syncTiers` / `syncSessions`. What is still not wired is the *checkout*:
 * `claimEventCapacity` is called from no production path, so a tier's seats are
 * not yet taken when somebody buys one. That is an unreachable function rather
 * than an unshown string, so it is not this test's business — but it is the
 * reason a seller can now name a band and cannot yet oversell one.
 *
 * **Staff rosters** (`staff*`) — `staff_resources` and `product_staff` exist
 * with `listStaff`, `staffCalendars` and `firstFreeStaff` behind them, and
 * `staff-bookings.scenario.ts` passes. The booking path does not consult them
 * and there is no roster screen, so a Pro shop paying for "staff and classes"
 * gets `bookingCapacity` and nothing else.
 *
 * Each entry is asserted to exist and to still be unreferenced below, so the
 * list cannot rot: renaming one fails, and *building* the screen fails until
 * the entry is deleted, which is the point.
 */
const UNBUILT = new Set([
  // Spec 51 — who takes the bookings.
  "productForm.staffTitle",
  "productForm.staffBody",
  "productForm.staffName",
  "productForm.staffEmail",
  "productForm.staffHours",
  "productForm.staffHoursHint",
  "productForm.staffTimeZone",
  "productForm.staffFeed",
  "productForm.staffFeedHint",
  "productForm.staffAdd",
  "productForm.staffActive",
]);

const unreferenced = KEYS.filter(
  (k) =>
    !WHOLESALE.has(k.split(".")[0] ?? "") &&
    !UNBUILT.has(k) &&
    !referenced.has(`a.${k}`),
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

  it("keeps the unbuilt-screen list honest", () => {
    /*
     * Both directions, because an allowlist that is never checked becomes a
     * place to put things.
     *
     * A named key that no longer exists means it was renamed or deleted, and
     * the entry is now excusing nothing while looking like it excuses
     * something. A named key that *is* referenced means the screen got built —
     * and the entry has to go, or the next key to go unshown in that section
     * inherits a free pass nobody granted it.
     */
    const all = new Set(KEYS);
    expect([...UNBUILT].filter((k) => !all.has(k))).toEqual([]);
    expect([...UNBUILT].filter((k) => referenced.has(`a.${k}`))).toEqual([]);
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
