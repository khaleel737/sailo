import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The rule that keeps the app inside the design system, enforced.
 *
 * WHY THIS IS A TEST AND NOT A LINT RULE
 *
 * A01's work order asks for a lint rule banning raw hex and inline styles in
 * `apps/mobile`. oxlint cannot express it: it has no `no-restricted-syntax`
 * (`Rule 'no-restricted-syntax' not found in plugin 'eslint'`), no
 * react-native plugin, and no way to match a string literal by shape. Writing
 * an experimental JS plugin for oxlint to hold two regexes would be a new,
 * unstable build dependency for something twenty lines of test can do.
 *
 * So it is a test, and it runs in `pnpm turbo test` — the gate every agent
 * already runs before every commit, rather than only in CI. That is the same
 * trade `packages/tokens/src/tokens.test.ts` makes when it reaches across the
 * repo into `apps/web/src/app/globals.css`, and the same reasoning: the check
 * has to live where the values it protects live.
 *
 * WHY THERE IS AN ALLOWANCE INSTEAD OF A ZERO
 *
 * A01's own work order says two things that cannot both be true today:
 * "No screen file changed in this PR", and "Zero raw hex remains in
 * `apps/mobile`". There are 122 raw hex colours and 4 inline styles in the app
 * right now, every one of them in a screen or layout A01 must not touch —
 * they belong to A00 and to A06–A10, who replace these screens with ones built
 * out of this package.
 *
 * `ALLOWANCE` below is therefore a ratchet, not an exemption:
 *
 *   - a file that is not listed may have none at all, so nothing new can
 *     arrive while the old screens are still being replaced;
 *   - a listed file may not go above the count recorded for it, so a screen
 *     cannot get worse while it waits its turn;
 *   - the counts are printed in this file where anybody can read them, which
 *     is the difference between a bound that admits itself and one that does
 *     not.
 *
 * When the last screen agent lands, every count here is zero, and the right
 * move is to delete `ALLOWANCE` and the two tests that consult it — leaving
 * the check that says "no raw hex anywhere in apps/mobile", which is what the
 * work order asked for.
 *
 * WHAT IT DOES NOT CATCH
 *
 * `style={[styles.row, { marginTop: 8 }]}` — an object literal inside a style
 * array — is not matched, and neither is a colour built at runtime out of
 * string concatenation. Both are rare and both are deliberate: a regex tight
 * enough to catch them is a regex loose enough to fail on the word "style" in
 * a comment, and a check that cries wolf gets suppressed rather than fixed.
 */

const MOBILE = fileURLToPath(new URL("../../../apps/mobile/", import.meta.url));

/** The directories the app's own source lives in. */
const ROOTS = ["app", "components", "lib"];

/**
 * A string literal that is nothing but a colour: `"#fff"`, `'#12b76a'`,
 * `"#037740ff"`.
 *
 * Anchored to the quotes on both sides so a URL fragment, a shell shebang and
 * a `#` in prose are all left alone. That precision is the point — the rule
 * has to be believable to survive.
 */
