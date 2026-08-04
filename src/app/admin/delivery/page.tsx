import type { Metadata } from "next";
import { Info } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopDeliveryMethods } from "@/lib/queries";
import { DELIVERY_METHOD_LIST, isDeliveryConfigured } from "@/lib/delivery";
import { PageHeader } from "@/components/admin/page-header";
import { DeliveryMethodCard } from "@/components/admin/delivery-method-card";

export const metadata: Metadata = { title: "Delivery" };

export default async function AdminDeliveryPage() {
  const { shop } = await requireShop();
  const methods = await getShopDeliveryMethods(shop.id);
  const byType = new Map(methods.map((m) => [m.type, m]));

  const liveCount = methods.filter(
    (m) => m.isEnabled && isDeliveryConfigured(m.type, m.config),
  ).length;

  return (
    <>
      <PageHeader
        title="Delivery"
        description="Offer shipping, collection, or both. Buyers choose at checkout."
      />

      <div className="mb-5 flex gap-3 rounded-2xl border border-ink-200 bg-ink-50 p-4">
        <Info className="mt-0.5 size-5 shrink-0 text-ink-400" />
        <p className="text-sm text-ink-600">
          Only <strong>physical products</strong> ask about delivery — digital
          downloads and services skip it. Collection orders don&rsquo;t ask for
          an address.
          {liveCount === 0
            ? " With nothing enabled, physical orders are taken without a delivery choice."
            : ""}
        </p>
      </div>

      <div className="space-y-3">
        {DELIVERY_METHOD_LIST.map((def) => (
          <DeliveryMethodCard
            key={def.type}
            def={def}
            method={byType.get(def.type)}
            currency={shop.currency}
          />
        ))}
      </div>
    </>
  );
}
