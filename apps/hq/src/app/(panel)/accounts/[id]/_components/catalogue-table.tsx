import Link from "next/link";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { SectionTitle, When } from "@/app/_components/hq-ui";
import { Badge } from "@sailo/design-system/web";
import { formatMoney } from "@sailo/core/currency";
import type { AccountDetail, AccountShop } from "./account.types";

/** The shop's products. */

export function CatalogueTable({
  detail,
  shop,
}: {
  detail: AccountDetail;
  shop: AccountShop;
}) {
  const money = (cents: number) => formatMoney(cents, shop.currency);

  return (
    <>
    <SectionTitle
      action={
        <Link
          href={`/hq/products?q=${encodeURIComponent(shop.handle)}`}
          className="focus-ring inline-flex items-center rounded text-xs font-medium text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
        >
          All products
        </Link>
      }
    >
      Catalogue
    </SectionTitle>
    <Table
      minWidth="38rem"
      head={
        <>
          <Th>Product</Th>
          <Th>Kind</Th>
          <Th align="end">Price</Th>
          <Th align="end">Sold</Th>
          <Th>State</Th>
          <Th align="end">Added</Th>
        </>
      }
    >
      {detail.catalogue.length === 0 ? (
        <EmptyRow colSpan={6}>Nothing in the catalogue.</EmptyRow>
      ) : (
        detail.catalogue.map((product) => (
          <Tr key={product.id}>
            <Td className="max-w-64">
              <span className="block truncate text-ink-900">
                {product.title}
              </span>
            </Td>
            <Td className="capitalize" label="Kind">{product.kind}</Td>
            <Td align="end" className="tabular whitespace-nowrap" label="Price">
              {money(product.priceCents)}
            </Td>
            <Td align="end" className="tabular" label="Sold">
              {product.orderCount}
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

    </>
  );
}
