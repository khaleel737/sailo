import { PackageOpen } from "lucide-react";
import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import type { CheckoutOptions, ProductCard as ProductCardData } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ProductCard } from "./product-card";
import type { ShopLayout } from "../_types/shop-page.types";

/**
 * The products, or an explanation of why there are none.
 *
 * The empty state distinguishes "this shop has nothing" from "your filters
 * matched nothing" — the first is the seller's problem and the second is the
 * shopper's, and telling them apart is the difference between "come back
 * later" and "try clearing a filter".
 */
export function ProductGrid({
  products,
  shop,
  layout,
  checkout,
  hasFilters,
  t,
}: {
  products: ProductCardData[];
  shop: Shop;
  layout: ShopLayout;
  checkout: CheckoutOptions;
  hasFilters: boolean;
  t: Dictionary;
}) {
  if (products.length === 0) {
    return (
      <div className="surface-card flex flex-col items-center rounded-2xl px-6 py-16 text-center">
        <PackageOpen className="text-muted mb-3 size-8 opacity-50" />
        <p className="font-medium">
          {hasFilters ? t.shop.noMatches : t.shop.noProducts}
        </p>
        <p className="text-muted mt-1 text-sm">
          {hasFilters
            ? t.shop.noMatchesBody
            : interpolate(t.shop.noProductsBody, { shop: shop.name })}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        layout === "grid"
          ? "grid grid-cols-2 gap-3 sm:gap-4"
          : "flex flex-col gap-3",
      )}
    >
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          shop={shop}
          layout={layout}
          methods={checkout.methods}
          deliveryOptions={checkout.deliveryOptions}
          t={t}
        />
      ))}
    </div>
  );
}
