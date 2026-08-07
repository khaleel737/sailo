import { clsx, type ClassValue } from "clsx";
import { currencyDecimals } from "@/lib/currency";
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

/**
 * A price, written the way the page it sits on is written.
 *
 * `locale` decides the separators and where the symbol goes: a German page
 * says `1.234,56 €`, a French one `1 234,56 €`, and only an English one says
 * `€1,234.56`. It was hardcoded to `en-US` for everyone, which meant every
 * price on every storefront was punctuated in a way most of the world reads
 * as wrong — and `1.234` means one thing to a German reader and something a
 * thousand times larger to an American one, so this is not only cosmetic.
 *
 * `-u-nu-latn` pins the digits to 0-9. Arabic and a few other locales would
 * otherwise render their own numerals, which is correct by the standard but
 * is a change no seller asked for and every one of their buyers would notice.
 * Everything else about the locale — separators, symbol position, the RTL
 * marks Arabic needs — is left alone.
 *
 * Defaults to `en-US` rather than to the machine's locale: undefined would
 * make a server's own configuration decide what a buyer sees, and the staff
 * panel is deliberately English.
 */
export function formatMoney(minor: number, currency = "USD", locale = "en-US") {
  /*
   * How many minor units make one of this currency, rather than a flat 100.
   * ¥1,000 is a thousand minor units, not a hundred thousand, and dividing by
   * 100 showed a seller pricing in yen a hundredth of what they charged.
   */
  const decimals = currencyDecimals(currency);
  const per = 10 ** decimals;

  try {
    return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
      style: "currency",
      currency,
      // A whole amount drops its fraction — "$20", not "$20.00" — while
      // anything with a remainder shows every place the currency has, so a
      // price never appears truncated. On a zero-decimal currency both
      // branches are zero, which is the correct answer for yen.
      minimumFractionDigits: minor % per === 0 ? 0 : decimals,
      maximumFractionDigits: decimals,
    }).format(minor / per);
  } catch {
    return `${(minor / per).toFixed(decimals)} ${currency}`;
  }
}

/**
 * Which of the two separators in a number is the decimal point, if either.
 *
 * Sailo sells in 22 languages and both conventions are in daily use: "1,299.99"
 * across the US and UK, "1.299,99" across most of Europe, Turkey, Brazil and
 * Indonesia. Nothing asks the seller which they mean, so the string has to say.
 *
 * - Both separators present — the *later* one is the decimal point, because
 *   grouping always comes before the fraction in both conventions.
 * - One separator, appearing more than once — grouping. "1,234,567" and
 *   "1.234.567".
 * - A lone dot — always a decimal point. This is deliberately *not* symmetric
 *   with the comma rule below, and the asymmetry is the point: a lone dot has
 *   meant a decimal point here since the beginning, and treating "12.500" as
 *   twelve thousand five hundred multiplies a seller's price by a thousand.
 *   The cost is that a European writing "1.299" for one thousand two hundred
 *   and ninety-nine gets 1.30, which is wrong but is wrong in the direction
 *   this function has always been wrong in, and is visible on the page the
 *   moment they save. Resolving it properly needs the shop's locale, which
 *   this function is not given.
 * - A lone comma with exactly three digits behind it *and* a leading part that
 *   could really be a group — grouping. "1,299" is 1299.
 * - A lone comma otherwise — a decimal point. "12,5" is 12.50, which is the
 *   case that was missing and the reason any of this exists.
 */
function decimalSeparator(value: string): "." | "," | null {
  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");
  if (lastDot === -1 && lastComma === -1) return null;
  if (lastDot !== -1 && lastComma !== -1) return lastDot > lastComma ? "." : ",";

  const separator: "." | "," = lastDot === -1 ? "," : ".";
  const at = Math.max(lastDot, lastComma);

  // Only grouping repeats.
  if (value.indexOf(separator) !== at) return null;
  if (separator === ".") return ".";

  /*
   * A leading part that cannot be a thousands group means the comma is a
   * decimal point whatever follows it. "0,750" is seventy-five cents: no
   * grouped number begins with a lone zero.
   */
  const canGroup = /^[1-9]\d{0,2}$/.test(value.slice(0, at));
  return value.length - at - 1 === 3 && canGroup ? null : ",";
}

/**
 * Money as a human typed it, in minor units.
 *
 * This used to strip everything but digits and a dot, which silently read
 * "12,5" — an ordinary way to write €12.50 — as €125. A seller pricing in
 * euros, lira, reais or rupiah could overcharge by a factor of ten without a
 * single validation message, and the same string typed into the tax field was
 * already being read the other way.
 */
export function moneyToCents(
  value: string | number,
  currency = "USD",
): number | null {
  /*
   * The multiplier is the currency's, not a flat 100. A seller pricing at
   * ¥1,000 types 1000; multiplying that by 100 stored ¥100,000 and Stripe
   * charged it, because JPY's minor unit is the yen itself.
   */
  const per = 10 ** currencyDecimals(currency);

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.round(value * per)) : null;
  }

  const cleaned = String(value).replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;

  const separator = decimalSeparator(cleaned);
  const normalized = separator
    ? cleaned.replace(separator === "." ? /,/g : /\./g, "").replace(separator, ".")
    : cleaned.replace(/[.,]/g, "");

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n * per));
}

/**
 * The same, for a caller that must end up with a number.
 *
 * A price input on a form has nowhere to put "that wasn't a number", so it
 * settles for zero. An importer does — an unusable cell there means "inherit
 * from the product", which is not the same as free — so it calls
 * `moneyToCents` and keeps the null. Collapsing the two is how a variant whose
 * price column held a stray "-" went live costing nothing.
 */
export function parseMoneyToCents(value: string | number, currency = "USD"): number {
  return moneyToCents(value, currency) ?? 0;
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


export const PRODUCT_KINDS = [
  { value: "physical", label: "Physical product" },
  { value: "digital", label: "Digital product" },
  { value: "service", label: "Service" },
] as const;

export const SOCIAL_PLATFORMS = [
  "instagram", "tiktok", "x", "youtube", "facebook",
  "whatsapp", "telegram", "snapchat", "pinterest", "website",
] as const;
