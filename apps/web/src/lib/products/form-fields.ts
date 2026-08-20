import type { ProductOption, VariantOptions } from "@sailo/db/schema";
import { parseMoneyToCents } from "@sailo/core/currency";
import { combinations, MAX_VARIANTS, optionKey } from "@sailo/core/variants";
import { isRenderableImageUrl } from "@sailo/storage/urls";
import { fromIsoDate, zoneOf, zonedTimeToInstant } from "@sailo/commerce/booking";

/**
 * Reading the product form.
 *
 * These lived inside a `"use server"` file, which may only export async
 * functions — so nothing could import them and no test could reach them,
 * though every one is pure. What they all turn on is blank versus zero: an
 * empty field is "no answer" and inherits, while `0` is an answer that means
 * free, or none left.
 */

export type VariantRow = {
  options?: VariantOptions;
  price?: string;
  compareAt?: string;
  sku?: string;
  stock?: string;
  available?: boolean;
  image?: string;
  /**
   * This combination's own sell window — spec 43, as a `datetime-local` string.
   *
   * Still a string here: the row is JSON a browser posted, and turning it into
   * an instant needs the shop's time zone, which is a server fact. The action
   * converts both through one parser so a product's window and a variant's
   * cannot land an hour apart.
   */
  sellFrom?: string;
  sellUntil?: string;
};

/**
 * One price band, as the tier repeater serialises it — spec 50.
 *
 * Every field is a string because a browser composed it. `id` is what makes a
 * saved band the same band across an edit: a tier carries the seats already
 * sold against it, and a row matched by its label would give them all back the
 * moment a seller fixed a typo.
 */
export type TierRow = {
  id?: string;
  name?: string;
  price?: string;
  /** Blank shares the product's stock, which is a band that names a price. */
  capacity?: string;
  hidden?: boolean;
};

/** One date, as the session editor serialises it — spec 50. */
export type SessionRow = {
  id?: string;
  /** `2026-08-31T19:00`, the only shape a `datetime-local` input produces. */
  startsAt?: string;
  endsAt?: string;
  capacity?: string;
  cancelled?: boolean;
};

export type FileRow = {
  name?: string;
  url?: string;
  sizeBytes?: number;
  contentType?: string;
};

/**
 * `isRenderableImageUrl`, not `Boolean`.
 *
 * A server action takes whatever the client sends — the upload widget in front
 * of it is a suggestion, not a constraint — and these URLs are fetched
 * server-side by `lib/og.tsx` when the product's social card renders, on a
 * public unauthenticated route. Anything not on a host the product can already
 * display is dropped rather than stored.
 */
export function readImageUrls(formData: FormData): string[] {
  return formData
    .getAll("imageUrls")
    .map((v) => String(v).trim())
    .filter(isRenderableImageUrl)
    .slice(0, 8);
}

export function readTags(formData: FormData): string[] {
  return String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * The variant and file editors post one JSON blob per row rather than parallel
 * arrays: an unchecked checkbox submits nothing, which would silently shift
 * every later row's values onto the wrong variant.
 */
export function readJson<T>(value: FormDataEntryValue | null): T | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function readJsonRows<T>(formData: FormData, name: string): T[] {
  return formData
    .getAll(name)
    .map((v) => readJson<T>(v))
    .filter((v): v is T => v !== null);
}

/** Blank means "no answer", which is different from zero. */
export function optionalCents(value: unknown, currency = "USD"): number | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? parseMoneyToCents(raw, currency) : null;
}

export function optionalCount(value: unknown, max = 1_000_000): number | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.trunc(n), 0), max);
}

export function text(value: unknown, max: number): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? raw.slice(0, max) : null;
}

/**
 * Keeps only combinations the product's options actually describe, and only
 * one row per combination. A stale row left behind by an option rename would
 * otherwise become an orphan the buyer can never select.
 */
export function usableVariants(options: ProductOption[], rows: VariantRow[]) {
  if (options.length === 0) return [];

  const allowed = new Set(combinations(options).map(optionKey));
  const seen = new Set<string>();
  const usable: (VariantRow & { options: VariantOptions })[] = [];

  for (const row of rows) {
    if (!row.options || typeof row.options !== "object") continue;
    const key = optionKey(row.options);
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    usable.push({ ...row, options: row.options });
    if (usable.length >= MAX_VARIANTS) break;
  }

  return usable;
}

/**
 * A `datetime-local` value, read as wall-clock time in the shop's own zone —
 * spec 43.
 *
 * Deliberately not `new Date(raw)`, which reads the string against whatever
 * clock the *server* happens to be on. "Sales close on the 31st" means the 31st
 * where the seller is, and the whole point of a sell window is that its
 * boundary lands when they said it would — including across a daylight-saving
 * change, where the offset on the day the window closes is not the offset
 * today. `zonedTimeToInstant` resolves the wall clock against the zone's rules
 * *at that instant*, so a window set in March for October lands on the hour the
 * seller typed rather than an hour either side of it.
 *
 * It answers null for a wall time that does not exist — the hour a
 * spring-forward skips — and null here means "no bound", which is the safe
 * reading: a product goes on selling rather than silently closing at a moment
 * nobody can name. A naive parse would have moved it by an hour instead and
 * said nothing.
 *
 * Here rather than in the action beside its caller because it is pure and the
 * action is `"use server"`, where nothing can import it and no test can reach
 * it — the same reason every other reader in this file moved out.
 */
export function shopMomentFrom(value: unknown, timeZone: string): Date | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  // `2026-08-31T17:00` — the only shape a `datetime-local` input produces.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;

  const date = fromIsoDate(`${m[1]}-${m[2]}-${m[3]}`);
  if (!date) return null;

  return zonedTimeToInstant(
    date,
    { hour: Number(m[4]), minute: Number(m[5]) },
    zoneOf(timeZone),
  );
}
