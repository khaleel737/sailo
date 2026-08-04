import type { Metadata } from "next";
import { Info, Truck, Trash2 } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopDeliveryMethods } from "@/lib/queries";
import {
  DELIVERY_METHOD_DEFS,
  isDeliveryConfigured,
  type DeliveryMethodType,
} from "@/lib/delivery";
import {
  deleteDeliveryMethod,
  toggleDeliveryMethod,
} from "@/lib/actions/delivery";
import { PageHeader } from "@/components/admin/page-header";
import { DeliveryRateForm } from "@/components/admin/delivery-rate-form";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Delivery" };

export default async function AdminDeliveryPage() {
  const { shop } = await requireShop();
  const methods = await getShopDeliveryMethods(shop.id);

  return (
    <>
      <PageHeader
        title="Delivery"
        description="Add as many options as you like — Standard, Express, pickup. Buyers pick one at checkout."
      />

      <div className="mb-5 flex gap-3 rounded-2xl border border-ink-200 bg-ink-50 p-4">
        <Info className="mt-0.5 size-5 shrink-0 text-ink-400" />
        <p className="text-sm text-ink-600">
          Only <strong>physical products</strong> ask about delivery — digital
          downloads and services skip it. Collection options never ask the buyer
          for an address.
        </p>
      </div>

      {methods.length === 0 ? (
        <div className="mb-5">
          <EmptyState
            icon={<Truck className="size-8" />}
            title="No delivery options yet"
            description="Add one below. Without any, physical orders are taken with no delivery choice and no fee."
          />
        </div>
      ) : (
        <Card className="mb-5 divide-y divide-ink-100">
          {methods.map((method) => {
            const def = DELIVERY_METHOD_DEFS[method.type as DeliveryMethodType];
            const configured = isDeliveryConfigured(method.type, method.config);
            return (
              <div
                key={method.id}
                className="flex flex-wrap items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{method.name}</span>
                    <Badge>{def?.name ?? method.type}</Badge>
                    {method.isEnabled && configured ? (
                      <Badge tone="green">Live</Badge>
                    ) : configured ? (
                      <Badge tone="amber">Off</Badge>
                    ) : (
                      <Badge tone="red">Needs a pickup address</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {method.feeCents === 0
                      ? "Free"
                      : formatMoney(method.feeCents, shop.currency)}
                    {method.freeOverCents !== null
                      ? ` · free over ${formatMoney(method.freeOverCents, shop.currency)}`
                      : ""}
                    {method.config.estimate ? ` · ${method.config.estimate}` : ""}
                    {method.config.address ? ` · ${method.config.address}` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <form action={toggleDeliveryMethod}>
                    <input type="hidden" name="id" value={method.id} />
                    <Button variant="secondary" size="sm" type="submit">
                      {method.isEnabled ? "Turn off" : "Turn on"}
                    </Button>
                  </form>
                  <form action={deleteDeliveryMethod}>
                    <input type="hidden" name="id" value={method.id} />
                    <Button
                      variant="ghost"
                      size="sm"
                      type="submit"
                      aria-label={`Delete ${method.name}`}
                      className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </form>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold">Add an option</h2>
      <DeliveryRateForm currency={shop.currency} />

      {methods.length > 0 ? (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold">Edit existing</h2>
          <div className="space-y-3">
            {methods.map((method) => (
              <DeliveryRateForm
                key={method.id}
                method={method}
                currency={shop.currency}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
