import type { Metadata } from "next";
import { Info, Package, Plus, Store, Truck } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { interpolate, plural } from "@sailo/i18n";
import { countryName } from "@sailo/core/countries";
import { getShopDeliveryMethods } from "@/lib/queries";
import {
  DELIVERY_METHOD_DEFS,
  isDeliveryConfigured,
  type DeliveryMethodType,
} from "@sailo/commerce/delivery";
import {
  deleteDeliveryMethod,
  toggleDeliveryMethod,
} from "@/lib/actions/delivery";
import { PageHeader } from "@sailo/design-system/web";
import { DeliveryRateForm } from "@/app/admin/delivery/_components/delivery-rate-form";
import { Panel } from "@sailo/design-system/web";
import { Alert, Badge, Button, EmptyState } from "@sailo/design-system/web";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Delivery" };

export default async function AdminDeliveryPage() {
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();
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
              {interpolate(a.delivery.liveOfCount, {
                live: liveCount,
                total: methods.length,
              })}
            </Badge>
          ) : null
        }
      />

      <Alert
        tone="info"
        icon={<Info className="size-5" />}
        className="mb-5"
      >
        {a.delivery.only} <strong>{a.delivery.physicalOnly}</strong> ask about delivery — digital
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
                        {a.common.live}
                      </Badge>
                    ) : configured ? (
                      <Badge tone="amber" dot>
                        Off
                      </Badge>
                    ) : (
                      <Badge tone="red" dot>
                        {a.delivery.needsPickup}
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
                      : formatMoney(method.feeCents, shop.currency, locale)}
                    {method.freeOverCents !== null
                      ? ` · free over ${formatMoney(method.freeOverCents, shop.currency, locale)}`
                      : ""}
                    {/*
                      Only when it's restricted. An empty zone is "anywhere",
                      which is the default and the overwhelming majority — a
                      row saying so on every rate would be noise, and the point
                      of this line is to make a *narrowed* rate visible without
                      opening it.
                    */}
                    {method.countries.length > 0
                      ? ` · ${
                          // Named rather than counted when there is one,
                          // because "1 country" is a worse answer to "where
                          // does this go" than "Croatia" — and one country is
                          // the case this whole feature was built for.
                          method.countries.length === 1 && method.countries[0]
                            ? countryName(method.countries[0], locale)
                            : plural(
                                method.countries.length,
                                a.delivery.zoneCountOne,
                                a.delivery.zoneCount,
                              )
                        }`
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
                      {a.common.delete}
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
        title={a.delivery.addOption}
        subtitle={a.delivery.addOptionBody}
        defaultOpen={methods.length === 0}
      >
        <DeliveryRateForm currency={shop.currency} />
      </Panel>
    </>
  );
}
