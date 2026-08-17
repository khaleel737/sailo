import type { Metadata } from "next";
import { PageHeader } from "@sailo/design-system/web";
import { getProgramSettings, getSettingsAudit } from "@sailo/partners/settings";
import { PLANS } from "@sailo/core/plans";
import { SettingsForm } from "../_components/settings-form";

export const metadata: Metadata = { title: "Partner programme settings" };

/**
 * The terms of the programme, as a form.
 *
 * Everything here changes behaviour without a deploy, which is the point — a
 * rate or a hold period is a commercial decision somebody will want to move
 * for a campaign, and making that a code change means it happens at whatever
 * speed engineering happens.
 *
 * The one thing this screen deliberately cannot do is restate history. Every
 * `referral_earnings` row records the rate it was computed at, so changing the
 * rate here applies from the next invoice and touches nothing already earned.
 * That is said on the form, because it is the first thing an operator will
 * worry about before pressing Save.
 */
export default async function HqPartnerSettingsPage() {
  const [settings, audit] = await Promise.all([
    getProgramSettings(),
    getSettingsAudit(),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/hq/partners", label: "Partners" }}
        title="Programme settings"
        description="The terms every partner is on, unless they've negotiated their own."
      />

      <SettingsForm
        settings={settings}
        planPrices={{
          pro: PLANS.pro.monthlyCents,
          business: PLANS.business.monthlyCents,
        }}
        audit={
          audit
            ? {
                updatedBy: audit.updatedBy,
                updatedAt: audit.updatedAt.toISOString(),
              }
            : null
        }
      />
    </>
  );
}
