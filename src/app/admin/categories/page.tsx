import type { Metadata } from "next";
import { count, eq } from "drizzle-orm";
import { Tag, Trash2 } from "lucide-react";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { getShopCategories } from "@/lib/queries";
import { deleteCategory } from "@/lib/actions/products";
import { PageHeader } from "@/components/admin/page-header";
import { CategoryForm } from "@/components/admin/category-form";
import { Button, Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  const { shop } = await requireShop();
  const categories = await getShopCategories(shop.id);

  const counts = await getDb()
    .select({ categoryId: products.categoryId, total: count() })
    .from(products)
    .where(eq(products.shopId, shop.id))
    .groupBy(products.categoryId);

  const countBy = new Map(counts.map((c) => [c.categoryId, c.total]));

  return (
    <>
      <PageHeader
        title="Categories"
        description="These become the filter chips at the top of your shop."
      />

      <Card className="mb-5 p-5">
        <CategoryForm />
      </Card>

      {categories.length === 0 ? (
        <EmptyState
          icon={<Tag className="size-8" />}
          title="No categories yet"
          description="Categories are optional — add a few once you have enough products to group."
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {categories.map((category) => (
            <div
              key={category.id}
              className="flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{category.name}</p>
                <p className="text-xs text-ink-500">
                  {countBy.get(category.id) ?? 0}{" "}
                  {(countBy.get(category.id) ?? 0) === 1 ? "product" : "products"}
                </p>
              </div>
              <form action={deleteCategory}>
                <input type="hidden" name="id" value={category.id} />
                <Button
                  variant="ghost"
                  size="sm"
                  type="submit"
                  aria-label={`Delete ${category.name}`}
                  className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="size-4" />
                </Button>
              </form>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
