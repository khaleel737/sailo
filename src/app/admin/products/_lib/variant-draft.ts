import type { ProductVariant } from "@/db/schema";
import { optionKey } from "@/lib/variants";

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
 * lists from both.
 */
export function splitValues(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Minor units to the decimal string an input shows. Null stays empty. */
function toAmount(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/** Saved variants, keyed by their option combination, ready to edit. */
export function toDrafts(variants: ProductVariant[]): Record<string, Draft> {
  const map: Record<string, Draft> = {};
  for (const v of variants) {
    map[optionKey(v.options)] = {
      price: toAmount(v.priceCents),
      compareAt: toAmount(v.compareAtCents),
      sku: v.sku ?? "",
      stock: v.stockQuantity === null ? "" : String(v.stockQuantity),
      available: v.isAvailable,
      image: v.imageUrl ?? "",
    };
  }
  return map;
}
