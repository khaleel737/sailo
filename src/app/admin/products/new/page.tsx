import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { getShopCategories } from "@/lib/queries";
import { ProductForm } from "@/app/admin/products/_components/product-form";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const { shop } = await requireShop();
  const categories = await getShopCategories(shop.id);

  return (
    <>
      <PageHeader
        title="Add product"
        description="It goes live on your shop as soon as you save."
      />
      <ProductForm categories={categories} currency={shop.currency} />
    </>
  );
}
