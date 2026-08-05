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
 * The Sailo mark, hand-inlined.
 *
 * Satori resolves no imports, so the real `<SailoMark>` component renders
 * nothing here. This is the same path data, kept in one place so the four
 * cards cannot drift from each other or from the app.
 */
export function SailoMark({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path
        d="M20.5 19A11.5 11.5 0 0 1 43.5 19"
        stroke={color}
        strokeWidth={5.5}
        strokeLinecap="round"
      />
      <path
        d="M24 19H54A5 5 0 0 1 59 24V28.5H17.875A2.875 2.875 0 0 0 17.875 34.25H59V40A19 19 0 0 1 40 59H10A5 5 0 0 1 5 54V49.5H46.125A2.875 2.875 0 0 0 46.125 43.75H5V38A19 19 0 0 1 24 19Z"
        fill={color}
      />
    </svg>
  );
}
