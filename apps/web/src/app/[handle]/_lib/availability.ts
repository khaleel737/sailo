import type { CheckoutVariant } from "@sailo/core/variants";

/**
 * Whether a product can be bought right now.
 *
 * Two stock models meet here. A product with variants keeps its stock on the
 * variants, so the product's own count is not consulted at all — one size
 * being gone must not close the whole listing. A product without variants has
 * only its own count.
 */
export function isSoldOut(product: {
  inStock: boolean;
  variants?: CheckoutVariant[] | null;
  unitsLeft?: number | null;
}): boolean {
  // The seller's switch wins over any count.
  if (!product.inStock) return true;

  const variants = product.variants ?? [];
  if (variants.length > 0) return !variants.some((v) => v.available);

  // `unitsLeft` is null or undefined when stock isn't counted, which is not
  // the same as none left — an uncounted product is always buyable.
  return product.unitsLeft === 0;
}
