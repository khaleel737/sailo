import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { getDb } from "@/db";
import { productImages, products } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { getShopCategories } from "@/lib/queries";
import { ProductForm } from "@/components/admin/product-form";
import { PageHeader } from "@/components/admin/page-header";
import { isUuid } from "@/lib/utils";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]">) {
  const { id } = await params;
  const { shop } = await requireShop();
  if (!isUuid(id)) notFound();

  const product = await getDb().query.products.findFirst({
    where: and(eq(products.id, id), eq(products.shopId, shop.id)),
    with: { images: { orderBy: [asc(productImages.position)] } },
  });
  if (!product) notFound();

  const categories = await getShopCategories(shop.id);

  return (
    <>
      <PageHeader
        title="Edit product"
        action={
          <Link
            href={`/${shop.handle}/p/${product.slug}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition hover:text-ink-900"
          >
            View on shop
            <ExternalLink className="size-3.5" />
          </Link>
        }
      />
      <ProductForm
        product={product}
        categories={categories}
        currency={shop.currency}
      />
    </>
  );
}
