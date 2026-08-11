import { field } from "@/lib/csv";
import { MAX_OPTIONS, normalizeOptions } from "@/lib/variants";
import type { ProductOption } from "@sailo/db/schema";
import type { Row } from "./parse";

/**
 * Reading a product out of a spreadsheet.
 *
 * Shopify writes one row per variant, repeating the product on each, so the
 * rows for one handle have to be read as a group before any of them means
 * anything on its own.
 */

export const KINDS = new Set(["physical", "digital", "service"]);

/**
 * Reads the positional option columns Shopify writes: `Option1 Name` with
 * `Option1 Value`, and so on. A row with no values isn't a variant.
 */
export function readRowOptions(raw: Record<string, string>) {
  const pairs: { name: string; value: string }[] = [];
  for (let i = 1; i <= MAX_OPTIONS; i++) {
    const name = field(raw, `Option${i} Name`);
    const value = field(raw, `Option${i} Value`);
    if (value) pairs.push({ name: name || `Option ${i}`, value });
  }
  return pairs;
}

/**
 * Collapses a handle's rows into one product plus its variants, preserving the
 * order values were first seen so "Small, Medium, Large" doesn't come back
 * alphabetised.
 */
export function readGroupOptions(rows: Row[]): ProductOption[] {
  const byName = new Map<string, { name: string; values: string[] }>();

  for (const { raw } of rows) {
    for (const { name, value } of readRowOptions(raw)) {
      const key = name.toLowerCase();
      const entry = byName.get(key) ?? { name, values: [] };
      if (!entry.values.some((v) => v.toLowerCase() === value.toLowerCase())) {
        entry.values.push(value);
      }
      byName.set(key, entry);
    }
  }

  return normalizeOptions([...byName.values()]);
}

export function readStock(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  /*
   * Null and zero are different answers: null means nobody is counting, zero
   * means sold out. Stripping non-digits and handing the remainder to
   * `Number` conflated them — "N/A" and "lots" both reduced to "", and
   * `Number("")` is 0, so a seller who wrote either had every product marked
   * out of stock on import.
   */
  const digits = trimmed.replace(/[^0-9-]/g, "");
  if (!/\d/.test(digits)) return null;

  const n = Number(digits);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}
