import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminProduct, getShopCategories } from "@/lib/queries";
import { ProductForm } from "@/app/admin/products/_components/product-form";
import { PageHeader } from "@sailo/design-system/web";
import { isUuid } from "@sailo/core/uuid";
import { getAdminT } from "@/i18n/server";
import { connectState } from "@sailo/commerce/orders/server";
import { can } from "@sailo/core/plans";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]">) {
  const { a } = await getAdminT();
  const { id } = await params;
  const { shop } = await requireShop();
  if (!isUuid(id)) notFound();

  const product = await getAdminProduct(shop.id, id);
  if (!product) notFound();

  const categories = await getShopCategories(shop.id);

  return (
    <>
      <PageHeader
        title={a.products.edit}
        action={
          <Link
            href={`/${shop.handle}/p/${product.slug}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition hover:text-ink-900"
          >
            {a.products.viewOnShop}
            <ExternalLink className="size-3.5" />
          </Link>
        }
      />
      <ProductForm
        product={product}
        categories={categories}
        currency={shop.currency}
        cardReady={connectState(shop) === "active" && can(shop, "cardRails")}
      />
    </>
  );
}
