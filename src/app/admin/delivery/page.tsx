import type { Metadata } from "next";
import { Info, Package, Plus, Store, Truck } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
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
import { PageHeader } from "@/components/shared/page-header";
import { DeliveryRateForm } from "@/app/admin/delivery/_components/delivery-rate-form";
import { Panel } from "@/components/overlays";
import { Alert, Badge, Button, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Delivery" };

export default async function AdminDeliveryPage() {
  const { shop } = await requireShop();
  const { a } = await getAdminT();
  const methods = await getShopDeliveryMethods(shop.id);

  const liveCount = methods.filter(
    (m) => m.isEnabled && isDeliveryConfigured(m.type, m.config),
  ).length;

  return (
    <>
      <PageHeader
        title={a.delivery.title}
        description={a.delivery.description}
        meta={
          methods.length > 0 ? (
            <Badge tone={liveCount > 0 ? "green" : "amber"} dot>
              {liveCount} of {methods.length} live
            </Badge>
          ) : null
        }
      />

      <Alert
        tone="info"
        icon={<Info className="size-5" />}
        className="mb-5"
      >
        Only <strong>physical products</strong> ask about delivery — digital
        downloads and services skip it. Collection options never ask the buyer
        for an address.
      </Alert>

      {methods.length === 0 ? (
        <div className="mb-5">
          <EmptyState
            icon={<Truck className="size-6" />}
            title={a.delivery.empty}
            description={a.delivery.emptyBody}
          />
        </div>
      ) : (
        /*
         * One panel per option, each holding its own form. The summary row
         * carries the price and the status, so the page can be read without
         * opening anything — the previous version rendered every edit form
         * expanded at once and buried the list under them.
         */
        <div className="mb-5 space-y-3">
          {methods.map((method) => {
            const def = DELIVERY_METHOD_DEFS[method.type as DeliveryMethodType];
            const configured = isDeliveryConfigured(method.type, method.config);
            const live = method.isEnabled && configured;

            return (
              <Panel
                key={method.id}
                tone={live ? "active" : "default"}
                icon={
                  method.type === "collection" ? (
                    <Store className="size-5" />
                  ) : (
                    <Package className="size-5" />
                  )
                }
                title={method.name}
                status={
                  <>
                    {live ? (
                      <Badge tone="green" dot>
                        Live
                      </Badge>
                    ) : configured ? (
                      <Badge tone="amber" dot>
                        Off
                      </Badge>
                    ) : (
                      <Badge tone="red" dot>
                        Needs a pickup address
                      </Badge>
                    )}
                    <span className="text-xs text-ink-400">
                      {def?.name ?? method.type}
                    </span>
                  </>
                }
                subtitle={
                  <>
                    {method.feeCents === 0
                      ? "Free"
                      : formatMoney(method.feeCents, shop.currency)}
                    {method.freeOverCents !== null
                      ? ` · free over ${formatMoney(method.freeOverCents, shop.currency)}`
                      : ""}
                    {method.config.estimate ? ` · ${method.config.estimate}` : ""}
                    {method.config.address ? ` · ${method.config.address}` : ""}
                  </>
                }
              >
                <DeliveryRateForm method={method} currency={shop.currency} />

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-200 pt-4">
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
                      className="text-ink-500 hover:bg-red-50 hover:text-red-600"
                    >
                      Delete
                    </Button>
                  </form>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Panel
        icon={<Plus className="size-5" />}
        title="Add an option"
        subtitle="Standard, express, international or collection in person."
        defaultOpen={methods.length === 0}
      >
        <DeliveryRateForm currency={shop.currency} />
      </Panel>
    </>
  );
}
