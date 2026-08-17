import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { SectionTitle, When } from "@/app/hq/_components/hq-ui";
import { formatAddress } from "@sailo/core/address";
import { formatMoney } from "@sailo/core/currency";
import type { AccountDetail, AccountShop } from "./account.types";

/** The shop's customers, by what they have spent. */

export function BuyersTable({
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
        <span className="text-xs text-ink-400">
          Top {Math.min(detail.buyerCount, 8)} of {detail.buyerCount}
        </span>
      }
    >
      Their buyers
    </SectionTitle>
    <Table
      minWidth="38rem"
      head={
        <>
          <Th>Buyer</Th>
          <Th>Where</Th>
          <Th align="end">Orders</Th>
          <Th align="end">Spent</Th>
          <Th align="end">Last order</Th>
        </>
      }
    >
      {detail.buyers.length === 0 ? (
        <EmptyRow colSpan={5}>Nobody has ordered yet.</EmptyRow>
      ) : (
        detail.buyers.map((buyer) => (
          <Tr key={buyer.id}>
            <Td className="max-w-48">
              <span className="block truncate text-ink-900">
                {buyer.name}
              </span>
              <span className="block truncate text-xs text-ink-400">
                {[buyer.email, buyer.phone].filter(Boolean).join(" · ") ||
                  "No contact details"}
              </span>
            </Td>
            <Td className="max-w-48" label="Where">
              <span className="block truncate text-xs text-ink-500">
                {formatAddress(buyer) || "—"}
              </span>
            </Td>
            <Td align="end" className="tabular" label="Orders">
              {buyer.orderCount}
            </Td>
            <Td align="end" className="tabular whitespace-nowrap" label="Spent">
              {money(buyer.totalCents)}
            </Td>
            <Td align="end" className="text-ink-500" label="Last order">
              <When value={buyer.lastOrderAt} />
            </Td>
          </Tr>
        ))
      )}
    </Table>

    </>
  );
}
