import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { SettingsForm } from "@/app/admin/settings/_components/settings-form";
import { getT } from "@/i18n/server";
import { currencyGaps as getCurrencyGaps } from "@/lib/queries/regional";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const { shop } = await requireShop("settings:read");
  const { t } = await getT();

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
        currencyGaps={currencyGaps}
      />
    </>
  );
}
