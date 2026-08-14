import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themeCss } from "./css.ts";
import { brand, cubicBezier, easing, ink, radius, status } from "./index.ts";

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
const TAILWIND = `${REPO_ROOT}node_modules/tailwindcss/theme.css`;

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

/*
 * oklch → sRGB, the standard two steps: through LMS to linear RGB, then the
 * sRGB transfer function. Written out here rather than pulled in as a
 * dependency because it is twelve constants used by one assertion, and the
 * constants are the published ones — they do not need maintaining.
 */
function oklchToHex(lightness: number, chroma: number, hueDeg: number): string {
  const hue = (hueDeg * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return `#${[
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ]
    .map((linear) => {
      const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
      const byte = Math.min(255, Math.max(0, Math.round(encoded * 255)));
      return byte.toString(16).padStart(2, "0");
    })
    .join("")}`;
}

/**
 * The status hues are the third way these two targets can part company, and
 * the only one the two tests above cannot see: nothing generates them, and
 * nothing in `globals.css` declares them. The web draws its badges out of
 * Tailwind's stock `emerald`, `amber`, `red` and `blue`; `status` in
 * `./index.ts` is those same ramps, in the one notation React Native can read.
 *
 * So this reads Tailwind's own theme back out of `node_modules` and converts
 * it, rather than trusting a hex somebody pasted. A Tailwind upgrade that
 * shifts a green then fails here instead of leaving the admin and the phone
 * disagreeing about what "Completed" looks like — which is the failure mode
 * nobody notices, because the two are never on screen together.
 */
describe("the status hues", () => {
  const css = read(TAILWIND, "Tailwind's own theme");

  /** Every `--color-<hue>-<step>: oklch(…)` Tailwind declares, as hex. */
  const tailwind = new Map<string, string>();
  for (const declaration of css.matchAll(
    /--color-(\w+)-(\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g,
  )) {
    const [, hue, step, lightness, chroma, hueAngle] = declaration;
    tailwind.set(
      `${hue}-${step}`,
      oklchToHex(Number(lightness) / 100, Number(chroma), Number(hueAngle)),
    );
  }

  it("found Tailwind's ramps to compare against", () => {
    expect(
      tailwind.size,
      `No oklch declarations at ${TAILWIND}. If Tailwind changed notation ` +
        `again, this test needs rewriting rather than deleting.`,
    ).toBeGreaterThan(100);
  });

  it("is Tailwind's palette, converted", () => {
    for (const [hue, ramp] of Object.entries(status)) {
      for (const [step, value] of Object.entries(ramp)) {
        expect(value, `status.${hue}[${step}]`).toBe(tailwind.get(`${hue}-${step}`));
      }
    }
  });

  it("covers the same steps as the ink ramp, so a step is never missing", () => {
    for (const ramp of Object.values(status)) {
      expect(Object.keys(ramp)).toEqual(Object.keys(ink));
    }
  });
});
