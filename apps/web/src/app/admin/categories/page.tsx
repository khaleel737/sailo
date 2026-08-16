import type { Metadata } from "next";
import { count, eq } from "drizzle-orm";
import { Tag, Trash2 } from "lucide-react";
import { getDb } from "@sailo/db";
import { products } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { getShopCategories } from "@/lib/queries";
import { deleteCategory } from "@/lib/actions/products";
import { PageHeader } from "@sailo/design-system/web";
import { CategoryForm } from "@/app/admin/categories/_components/category-form";
import { Table, Td, Th, Tr } from "@sailo/design-system/web";
import { Button, Card, EmptyState } from "@sailo/design-system/web";

export const metadata: Metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  const { shop } = await requireShop();
  const { a } = await getAdminT();
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
        title={a.categories.title}
        description={a.categories.description}
      />

      <Card className="mb-5 p-5">
        <CategoryForm />
      </Card>

      {categories.length === 0 ? (
        <EmptyState
          icon={<Tag className="size-6" />}
          title={a.categories.empty}
          description={a.categories.emptyBody}
        />
      ) : (
        <Table
          minWidth="30rem"
          head={
            <>
              <Th>{a.columns.category}</Th>
              <Th align="end">{a.columns.products}</Th>
              <Th className="w-16">
                <span className="sr-only">{a.columns.actions}</span>
              </Th>
            </>
          }
        >
          {categories.map((category) => {
            const productCount = countBy.get(category.id) ?? 0;
            return (
              <Tr key={category.id}>
                <Td className="font-medium text-ink-900">{category.name}</Td>
                <Td align="end" label={a.columns.products} className="tabular">
                  {productCount === 0 ? (
                    <span className="text-ink-300">0</span>
                  ) : (
                    productCount
                  )}
                </Td>
                <Td align="end">
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={category.id} />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      type="submit"
                      aria-label={`Delete ${category.name}`}
                      className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </form>
                </Td>
              </Tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
