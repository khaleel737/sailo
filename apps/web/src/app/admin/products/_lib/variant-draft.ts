import type { ProductVariant } from "@sailo/db/schema";
import { optionKey } from "@/lib/variants";
import { centsToAmount } from "@/lib/utils";

/**
 * What a variant looks like while it is being edited.
 *
 * Every field is a string because that is what an input holds — including the
 * empty one, which means "inherit from the product" rather than "zero". The
 * distinction is the whole reason this isn't just the database row: a variant
 * with no price of its own is priced by its product, and `0` would be free.
 */

export type Draft = {
  price: string;
  compareAt: string;
  sku: string;
  stock: string;
  available: boolean;
  image: string;
};

export type OptionDraft = { name: string; values: string };

export const BLANK: Draft = {
  price: "",
  compareAt: "",
  sku: "",
  stock: "",
  available: true,
  image: "",
};

/**
 * Option values as typed: comma or newline separated, because sellers paste
 * lists from both. The admin ships in thirty-six locales, so "comma" means the
 * seller's comma — Arabic ،, full-width ，, ideographic 、 — and semicolons,
 * which spreadsheets export. Spaces never split: "Extra Large" is one value.
 */
export function splitValues(input: string): string[] {
  return input
    .split(/[,\n;،؛，、]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * True when the typed values probably wanted commas: "0.5kg 1kg 2kg" parses as
 * one value, and the only symptom was a table with one row — the seller had no
 * way to see how their typing was read. A single value with no spaces stays
 * quiet; so does anything that already split.
 */
export function probablyMissingCommas(input: string): boolean {
  const [only, second] = splitValues(input);
  return only !== undefined && second === undefined && /\s/.test(only);
}

/**
 * Saved variants, keyed by their option combination, ready to edit.
 *
 * `currency` is required rather than defaulted because these strings are saved
 * straight back through `parseMoneyToCents`, which is currency-aware. A flat
 * hundred here turned every JPY variant into a hundredth of its price on any
 * save, and every KWD variant into ten times its price.
 */
export function toDrafts(
  variants: ProductVariant[],
  currency: string,
): Record<string, Draft> {
  const map: Record<string, Draft> = {};
  for (const v of variants) {
    map[optionKey(v.options)] = {
      price: centsToAmount(v.priceCents, currency),
      compareAt: centsToAmount(v.compareAtCents, currency),
      sku: v.sku ?? "",
      stock: v.stockQuantity === null ? "" : String(v.stockQuantity),
      available: v.isAvailable,
      image: v.imageUrl ?? "",
    };
  }
  return map;
}
