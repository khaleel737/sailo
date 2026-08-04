import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff, ImageIcon, Package, Plus, Trash2 } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminProducts } from "@/lib/queries";
import { deleteProduct, toggleProductPublished } from "@/lib/actions/products";
import { PageHeader } from "@/components/admin/page-header";
import { ExportButton } from "@/components/admin/export-button";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Products" };

export default async function AdminProductsPage() {
  const { shop } = await requireShop();
  const products = await getAdminProducts(shop.id);

  return (
    <>
      <PageHeader
        title="Products"
        description="Anything you sell — physical, digital or a service."
        action={
          <div className="flex gap-2">
            <ExportButton shop={shop} type="products" />
            <Link href="/admin/products/new">
              <Button>
                <Plus className="size-4" />
                Add product
              </Button>
            </Link>
          </div>
        }
      />

      {products.length === 0 ? (
        <EmptyState
          icon={<Package className="size-8" />}
          title="No products yet"
          description="Add your first item and it appears on your shop link immediately."
          action={
            <Link href="/admin/products/new">
              <Button>
                <Plus className="size-4" />
                Add your first product
              </Button>
            </Link>
          }
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {products.map((product) => (
            <div
              key={product.id}
              className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4"
            >
              <Link
                href={`/admin/products/${product.id}`}
                className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-ink-100"
              >
                {product.images[0] ? (
                  <Image
                    src={product.images[0].url}
                    alt={product.title}
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-ink-300">
                    <ImageIcon className="size-5" />
                  </div>
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/products/${product.id}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {product.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-sm tabular-nums text-ink-600">
                    {formatMoney(product.priceCents, shop.currency)}
                  </span>
                  {product.category ? (
                    <Badge>{product.category.name}</Badge>
                  ) : null}
                  {!product.isPublished ? (
                    <Badge tone="amber">Hidden</Badge>
                  ) : null}
                  {!product.inStock ? <Badge tone="red">Sold out</Badge> : null}
                  {product.isFeatured ? (
                    <Badge tone="blue">Featured</Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <form action={toggleProductPublished}>
                  <input type="hidden" name="id" value={product.id} />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="submit"
                    title={product.isPublished ? "Hide" : "Publish"}
                    aria-label={product.isPublished ? "Hide product" : "Publish product"}
                  >
                    {product.isPublished ? (
                      <Eye className="size-4" />
                    ) : (
                      <EyeOff className="size-4" />
                    )}
                  </Button>
                </form>

                <form action={deleteProduct}>
                  <input type="hidden" name="id" value={product.id} />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="submit"
                    title="Delete"
                    aria-label="Delete product"
                    className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
