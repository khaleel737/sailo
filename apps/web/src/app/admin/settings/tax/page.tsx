import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import {
  countryRulesFor,
  jurisdictionsFor,
  shopThresholds,
  taxReport,
} from "@sailo/commerce/tax/server";
import { calendarYearWindow } from "@sailo/commerce/tax/server";
import { RegistrationsCard } from "./_components/registrations-card";
import { ThresholdsCard } from "./_components/thresholds-card";
import { CountriesCard } from "./_components/countries-card";
import { ReportCard } from "./_components/report-card";
import { Alert } from "@sailo/design-system/web";
import { countriesByName } from "@sailo/core/countries";

export const metadata: Metadata = { title: "Tax & jurisdictions" };

/*
 * Every read here is the signed-in seller's own, so there is nothing to
 * prerender — the same declaration every other page under /admin/settings
 * carries. Without it the route logs "uncached data during prerendering" and
 * a server action's `revalidatePath` does not land, which reads as the write
 * having silently failed.
 */
export const instant = false;

/**
 * Spec 38's tab: registrations, revenue against published thresholds, country
 * control, and a report that can be filed.
 *
 * WHAT THIS PAGE IS NOT
 *
 * It is not a tax calculation and it does not tell anybody to register
 * anywhere. Stripe Tax computes rates on the seller's own connected account,
 * with the seller's registrations and the seller's liability;
 * `GAP-2026-08-easytools.md` §4.3 refused becoming a tax provider and that
 * refusal is what the wording on this page is protecting. Every number here is
 * a sum of what was actually charged, shown beside a published figure and the
 * date somebody last checked it.
 *
 * NOT PLAN-GATED, DELIBERATELY
 *
 * Every other reporting surface in the admin has a tier. This one does not:
 * finding out that you are three weeks from owing tax in a country you have
 * never heard of is not a premium feature, and a seller on Free who crosses a
 * threshold unwarned pays a penalty that dwarfs the subscription. The CSV
 * download follows `csvExport` like every other export, because that is a
 * convenience rather than the warning.
 */
export default async function TaxSettingsPage(
  props: PageProps<"/admin/settings/tax">,
) {
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();
  const params = await props.searchParams;

  /*
   * Sorted here, on the server, and handed to both cards.
   *
   * `countriesByName` orders 240 names with `Intl.Collator`, and Node and the
   * browser do not always agree on where the accented ones land — so a client
   * component that sorted for itself rendered one order on the server and
   * another after hydration, which React reports as a mismatch and repairs by
   * throwing the whole subtree away. Sorting once and passing the result means
   * both sides render the same list because it is the same list.
   */
  const countries = countriesByName(locale);

  const period = reportPeriod(params);

  const [registrations, rules, thresholds, report] = await Promise.all([
    jurisdictionsFor(shop.id),
    countryRulesFor(shop.id),
    shopThresholds(shop),
    taxReport({ shopId: shop.id, from: period.from, to: period.to }),
  ]);

  return (
    <div className="space-y-5">
      {/*
        First on the page and not last. A seller arriving here is looking for a
        number to act on, and the sentence that says these numbers are not
        advice has to be read before the numbers rather than after them.
      */}
      <Alert tone="info">{a.tax.notAdvice}</Alert>

      <ThresholdsCard thresholds={thresholds} />

      <RegistrationsCard
        registrations={registrations}
        taxMode={shop.taxMode}
        currency={shop.currency}
        countries={countries}
      />

      <CountriesCard shop={shop} rules={rules} countries={countries} />

      <ReportCard
        report={report}
        from={period.fromValue}
        to={period.toValue}
        canExport={can(shop, "csvExport")}
        exportPlan={cheapestPlanWith("csvExport")?.name ?? "Pro"}
      />
    </div>
  );
}

/**
 * The window the report covers: what was asked for, else the calendar year.
 *
 * Parsed rather than trusted — these two values reach a SQL `between`, and a
 * date is one of the few things a query string can carry that has an obvious
 * wrong shape. Anything that is not `YYYY-MM-DD` falls back to the year.
 */
function reportPeriod(params: Record<string, string | string[] | undefined>) {
  const read = (key: string) => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  };

  const year = calendarYearWindow(new Date());
  const fromValue = read("from") ?? year.from.toISOString().slice(0, 10);
  const toValue = read("to") ?? year.to.toISOString().slice(0, 10);

  return {
    fromValue,
    toValue,
    from: new Date(`${fromValue}T00:00:00.000Z`),
    to: new Date(`${toValue}T00:00:00.000Z`),
  };
}
