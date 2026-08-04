import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { SettingsForm } from "@/components/admin/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const { shop } = await requireShop();

  return (
    <>
      <SettingsForm shop={shop} />
    </>
  );
}
