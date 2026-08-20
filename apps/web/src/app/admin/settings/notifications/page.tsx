import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { hasOptedOut } from "@sailo/marketing/lifecycle/server";
import { NotificationsForm } from "./_components/notifications-form";

export const metadata: Metadata = { title: "Notifications" };

export const instant = false;

/**
 * Settings → Notifications — which emails Sailo sends the seller, in the
 * section a seller looks for them in rather than at the bottom of Shop
 * details. The opt-in is read from `marketing_opt_outs`, never the shop row —
 * a cold-mail unsubscribe has no session and still has to be honoured here.
 */
export default async function NotificationsSettingsPage() {
  const { user, shop } = await requireShop("settings:read");
  const marketingOptIn = !(await hasOptedOut(user.email));

  return (
    <NotificationsForm
      shop={shop}
      accountEmail={user.email}
      marketingOptIn={marketingOptIn}
    />
  );
}
