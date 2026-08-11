import type {
  Product,
  ProductFile,
  ProductImage,
  ProductVariant,
} from "@sailo/db/schema";

/** A product with everything the form edits alongside it. */
export type ProductWithRelations = Product & {
  images: ProductImage[];
  variants: ProductVariant[];
  files: ProductFile[];
};
