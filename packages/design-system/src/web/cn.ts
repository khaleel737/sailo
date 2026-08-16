import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CSSProperties } from "react";

/**
 * The two things a web component is allowed to compute about how it looks.
 *
 * Kept in a leaf module rather than the barrel next door so a server component
 * can reach `cn` without pulling twenty `"use client"` components in behind it.
 * `apps/web/src/lib/utils.ts` re-exports from here, so no call site had to
 * change when these moved out of the app.
 */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const INK = "#111111";
const PAPER = "#ffffff";

/** One channel, linearised out of sRGB's gamma curve. */
function linearise(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. Gamma-corrected, which perceived brightness is not. */
function relativeLuminance(r: number, g: number, b: number) {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Black or white text for a seller's accent, whichever is actually readable.
 *
 * This used to weigh the channels with the perceived-brightness formula and cut
 * at 0.6. Two things were wrong with that. Perceived brightness is not
 * gamma-corrected, so it disagrees with WCAG on exactly the mid-tones sellers
 * pick most; and a fixed threshold answers "is this light or dark" when the
 * question is "which of these two is easier to read on it".
 *
 * A teal accent of #14b8a6 came out at 0.52, under the cut, so it got white
 * text at a contrast ratio of 2.49 — below the 4.5 AA needs, on the Buy button.
 * Black on the same teal is 7.59. Comparing the two ratios directly cannot get
 * that wrong, and needs no threshold to tune.
 */
export function readableOn(hex: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return PAPER;
  const int = parseInt(match[1] ?? "ffffff", 16);
  const background = relativeLuminance((int >> 16) & 255, (int >> 8) & 255, int & 255);

  const onInk = contrast(background, relativeLuminance(17, 17, 17));
  const onPaper = contrast(background, relativeLuminance(255, 255, 255));

  return onInk > onPaper ? INK : PAPER;
}

/** CSS custom properties that drive the shop template's palette. */
export function shopThemeVars(accentColor: string) {
  return {
    "--accent": accentColor,
    "--accent-contrast": readableOn(accentColor),
  } as CSSProperties;
}
