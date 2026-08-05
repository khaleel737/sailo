import type { ProductOption, VariantOptions } from "@/db/schema";
import { parseMoneyToCents } from "@/lib/utils";
import { combinations, MAX_VARIANTS, optionKey } from "@/lib/variants";

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
};

export type FileRow = {
  name?: string;
  url?: string;
  sizeBytes?: number;
  contentType?: string;
};

export function readImageUrls(formData: FormData): string[] {
  return formData
    .getAll("imageUrls")
    .map((v) => String(v).trim())
    .filter(Boolean)
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
export function optionalCents(value: unknown): number | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? parseMoneyToCents(raw) : null;
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
