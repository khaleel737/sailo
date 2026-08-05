import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { SettingsForm } from "@/app/admin/settings/_components/settings-form";
import { getT } from "@/i18n/server";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const { shop } = await requireShop();
  const { t } = await getT();

  return (
    <>
      <SettingsForm shop={shop} t={t} />
    </>
  );
}