const HEX = /(['"`])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\1/g;

/** `style={{ … }}` — an object literal handed straight to a component. */
const INLINE_STYLE = /style=\{\{/g;

/**
 * What is still there, per file, as of A01.
 *
 * Every entry is a file A01 does not own. `app/**` is A00's shell and A06–A10's
 * screens; `components/*` are the pre-design-system helpers those agents fold
 * into `@sailo/design-native` and delete; `lib/push.ts` sets an Android
 * notification LED colour, which is a platform API taking a colour string and
 * is the one entry here that may legitimately survive as a token lookup rather
 * than as zero.
 */
const ALLOWANCE: Record<string, { hex: number; inlineStyle: number }> = {
  "app/(auth)/sign-in.tsx": { hex: 7, inlineStyle: 0 },
  "app/(tabs)/_layout.tsx": { hex: 1, inlineStyle: 1 },
  "app/(tabs)/index.tsx": { hex: 14, inlineStyle: 0 },
  "app/(tabs)/insights/_layout.tsx": { hex: 2, inlineStyle: 0 },
  "app/(tabs)/insights/index.tsx": { hex: 0, inlineStyle: 1 },
  "app/(tabs)/orders/[id].tsx": { hex: 23, inlineStyle: 0 },
  "app/(tabs)/orders/_layout.tsx": { hex: 2, inlineStyle: 0 },
  "app/(tabs)/orders/index.tsx": { hex: 9, inlineStyle: 0 },
  "app/(tabs)/settings/_layout.tsx": { hex: 2, inlineStyle: 0 },
  "app/(tabs)/settings/index.tsx": { hex: 14, inlineStyle: 0 },
  "app/(tabs)/store/[id].tsx": { hex: 14, inlineStyle: 2 },
  "app/(tabs)/store/_layout.tsx": { hex: 2, inlineStyle: 0 },
  "app/(tabs)/store/index.tsx": { hex: 15, inlineStyle: 0 },
  "components/order-status.tsx": { hex: 10, inlineStyle: 0 },
  "components/states.tsx": { hex: 6, inlineStyle: 0 },
  "lib/push.ts": { hex: 1, inlineStyle: 0 },
};

/** The totals the allowance adds up to, so the ratchet has a number to report. */
const REMAINING = { hex: 122, inlineStyle: 4 };

type Finding = { file: string; hex: string[]; inlineStyle: number };

function sourceFiles(): string[] {
  const found: string[] = [];

  const walk = (absolute: string, relative: string) => {
    for (const entry of readdirSync(absolute)) {
      const nextAbsolute = join(absolute, entry);
      const nextRelative = relative ? `${relative}/${entry}` : entry;

      if (statSync(nextAbsolute).isDirectory()) {
        walk(nextAbsolute, nextRelative);
      } else if (/\.tsx?$/.test(entry)) {
        found.push(nextRelative);
      }
    }
  };

  for (const root of ROOTS) {
    try {
      walk(join(MOBILE, root), root);
    } catch {
      throw new Error(
        `Could not read apps/mobile/${root}. If the app moved, this test needs ` +
          `the new path rather than deleting — it is the only thing keeping raw ` +
          `hex out of the screens.`,
      );
    }
  }

  return found.toSorted();
}

const findings: Finding[] = sourceFiles().map((file) => {
  const source = readFileSync(join(MOBILE, file), "utf8");
  return {
    file,
    hex: source.match(HEX) ?? [],
    inlineStyle: (source.match(INLINE_STYLE) ?? []).length,
  };
});

describe("apps/mobile styling", () => {
  /*
   * The rule proper. A screen written after this landed has no allowance to
   * fall back on, so the first raw `#4f46e5` a new file introduces fails here
   * with the file, the count and the colour in the message.
   */
  it.each(findings.filter((finding) => !(finding.file in ALLOWANCE)))(
    "$file uses the design system rather than raw colours",
    ({ file, hex, inlineStyle }) => {
      expect(hex, `${file} hard-codes ${hex.join(", ")} — use a token from @sailo/design-native`).toEqual(
        [],
      );
      expect(
        inlineStyle,
        `${file} passes ${inlineStyle} inline style object(s) — use a component variant`,
      ).toBe(0);
    },
  );

  /*
   * And the ratchet: the files that were already like this may not get worse.
   * Improving one is free and does not fail here, so a screen agent cleaning
   * up `orders/index.tsx` never has to come and edit this file to do it.
   */
  it.each(findings.filter((finding) => finding.file in ALLOWANCE))(
    "$file has not grown more raw colours than it started with",
    ({ file, hex, inlineStyle }) => {
      const allowed = ALLOWANCE[file]!;
      expect(hex.length, `${file} added raw colours: ${hex.join(", ")}`).toBeLessThanOrEqual(
        allowed.hex,
      );
      expect(inlineStyle, `${file} added inline styles`).toBeLessThanOrEqual(allowed.inlineStyle);
    },
  );

  /*
   * An allowance for a file that no longer exists is an allowance nobody is
   * reading, and a list nobody reads is how a temporary exemption becomes
   * permanent.
   */
  it("does not carry an allowance for a file that has been deleted", () => {
    const present = new Set(findings.map((finding) => finding.file));
    const stale = Object.keys(ALLOWANCE).filter((file) => !present.has(file));
    expect(stale, "remove these from ALLOWANCE — the files are gone").toEqual([]);
  });

  /*
   * The bound, admitting itself. This is the number A06–A10 are working down;
   * when it reaches zero, `ALLOWANCE` and the two tests above go with it and
   * the first test covers the whole app.
   */
  it("reports how much of the old app is left to convert", () => {
    const total = Object.values(ALLOWANCE).reduce(
      (sum, allowed) => ({
        hex: sum.hex + allowed.hex,
        inlineStyle: sum.inlineStyle + allowed.inlineStyle,
      }),
      { hex: 0, inlineStyle: 0 },
    );

    expect(
      total,
      "ALLOWANCE and REMAINING disagree. Update REMAINING so the number in " +
        "the handoff still means something.",
    ).toEqual(REMAINING);
  });
});
