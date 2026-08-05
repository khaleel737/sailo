import { readableOn } from "@/lib/utils";

/*
 * Shared parts for every generated social card and favicon.
 *
 * `next/og` renders with Satori, which is not a browser. Flexbox and a subset
 * of CSS properties, no grid, no Tailwind class names, no imported components,
 * and no webfont it has not been handed the bytes for. Everything below is
 * written to those rules, and the whole bundle — JSX, CSS, fonts, images — has
 * to stay under 500KB, which is why nothing here embeds a typeface.
 */

/** The browser tab. 32px is what a favicon is actually drawn at. */
export const ICON_SIZE = { width: 32, height: 32 } as const;

/** A six-digit hex, or the ink default if the column holds something odd. */
export function safeHex(value: string | null | undefined, fallback = "#111111") {
  if (!value) return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : fallback;
}

/**
 * The letter drawn on a shop's favicon when it has no avatar.
 *
 * `Array.from` rather than `[0]` so an emoji or a non-Latin script survives:
 * indexing a string splits a surrogate pair and renders a replacement box.
 */
export function initial(name: string) {
  const first = Array.from(name.trim())[0];
  return (first ?? "S").toUpperCase();
}

/**
 * Satori cannot lay out a paragraph it has to guess the width of, and a long
 * description pushes everything else off the card. Cut on a word boundary.
 */
export function clamp(text: string | null | undefined, max: number) {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Pull a remote image in as a data URI.
 *
 * Satori will not fetch for you, and a seller's avatar lives on Vercel Blob or
 * a CDN. Anything that fails — a slow host, a 404, a file that is not an image
 * — returns null and the caller draws its fallback instead. A social card that
 * renders without the photo beats one that 500s, because the crawler that hit
 * the 500 caches the failure and the link stays blank for days.
 */
export async function fetchImage(url: string | null | undefined) {
  if (!url) return null;
  try {
    /*
     * `cache: "no-store"` is load-bearing, not a default.
     *
     * Next's fetch cache round-trips a response body as text. A JPEG survives
     * the first request — which is why this looked fine — and every cached
     * read afterwards comes back mangled, so the rasteriser rejects it with
     * "Input buffer contains unsupported image format" and the card 500s. The
     * result is a social card that works once and is broken forever after.
     *
     * The right cache is one layer up: the route's own `revalidate` stores the
     * finished PNG, so this fetch runs once an hour per card either way.
     */
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    // Satori has no SVG rasteriser of its own; an <img> pointed at one is blank.
    if (type.includes("svg")) return null;

    const buffer = await response.arrayBuffer();
    // Well inside the 500KB bundle ceiling, with room for the rest of the card.
    if (buffer.byteLength > 2_000_000) return null;

    return `data:${type};base64,${Buffer.from(buffer).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The palette a card inherits from the shop it belongs to. */
export function cardTheme(accentColor: string | null | undefined, theme: string) {
  const accent = safeHex(accentColor);
  const dark = theme === "dark";

  return {
    accent,
    onAccent: readableOn(accent),
    background: dark ? "#0d0d0c" : "#faf9f7",
    ink: dark ? "#faf9f7" : "#14140f",
    muted: dark ? "#8a8a82" : "#6b6b63",
    hairline: dark ? "#26262333" : "#14140f14",
    surface: dark ? "#1a1a18" : "#ffffff",
  };
}

/**
 * The Sailo leaf, hand-inlined.
 *
 * Satori resolves no imports, so the real `<SailoMark>` component renders
 * nothing here. This is the same path data, kept in one place so the four
 * cards cannot drift from each other or from the app. `size` is the height —
 * the viewBox is the mark's own bounds rather than a square, because Satori's
 * `preserveAspectRatio` support is thinner than a browser's and letterboxing
 * a square here would silently shrink the mark on every card.
 */
const MARK_ASPECT = 877.6 / 1125.4;

export function SailoMark({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={Math.round(size * MARK_ASPECT)}
      height={size}
      viewBox="0 0 877.6 1125.4"
      fill="none"
    >
      <path
        d="M220.6 0C241.5 10.4 282.6 62.2 298.9 83.6C376.4 185.6 413.9 312.8 432.6 437.7C434.3 438.6 443.8 429.1 445.5 427.5C461.7 412.1 479.2 398.1 497.6 385.3C536.5 358.4 574.9 338.5 618.8 322.6C624.7 320.5 671.7 303.2 681.9 306.6C687.3 318 689.8 329.9 692.9 342C716.2 432 711.7 521.3 686.8 611C679.6 637.2 671.2 663.3 661.4 688.5C658 697.3 652.1 706.6 650.7 716.3C651.8 717.3 662.3 713.7 664.8 713.2C681.4 710.4 696.6 707.7 712.7 706.4C751.2 703.2 791.4 702.6 829.3 711.3C832.1 712 868.9 717.1 877.6 725.8C877.6 745.4 861 789 854 804.8C813.8 895.8 739.8 968.5 659.1 1024.5C634.7 1041.4 609.1 1056 582.3 1068.9C574 1073 564.7 1075.8 556.1 1079.6C482.4 1111.7 401.7 1130.1 322 1124.4C317.6 1124.1 313.2 1124.6 308.7 1124.4C291 1123.4 272.4 1119.5 254.8 1115.7C241.7 1112.8 226 1111.7 214.9 1103.5C204.2 1095.6 196.1 1087.9 187.1 1078.4C156.6 1046.1 129.1 1012 106.6 973.5C94.9 953.5 85.4 933 75 912.4C53.4 869.1 40.5 821.7 27.9 775.2C22.1 753.6 30.1 792.8 22.6 759.6C21 752.4 21 745.1 19.6 737.6C16.5 721.7 12 704.3 9.7 687.8C-6.1 573.3-3.8 455 25.6 342.4C32.5 315.9 40.1 290.4 48.4 264.1C50.4 257.9 51.7 250.8 54.1 244.7C78.4 183.4 108.8 125.1 149.5 72.9C163.1 55.5 209.4 2.8 220.6 0Z"
        fill={color}
      />
    </svg>
  );
}
