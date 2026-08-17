import type { Metadata } from "next";
import { PageHeader } from "@sailo/design-system/web";
import { ExportCsv } from "@/app/hq/_components/hq-export";
import { HqFilters } from "@/app/hq/_components/hq-filters";
import { Pagination } from "@/app/hq/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { ShopCell, When } from "@/app/hq/_components/hq-ui";
import { Badge } from "@sailo/design-system/web";
import { first, getPlatformProducts, pageNumber } from "@/lib/hq";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Products" };

export default async function HqProductsPage({
  searchParams,
}: PageProps<"/hq/products">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    kind: first(params.kind),
    status: first(params.status),
    page: pageNumber(params.page),
  };

  const { rows, total, page, pages } = await getPlatformProducts(filters);

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything being sold on Sailo — physical goods, digital files and services."
        action={
          <ExportCsv type="products" />
        }
      />

      <HqFilters
        values={{ q: filters.q, kind: filters.kind, status: filters.status }}
        placeholder="Search product or shop…"
        fields={[
          {
            name: "kind",
            label: "Kind",
            options: [
              { value: "all", label: "Any kind" },
              { value: "physical", label: "Physical" },
              { value: "digital", label: "Digital" },
              { value: "service", label: "Service" },
            ],
          },
          {
            name: "status",
            label: "Visibility",
            options: [
              { value: "all", label: "Any visibility" },
              { value: "published", label: "Published" },
              { value: "hidden", label: "Hidden" },
            ],
          },
        ]}
      />

      <Table
        head={
          <>
            <Th>Product</Th>
            <Th>Shop</Th>
            <Th>Kind</Th>
            <Th align="end">Price</Th>
            <Th align="end">Stock</Th>
            <Th align="end">Sold</Th>
            <Th>State</Th>
            <Th align="end">Added</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={8}>No products match those filters.</EmptyRow>
        ) : (
          rows.map(({ product, shopName, shopHandle, ownerId, currency, orderCount }) => (
            <Tr key={product.id}>
              <Td className="max-w-64">
                <span className="block truncate text-ink-900">
                  {product.title}
                </span>
                <span className="block truncate text-xs text-ink-400">
                  /{product.slug}
                </span>
              </Td>
              <Td className="max-w-44" label="Shop">
                <ShopCell ownerId={ownerId} name={shopName} handle={shopHandle} />
              </Td>
              <Td className="capitalize" label="Kind">{product.kind}</Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Price">
                {formatMoney(product.priceCents, currency)}
              </Td>
              <Td align="end" className="tabular" label="Stock">
                {product.trackInventory
                  ? (product.stockQuantity ?? 0).toLocaleString()
                  : "—"}
              </Td>
              <Td align="end" className="tabular" label="Sold">
                {orderCount.toLocaleString()}
              </Td>
              <Td label="State">
                {!product.isPublished ? (
                  <Badge tone="neutral">Hidden</Badge>
                ) : product.inStock ? (
                  <Badge tone="green">Live</Badge>
                ) : (
                  <Badge tone="amber">Sold out</Badge>
                )}
              </Td>
              <Td align="end" className="text-ink-500" label="Added">
                <When value={product.createdAt} />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="products"
        basePath="/hq/products"
        params={{ q: filters.q, kind: filters.kind, status: filters.status }}
      />
    </>
  );
}
