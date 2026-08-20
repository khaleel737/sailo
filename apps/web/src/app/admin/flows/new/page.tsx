import type { Metadata } from "next";
import { Workflow } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can } from "@sailo/core/plans";
import { listsFor } from "@sailo/marketing/contacts/server";
import { segmentPickers } from "@sailo/workflows/broadcasts";
import { PageHeader } from "@sailo/design-system/web";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { NewFlowForm } from "../_components/new-flow-form";

export const metadata: Metadata = { title: "New flow" };

export default async function NewFlowPage() {
  const { shop } = await requireShop("marketing:read");
  const { a } = await getAdminT();
  const { t } = await getT();

  if (!can(shop, "automations")) {
    return (
      <LockedFeature
        shop={shop}
        feature="automations"
        icon={<Workflow className="size-6" />}
        title={a.flows.title}
        description={a.flows.lockedBody}
        t={t}
      />
    );
  }

  const [lists, pickers] = await Promise.all([
    listsFor(shop.id),
    segmentPickers(shop.id),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/flows", label: a.flows.title }}
        title={a.flows.createTitle}
        description={a.flows.createBody}
      />
      <NewFlowForm
        lists={lists.map((l) => ({ id: l.id, label: l.name }))}
        products={pickers.products}
      />
    </>
  );
}
