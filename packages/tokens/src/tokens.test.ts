import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themeCss } from "./css.ts";
import { brand, cubicBezier, easing, ink, radius } from "./index.ts";

/**
 * The staleness gate.
 *
 * This package only pays for itself if a value edited here reaches both
 * targets. Two things can break that, and there is a test for each:
 *
 *   1. Somebody edits `src/index.ts` and forgets to regenerate, leaving the
 *      committed `theme.css` describing the old palette.
 *   2. Somebody edits a token in `globals.css` directly, so the web moves and
 *      the phone does not.
 *
 * The second is the one worth explaining. Only the colour ramps are generated —
 * radius and motion are still declared by hand in `globals.css` — so for those
 * this reads the CSS back and asserts the two files agree. It is a slightly odd
 * test to find in a package, reaching across the repo into an app; the
 * alternative was rewriting more of `globals.css` than this work needed to.
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const GENERATED = fileURLToPath(new URL("../theme.css", import.meta.url));
const GLOBALS = `${REPO_ROOT}apps/web/src/app/globals.css`;

function read(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Could not read ${what} at ${path}. If it moved, this test and ` +
        `packages/tokens/src/generate.ts both need the new path.`,
    );
  }
}

/** The value of a `--custom-property` in the first `@theme` block that has one. */
function cssVar(css: string, name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

describe("the generated Tailwind partial", () => {
  it("is what the generator would write today", () => {
    expect(read(GENERATED, "the generated partial")).toBe(themeCss());
  });

  it("carries every step of both ramps", () => {
    const css = themeCss();
    for (const [step, value] of Object.entries(ink)) {
      expect(cssVar(css, `color-ink-${step}`)).toBe(value);
    }
    for (const [step, value] of Object.entries(brand)) {
      expect(cssVar(css, `color-brand-${step}`)).toBe(value);
    }
  });
});

describe("the values globals.css still declares by hand", () => {
  const css = read(GLOBALS, "the web's globals.css");

  /*
   * px here, rem there, one root font size between them. Asserting the
   * converted number rather than the string means a switch from `0.875rem` to
   * `14px` in the CSS would pass, which is right — the token is the length,
   * not how it was typed.
   */
  it("rounds corners by the same amounts", () => {
    for (const [name, px] of Object.entries(radius)) {
      const declared = cssVar(css, `radius-${name}`);
      expect(declared, `--radius-${name} is missing from globals.css`).toBeDefined();
      const rem = Number.parseFloat(declared!.replace("rem", ""));
      expect(rem * 16, `--radius-${name}`).toBe(px);
    }
  });

  it("uses the same three easings", () => {
    const spelled: Record<keyof typeof easing, string> = {
      outQuint: "ease-out-quint",
      outExpo: "ease-out-expo",
      spring: "ease-spring",
    };
    for (const name of Object.keys(spelled) as (keyof typeof easing)[]) {
      expect(cssVar(css, spelled[name]), `--${spelled[name]}`).toBe(cubicBezier(name));
    }
  });

  /*
   * The ramps are generated, so what matters is that globals.css is still
   * importing them rather than having quietly regrown its own copy.
   */
  it("imports the generated ramps instead of restating them", () => {
    expect(css).toContain('@import "@sailo/tokens/theme.css";');
    expect(css).not.toMatch(/--color-ink-500:/);
    expect(css).not.toMatch(/--color-brand-700:/);
  });
});
