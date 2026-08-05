import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MapPin, Phone, Trash2 } from "lucide-react";
import { requireShop } from "@/lib/session";
import {
  getClientWithOrders,
  getInvoiceMap,
  getOrderItemsMap,
} from "@/lib/queries";
import { deleteClient, updateClientNotes } from "@/lib/actions/order-admin";
import { PageHeader } from "@/components/shared/page-header";
import { OrderRow } from "@/app/admin/_components/order-row";
import { Button, Card, Textarea } from "@/components/ui";
import { getAdminT } from "@/i18n/server";
import { formatAddress, formatMoney, isUuid } from "@/lib/utils";

export const metadata: Metadata = { title: "Client" };

export default async function ClientDetailPage({
  params,
}: PageProps<"/admin/clients/[id]">) {
  const { id } = await params;
  const { shop } = await requireShop();
  const { a } = await getAdminT();
  if (!isUuid(id)) notFound();

  const data = await getClientWithOrders(shop.id, id);
  if (!data) notFound();

  const { client, orders, totalCents, paidCents, outstandingCents } = data;
  const [invoiceMap, itemsByOrder] = await Promise.all([
    getInvoiceMap(orders.map((o) => o.id)),
    getOrderItemsMap(orders),
  ]);
  const address = formatAddress(client);

  return (
    <>
      <Link
        href="/admin/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 transition hover:text-ink-900"
      >
        <ArrowLeft className="size-4" />
        {a.clients.all}
      </Link>

      <PageHeader
        title={client.name}
        description={`Client since ${client.createdAt.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })}`}
        action={
          <form action={deleteClient}>
            <input type="hidden" name="id" value={client.id} />
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="text-ink-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="size-4" />
              {a.common.delete}
            </Button>
          </form>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label={a.clients.lifetimeValue} value={formatMoney(totalCents, shop.currency)} />
        <Stat label={a.clients.paid} value={formatMoney(paidCents, shop.currency)} />
        <Stat
          label={a.clients.outstandingLabel}
          value={formatMoney(outstandingCents, shop.currency)}
          tone={outstandingCents > 0 ? "warn" : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-1">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">{a.clients.contact}</h2>
            <dl className="space-y-2.5 text-sm">
              {client.email ? (
                <div className="flex items-start gap-2">
                  <Mail className="mt-0.5 size-4 shrink-0 text-ink-400" />
                  <a
                    href={`mailto:${client.email}`}
                    className="break-all text-ink-700 hover:underline"
                  >
                    {client.email}
                  </a>
                </div>
              ) : null}
              {client.phone ? (
                <div className="flex items-start gap-2">
                  <Phone className="mt-0.5 size-4 shrink-0 text-ink-400" />
                  <a
                    href={`tel:${client.phone}`}
                    className="text-ink-700 hover:underline"
                  >
                    {client.phone}
                  </a>
                </div>
              ) : null}
              {address ? (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" />
                  <address className="not-italic leading-relaxed text-ink-700">
                    {[
                      client.addressLine1,
                      client.addressLine2,
                      [client.city, client.region].filter(Boolean).join(", "),
                      client.postalCode,
                      client.country,
                    ]
                      .filter(Boolean)
                      .map((line) => (
                        <span key={line} className="block">
                          {line}
                        </span>
                      ))}
                  </address>
                </div>
              ) : null}
              {!client.email && !client.phone && !address ? (
                <p className="text-ink-400">{a.clients.noDetails}</p>
              ) : null}
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">{a.clients.privateNotes}</h2>
            <form action={updateClientNotes} className="space-y-3">
              <input type="hidden" name="id" value={client.id} />
              <Textarea
                name="notes"
                rows={4}
                defaultValue={client.notes ?? ""}
                placeholder={a.clients.notesPlaceholder}
              />
              <Button type="submit" size="sm" variant="secondary">
              {a.clients.saveNotesLabel}
              </Button>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <div className="border-b border-ink-100 px-5 py-4">
              <h2 className="text-sm font-semibold">
                Orders{" "}
                <span className="font-normal text-ink-400">
                  ({orders.length})
                </span>
              </h2>
            </div>
            {orders.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-ink-500">
              {a.clients.noOrdersYet}
              </p>
            ) : (
              <div className="divide-y divide-ink-100">
                {orders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    items={itemsByOrder.get(order.id)}
                    invoice={invoiceMap.get(order.id)}
                    showCustomer={false}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "warn" ? "text-amber-600" : ""
        }`}
      >
        {value}
      </p>
    </Card>
  );
}
