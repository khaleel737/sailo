import { currencyDecimals } from "@sailo/core/currency";

/**
 * `cn`, `readableOn` and `shopThemeVars` moved to
 * `@sailo/design-system/web/cn`.
 *
 * Re-exported here, not left behind, for the reason `formatMoney` and
 * `slugify` below are: two hundred files import them from `@/lib/utils` and
 * none of them care where a class merger lives. They had to leave because the
 * components that use them left — a Button whose `cn` came from the app it is
 * meant to be independent of is not a design system component.
 *
 * From `/web/cn` rather than `/web`, deliberately. The barrel next to it is
 * twenty `"use client"` components, and this module is imported by server
 * code that only wants to format money.
 */
export { cn, readableOn, shopThemeVars } from "@sailo/design-system/web/cn";

/**
 * Re-exported, not defined here. `formatMoney` moved to `@sailo/core/currency`
 * so the mobile app can reach it — a React Native bundle cannot import
 * anything under `apps/web`, and the alternative was a second copy of the
 * rounding rules that decide what a buyer is charged.
 *
 * Kept as an export from this module because every web call site already
 * imports it from here, and the move is not one of them's business.
 */
export { formatMoney } from "@sailo/core/currency";

/**
 * The same trade, for the same reason. `slugify` moved to `@sailo/core/slug`
 * when `products.save` arrived in `@sailo/api`: the slug is derived from the
 * title by whichever server took the write, and the phone's answer and this
 * app's answer have to be the same string or the product has two addresses.
 */
export { slugify } from "@sailo/core/slug";

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

/**
 * The inverse of `moneyToCents`: minor units to the plain decimal string an
 * `<input>` shows and a CSV column holds. Null stays empty, because a blank
 * price means "inherit" and `0` means free.
 *
 * This is the half of the pair that a currency-awareness pass missed, and the
 * asymmetry cost real money. Every edit form renders the stored amount into a
 * text field and saves whatever comes back through `parseMoneyToCents`, which
 * has known each currency's minor unit since seventy-one of them were added.
 * The render side still divided by a flat 100 — so a seller who opened a JPY
 * product and pressed Save without touching anything turned ¥1,000 into ¥10,
 * and a KWD seller turned 12.500 KWD into 125.000 and charged their buyer ten
 * times the price. Both sides agreed with each other afterwards, so nothing
 * downstream could notice: `connect.ts` re-checks the Stripe lines against the
 * order subtotal, and both were corrupt together.
 *
 * No grouping separators and always `.` for the decimal, because the output is
 * parsed again rather than read — `formatMoney` is what a human should see.
 */
export function centsToAmount(
  minor: number | null | undefined,
  currency = "USD",
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
  const decimals = currencyDecimals(currency);
  return (minor / 10 ** decimals).toFixed(decimals);
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

/**
 * `normalizePhone` moved to `@sailo/core/phone`.
 *
 * It had to leave because `@sailo/payments/offline` builds the `wa.me` link a
 * buyer is handed, and a package cannot reach into this app. The string is
 * both a stored value and a URL path segment, so two normalisations that
 * disagreed would store the same buyer twice and open a chat with nobody.
 */
export { normalizePhone } from "@sailo/core/phone";

/**
 * `formatAddress` moved to `@sailo/core/address`.
 *
 * Re-exported so its callers here are unchanged. It had to leave because a
 * shipping notice prints the address it was sent to, and `@sailo/email`
 * composes that for two apps — and the comment it carries is the reason a
 * second copy would be a bug: a country is stored as a code and rendered as a
 * name, and formatting one surface and not another is how a WhatsApp message
 * says `HR` while the invoice beside it says Croatia.
 */
export { formatAddress } from "@sailo/core/address";

/**
 * Whether the public can reach a shop at all.
 *
 * Three separate switches with one answer: `isPublished` is the seller's,
 * `suspendedAt` is ours, and `deletedAt` is the tombstone left behind by
 * self-serve deletion — the row survives only to hold the invoice sequence
 * and the orders that hang off it, and must never serve a page again. Kept
 * together in one function so a new public route can't honour one and forget
 * another, which is how a suspended shop ends up quietly still selling on a
 * page nobody remembered to guard.
 */
export function isShopLive(shop: {
  isPublished: boolean;
  suspendedAt: Date | null;
  deletedAt?: Date | null;
}) {
  return shop.isPublished && !shop.suspendedAt && !shop.deletedAt;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres raises on a malformed uuid rather than returning nothing, so
 * anything a client supplies gets checked before it reaches a `uuid` column.
 * `{"shopId":"x"}` was a 500 from a public unauthenticated beacon.
 *
 * Takes `unknown` and narrows, so a caller with an optional field does not
 * have to coerce it first — the coercion is where the check gets forgotten.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export const PRODUCT_KINDS = [
  { value: "physical", label: "Physical product" },
  { value: "digital", label: "Digital product" },
  { value: "service", label: "Service" },
  { value: "event", label: "Event tickets" },
  { value: "membership", label: "Membership" },
] as const;

export const SOCIAL_PLATFORMS = [
  "instagram", "tiktok", "x", "youtube", "facebook",
  "whatsapp", "telegram", "snapchat", "pinterest", "website",
] as const;
