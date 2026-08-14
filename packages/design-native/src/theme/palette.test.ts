import { describe, expect, it } from "vitest";
import { darkPalette, lightPalette, type Palette } from "./palette";

/**
 * "Every component renders correctly in light and dark", as arithmetic.
 *
 * A design system's dark mode does not break loudly. It breaks by one caption
 * going from readable to nearly-readable on a ground somebody changed for an
 * unrelated reason, and nobody notices until a seller in a dark room says the
 * app is hard to read. The pairs below are every place this palette puts text
 * on a colour; asserting them here means the next person to nudge a grey finds
 * out immediately, on both grounds, without opening a simulator.
 *
 * The thresholds are WCAG 2.2 AA: 4.5:1 for text, 3:1 for large text and for
 * the boundary of a control you have to be able to find. Hairlines between
 * surfaces are exempt and are checked for *visibility* instead — a separator
 * has no contrast requirement, but one at 1.02:1 is not a separator.
 *
 * `contentSubtle` is deliberately absent from the text pairs. It is the
 * disabled colour, WCAG exempts disabled controls, and holding it to 4.5:1
 * would mean drawing a disabled button that looks enabled.
 */

/** Relative luminance, per WCAG 2.2. */
function luminance(color: string): number {
  const channels = parse(color).map((byte) => {
    const value = byte / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * `#rrggbb` or `rgba(r, g, b, a)` to three bytes.
 *
 * The alpha is composited against nothing rather than ignored — the only
 * translucent value in the palette is the scrim, which is never a text ground,
 * so this only has to not throw on it.
 */
function parse(color: string): [number, number, number] {
  const rgba = /^rgba?\(([^)]+)\)$/.exec(color);
  if (rgba?.[1]) {
    const parts = rgba[1].split(",").map((part) => Number(part.trim()));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  }
  const hex = color.replace("#", "");
  if (hex.length !== 6) throw new Error(`Not a colour this test can read: ${color}`);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Everywhere this palette puts a word on a colour. */
function textPairs(palette: Palette): Array<[string, string, string]> {
  const grounds: Array<[string, string]> = [
    ["background", palette.background],
    ["surface", palette.surface],
    ["surfaceElevated", palette.surfaceElevated],
    ["surfaceSunken", palette.surfaceSunken],
  ];
  const inks: Array<[string, string]> = [
    ["content", palette.content],
    ["contentMuted", palette.contentMuted],
    ["danger", palette.danger],
    ["success", palette.success],
    ["warning", palette.warning],
    ["info", palette.info],
    ["accent", palette.accent],
  ];

  const pairs: Array<[string, string, string]> = [];
  for (const [groundName, ground] of grounds) {
    for (const [inkName, value] of inks) {
      pairs.push([`${inkName} on ${groundName}`, ground, value]);
    }
  }

  pairs.push(["accentContent on accent", palette.accent, palette.accentContent]);
  pairs.push(["accentContent on accentPressed", palette.accentPressed, palette.accentContent]);
  pairs.push(["accent on accentSubtle", palette.accentSubtle, palette.accent]);
  pairs.push(["dangerContent on dangerSurface", palette.dangerSurface, palette.dangerContent]);
  pairs.push(["contentInverse on content", palette.content, palette.contentInverse]);

  for (const [tone, { background, content }] of Object.entries(palette.statusTone)) {
    pairs.push([`${tone} pill`, background, content]);
  }

  return pairs;
}

describe.each([
  ["light", lightPalette],
  ["dark", darkPalette],
])("the %s palette", (groundName, palette) => {
  it.each(textPairs(palette))("reads %s at 4.5:1 or better", (_label, ground, value) => {
    expect(contrast(ground, value)).toBeGreaterThanOrEqual(4.5);
  });

  /*
   * 1.4.11. A field you cannot find the edge of is a field a seller does not
   * know is tappable, and `border` alone does not carry that job — which is
   * why there is a `borderStrong` for the controls that need it.
   */
  it("gives a control a findable edge", () => {
    for (const ground of [palette.background, palette.surface, palette.surfaceSunken]) {
      expect(contrast(ground, palette.borderStrong)).toBeGreaterThanOrEqual(3);
    }
  });

  /*
   * A separator has no WCAG floor — it is decoration, and the text it sits
   * between carries the meaning. What it must not be is invisible, which is
   * what happens when somebody moves a surface and forgets the hairline on it.
   */
  it("draws a hairline you can actually see", () => {
    expect(contrast(palette.surface, palette.border)).toBeGreaterThan(1.1);
    expect(contrast(palette.background, palette.border)).toBeGreaterThan(1.05);
  });

  /*
   * The focus ring is a non-text contrast requirement, and it is the one
   * control affordance a keyboard or switch-control user has.
   */
  it("rings focus visibly on every ground", () => {
    for (const ground of [palette.background, palette.surface, palette.surfaceSunken]) {
      expect(contrast(ground, palette.focus)).toBeGreaterThanOrEqual(3);
    }
  });

  /*
   * A skeleton that matches its page is a screen that looks empty rather than
   * loading, and a sheen that matches the bar is an animation nobody sees.
   */
  it("shows a skeleton against the page, and its sheen against itself", () => {
    expect(contrast(palette.surface, palette.skeleton)).toBeGreaterThan(1.05);
    expect(contrast(palette.skeleton, palette.skeletonSheen)).toBeGreaterThan(1.05);
  });

  /*
   * Sunken, surface, elevated — in that order, by luminance, on both grounds.
   * It reads as a light-mode rule and holds in dark for a different reason:
   * there the surfaces get *lighter* as they rise because a shadow on
   * near-black does nothing, so height has to be carried by the fill instead.
   * Same assertion, and it is the one that catches a dark palette written by
   * inverting the light one.
   */
  it("stacks its surfaces in the order they claim", () => {
    const [sunken, surface, elevated] = [
      palette.surfaceSunken,
      palette.surface,
      palette.surfaceElevated,
    ].map(luminance) as [number, number, number];

    expect(sunken, `${groundName}: sunken is lighter than the surface above it`).toBeLessThanOrEqual(
      surface,
    );
    expect(
      surface,
      `${groundName}: the surface is lighter than what floats over it`,
    ).toBeLessThanOrEqual(elevated);
  });
});

/**
 * The two palettes are the same shape by construction — `Palette` sees to that
 * — but the status map is nested deep enough that a missing tone would be a
 * runtime `undefined` rather than a type error, and a pill with no colour
 * renders as invisible text on nothing.
 */
it("gives both grounds the same five status tones", () => {
  expect(Object.keys(darkPalette.statusTone)).toEqual(Object.keys(lightPalette.statusTone));
});

/**
 * The one thing an inversion would pass and a designed dark mode must not:
 * the dark palette has to actually be dark. A page lighter than its own text
 * is the signature of a palette somebody copied and forgot to finish.
 */
it("puts light on dark and dark on light", () => {
  expect(luminance(lightPalette.background)).toBeGreaterThan(luminance(lightPalette.content));
  expect(luminance(darkPalette.background)).toBeLessThan(luminance(darkPalette.content));
});
