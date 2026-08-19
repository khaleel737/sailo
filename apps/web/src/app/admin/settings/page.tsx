import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { SettingsForm } from "@/app/admin/settings/_components/settings-form";
import { hasOptedOut } from "@sailo/marketing/lifecycle/server";
import { getT } from "@/i18n/server";
import { currencyGaps as getCurrencyGaps } from "@/lib/queries/regional";

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

  /*
   * Spec 53. Uncached and read on every visit: the seller has often just
   * edited a price, and a cached answer would be the one thing on this screen
   * that disagrees with what they did a moment ago. Returns immediately for a
   * shop that has ticked no second currency, which is one array check.
   */
  const currencyGaps = await getCurrencyGaps(
    shop.id,
    shop.regionalCurrencies,
    shop.currency,
  );

  return (
    <>
      <SettingsForm
        shop={shop}
        t={t}
        accountEmail={user.email}
        marketingOptIn={marketingOptIn}
        currencyGaps={currencyGaps}
      />
    </>
  );
}
