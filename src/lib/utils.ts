import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** URL-safe slug. Falls back to a short random suffix if input has no word chars. */
export function slugify(input: string) {
  const base = input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `item-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatMoney(cents: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function parseMoneyToCents(value: string | number): number {
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

/** Human file size for download listings: 1536 → "1.5 KB". */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  // Bytes and kilobytes read better whole; megabytes deserve a decimal.
  return `${value >= 10 || exponent <= 1 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * How long a service takes: "45 min", "1 h 30 min". The units stay as the
 * symbols rather than words — this string is dropped into all 22 storefront
 * languages, and "hr" would read as English in every one of them.
 */
export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Strips everything but digits — wa.me wants a bare E.164 number. */
export function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}

/** Single-line address for chat messages and admin tables. */
export function formatAddress(parts: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}) {
  return [
    parts.addressLine1,
    parts.addressLine2,
    parts.city,
    parts.region,
    parts.postalCode,
    parts.country,
  ]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Whether the public can reach a shop at all.
 *
 * Two separate switches with one answer: `isPublished` is the seller's, and
 * `suspendedAt` is ours. Kept together in one function so a new public route
 * can't honour one and forget the other — which is how a suspended shop ends
 * up quietly still selling on a page nobody remembered to guard.
 */
export function isShopLive(shop: {
  isPublished: boolean;
  suspendedAt: Date | null;
}) {
  return shop.isPublished && !shop.suspendedAt;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres throws on malformed uuids, so route params get checked first. */
export function isUuid(value: string) {
  return UUID_RE.test(value);
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
  } as React.CSSProperties;
}

export const CURRENCIES = [
  "USD", "EUR", "GBP", "AED", "SAR", "EGP", "TRY", "INR", "NGN",
  "KES", "ZAR", "BRL", "MXN", "PKR", "IDR", "PHP", "CAD", "AUD",
] as const;

export const PRODUCT_KINDS = [
  { value: "physical", label: "Physical product" },
  { value: "digital", label: "Digital product" },
  { value: "service", label: "Service" },
] as const;

export const SOCIAL_PLATFORMS = [
  "instagram", "tiktok", "x", "youtube", "facebook",
  "whatsapp", "telegram", "snapchat", "pinterest", "website",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
