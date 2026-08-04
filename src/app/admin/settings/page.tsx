import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const { shop } = await requireShop();

  return (
    <>
      <PageHeader
        title="Settings"
        description="How your shop looks and where orders go."
      />
      <SettingsForm shop={shop} />
    </>
  );
}
