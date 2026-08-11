import type {
  Product,
  ProductFile,
  ProductImage,
  ProductVariant,
} from "@/db/schema";

/** A product with everything the form edits alongside it. */
export type ProductWithRelations = Product & {
  images: ProductImage[];
  variants: ProductVariant[];
  files: ProductFile[];
};
