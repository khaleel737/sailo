import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { AppearanceForm } from "./_components/appearance-form";

export const metadata: Metadata = { title: "Appearance" };

export const instant = false;

/** Settings → Appearance — the storefront's accent, theme and layout,
 *  carved out of Shop details so a look change never rides a tax save. */
export default async function AppearancePage() {
  const { shop } = await requireShop("settings:read");
  return <AppearanceForm shop={shop} />;
}
