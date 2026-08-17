import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { getShopCategories } from "@/lib/queries";
import { ProductForm } from "@/app/admin/products/_components/product-form";
import { PageHeader } from "@sailo/design-system/web";
import { getAdminT } from "@/i18n/server";
import { connectState } from "@sailo/commerce/orders/server";
import { can } from "@sailo/core/plans";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const { a } = await getAdminT();
  const { shop } = await requireShop();
  const categories = await getShopCategories(shop.id);

  return (
    <>
      <PageHeader
        title={a.products.add}
        description={a.products.newSubtitle}
      />
      <ProductForm
        categories={categories}
        currency={shop.currency}
        cardReady={connectState(shop) === "active" && can(shop, "cardRails")}
      />
    </>
  );
}
