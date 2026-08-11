import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { SettingsForm } from "@/app/admin/settings/_components/settings-form";
import { hasOptedOut } from "@/lib/lifecycle/opt-out";
import { getT } from "@/i18n/server";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const { user, shop } = await requireShop();
  const { t } = await getT();

  /*
   * Read rather than assumed. Sailo's product mail is switched off by an
   * address in `marketing_opt_outs`, which a one-click unsubscribe from a
   * cold mail client can write with no session and no shop — so the only
   * honest source for this switch's position is the table, not the shop row
   * the rest of this form is built from.
   */
  const marketingOptIn = !(await hasOptedOut(user.email));

  return (
    <>
      <SettingsForm
        shop={shop}
        t={t}
        accountEmail={user.email}
        marketingOptIn={marketingOptIn}
      />
    </>
  );
}
