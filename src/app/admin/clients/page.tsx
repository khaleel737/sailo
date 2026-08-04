import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopClients } from "@/lib/queries";
import { PageHeader } from "@/components/admin/page-header";
import { Card, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients" };

export default async function AdminClientsPage() {
  const { shop } = await requireShop();
  const clients = await getShopClients(shop.id);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone who has ordered from you, grouped by contact."
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" />}
          title="No clients yet"
          description="Buyers appear here once they place their first order and leave a name or contact."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 text-right font-medium">Orders</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-right font-medium">Last order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {clients.map((client) => (
                <tr key={client.key}>
                  <td className="px-4 py-3 font-medium">{client.name}</td>
                  <td className="px-4 py-3 text-ink-600">
                    {client.contact ?? <span className="text-ink-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {client.orderCount}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatMoney(client.totalCents, shop.currency)}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-500">
                    {client.lastOrderAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
