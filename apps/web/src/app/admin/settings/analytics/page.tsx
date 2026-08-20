import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { TrackingForm } from "./_components/tracking-form";

export const metadata: Metadata = { title: "Analytics & pixels" };

export const instant = false;

/** Settings → Analytics & pixels — every tracking id the storefront will
 *  carry, in the section a seller actually looks for them in. */
export default async function AnalyticsSettingsPage() {
  const { shop } = await requireShop("settings:read");
  return <TrackingForm shop={shop} />;
}
