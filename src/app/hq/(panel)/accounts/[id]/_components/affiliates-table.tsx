import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { Mono, SectionTitle } from "@/app/hq/_components/hq-ui";
import { Badge } from "@/components/ui";
import { formatMoney } from "@/lib/utils";
import type { AccountDetail, AccountShop } from "./account.types";

/** Who is referring buyers, and what they are owed. */

export function AffiliatesTable({
  detail,
  shop,
}: {
  detail: AccountDetail;
  shop: AccountShop;
}) {
  const money = (cents: number) => formatMoney(cents, shop.currency);

  return (
    <>
    <SectionTitle>Affiliates</SectionTitle>
    <Table
      minWidth="38rem"
      head={
        <>
          <Th>Affiliate</Th>
          <Th>Code</Th>
          <Th>Status</Th>
          <Th align="end">Clicks</Th>
          <Th align="end">Orders</Th>
          <Th align="end">Earned</Th>
          <Th align="end">Unpaid</Th>
        </>
      }
    >
      {detail.affiliates.length === 0 ? (
        <EmptyRow colSpan={7}>
          {shop.affiliatesEnabled
            ? "The programme is on, but nobody has joined."
            : "The affiliate programme is switched off."}
        </EmptyRow>
      ) : (
        detail.affiliates.map((affiliate) => (
          <Tr key={affiliate.id}>
            <Td className="max-w-48">
              <span className="block truncate text-ink-900">
                {affiliate.name}
              </span>
              {affiliate.email ? (
                <span className="block truncate text-xs text-ink-400">
                  {affiliate.email}
                </span>
              ) : null}
            </Td>
            <Td label="Code">
              <Mono>{affiliate.code}</Mono>
            </Td>
            <Td label="Status">
              <Badge
                tone={
                  affiliate.status === "active"
                    ? "green"
                    : affiliate.status === "pending"
                      ? "amber"
                      : "neutral"
                }
              >
                {affiliate.status}
              </Badge>
            </Td>
            <Td align="end" className="tabular" label="Clicks">
              {affiliate.clicks}
            </Td>
            <Td align="end" className="tabular" label="Orders">
              {affiliate.orderCount}
            </Td>
            <Td align="end" className="tabular whitespace-nowrap" label="Earned">
              {money(affiliate.earnedCents)}
            </Td>
            <Td align="end" className="tabular whitespace-nowrap" label="Unpaid">
              {money(affiliate.unpaidCents)}
            </Td>
          </Tr>
        ))
      )}
    </Table>

    </>
  );
}
