import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { getShopClients } from "@/lib/queries";
import { PageHeader } from "@/components/shared/page-header";
import { ExportButton } from "@/app/admin/_components/export-button";
import { Table, Td, Th, Tr } from "@/components/shared/table";
import { EmptyState } from "@/components/ui";
import { formatAddress, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients" };

export default async function AdminClientsPage() {
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();
  const clients = await getShopClients(shop.id);

  return (
    <>
      <PageHeader
        title={a.clients.title}
        description={
          clients.length > 0
            ? `${clients.length} ${clients.length === 1 ? "person has" : "people have"} ordered from you.`
            : "Everyone who has ordered from you."
        }
        action={<ExportButton shop={shop} type="clients" />}
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title={a.clients.empty}
          description={a.clients.emptyBody}
        />
      ) : (
        <Table
          minWidth="44rem"
          head={
            <>
              <Th>{a.columns.client}</Th>
              <Th>{a.columns.where}</Th>
              <Th align="end">{a.columns.orders}</Th>
              <Th align="end">{a.columns.spent}</Th>
            </>
          }
        >
          {clients.map((client) => {
            const address = formatAddress(client);
            return (
              <Tr key={client.id}>
                <Td>
                  <Link
                    href={`/admin/clients/${client.id}`}
                    className="focus-ring flex min-w-0 items-center gap-3 rounded"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                      {client.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">
                        {client.name}
                      </span>
                      <span className="block truncate text-xs text-ink-400">
                        {[client.email, client.phone]
                          .filter(Boolean)
                          .join(" · ") || "No contact details"}
                      </span>
                    </span>
                  </Link>
                </Td>

                <Td className="max-w-xs" label={a.columns.where}>
                  {address ? (
                    <span className="block truncate text-xs text-ink-500">
                      {address}
                    </span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </Td>

                <Td align="end" className="tabular" label={a.columns.orders}>
                  {client.orderCount}
                </Td>

                <Td align="end" className="tabular font-medium text-ink-900" label={a.columns.spent}>
                  {formatMoney(client.totalCents, shop.currency, locale)}
                </Td>
              </Tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
