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

/** Handles are what live at shopik.com/<handle> — stricter than a slug. */
export function normalizeHandle(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
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

/** Strips everything but digits — wa.me wants a bare E.164 number. */
export function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}

export function buildWhatsAppUrl(opts: {
  phone: string;
  shopName: string;
  productTitle: string;
  quantity: number;
  price: string;
  productUrl?: string;
  note?: string;
  customerName?: string;
}) {
  const lines = [
    `Hi ${opts.shopName}! I'd like to order:`,
    ``,
    `*${opts.productTitle}*`,
    `Quantity: ${opts.quantity}`,
    `Price: ${opts.price}`,
  ];
  if (opts.customerName) lines.push(`Name: ${opts.customerName}`);
  if (opts.note) lines.push(`Note: ${opts.note}`);
  if (opts.productUrl) lines.push(``, opts.productUrl);

  return `https://wa.me/${normalizePhone(opts.phone)}?text=${encodeURIComponent(
    lines.join("\n"),
  )}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres throws on malformed uuids, so route params get checked first. */
export function isUuid(value: string) {
  return UUID_RE.test(value);
}

/** Pick black or white text for an accent background using perceived luminance. */
export function readableOn(hex: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "#ffffff";
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
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
