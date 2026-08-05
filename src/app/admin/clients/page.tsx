import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, MapPin, Users } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { getShopClients } from "@/lib/queries";
import { PageHeader } from "@/components/shared/page-header";
import { ExportButton } from "@/app/admin/_components/export-button";
import { Card, EmptyState } from "@/components/ui";
import { formatAddress, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients" };

export default async function AdminClientsPage() {
  const { shop } = await requireShop();
  const { a } = await getAdminT();
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
          icon={<Users className="size-8" />}
          title={a.clients.empty}
          description={a.clients.emptyBody}
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {clients.map((client) => {
            const address = formatAddress(client);
            return (
              <Link
                key={client.id}
                href={`/admin/clients/${client.id}`}
                className="flex items-center gap-3 p-4 transition hover:bg-ink-50"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-sm font-semibold text-ink-600">
                  {client.name.slice(0, 1).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{client.name}</p>
                  <p className="truncate text-xs text-ink-500">
                    {[client.email, client.phone].filter(Boolean).join(" · ") ||
                      "No contact details"}
                  </p>
                  {address ? (
                    <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-400">
                      <MapPin className="size-3 shrink-0" />
                      {address}
                    </p>
                  ) : null}
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {formatMoney(client.totalCents, shop.currency)}
                  </p>
                  <p className="text-xs text-ink-500">
                    {client.orderCount}{" "}
                    {client.orderCount === 1 ? "order" : "orders"}
                  </p>
                </div>

                <ChevronRight className="size-4 shrink-0 text-ink-300" />
              </Link>
            );
          })}
        </Card>
      )}
    </>
  );
}
