import { Gift } from "lucide-react";
import { Card } from "@/components/ui";
import { CopyLink } from "@/components/shared/copy-link";
import { interpolate } from "@/i18n";
import type { AdminDictionary } from "@/i18n/admin/en";
import { formatMoney } from "@/lib/utils";
import {
  REFERRAL_SHARE_LABEL,
  referralUrl,
} from "@/lib/creator-referrals/program";
import type { ReferralSummary } from "@/lib/creator-referrals/store";

/**
 * "Bring another creator, keep 20% of what they pay us."
 *
 * On the dashboard rather than in settings, because it is a thing we want
 * sellers to *do* and settings is where things go to be configured once. It
 * is also deliberately the last card on the page: a seller who has not taken
 * an order yet has a shop to finish, and this is the reward for scrolling
 * past that.
 *
 * Not plan-gated. This is Sailo's own acquisition channel — charging for the
 * privilege of bringing us customers would be an odd way to run it.
 */
export function ReferralCard({
  code,
  summary,
  currency,
  locale,
  minimumCents,
  a,
}: {
  code: string;
  summary: ReferralSummary;
  /** The shop's currency, for the empty state — the ledger names its own. */
  currency: string;
  locale: string;
  minimumCents: number;
  a: AdminDictionary;
}) {
  const url = referralUrl(code);

  /*
   * The ledger's currency, not the shop's: Sailo bills in one currency and
   * the seller may sell in another, so showing their own next to our number
   * would state a figure they cannot reconcile with what lands in their bank.
   * Falls back to the shop's only while the ledger is empty, where both read
   * as zero anyway.
   */
  const ledgerCurrency = summary.currency ?? currency;
  const money = (cents: number) => formatMoney(cents, ledgerCurrency, locale);

  const stats = [
    { label: a.referral.referred, value: summary.referredCount.toLocaleString(locale) },
    { label: a.referral.paying, value: summary.convertedCount.toLocaleString(locale) },
    { label: a.referral.earned, value: money(summary.lifetimeCents) },
    { label: a.referral.unpaid, value: money(summary.unpaidCents) },
  ];

  return (
    <Card className="mt-6 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Gift className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-900">
            {a.referral.title}
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            {interpolate(a.referral.body, { share: REFERRAL_SHARE_LABEL })}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <CopyLink
          url={url}
          variant="surface"
          showUrl
          copyLabel={a.referral.copy}
          copiedLabel={a.referral.copied}
        />
      </div>

      {/*
        Numbers only once there is something to count. A row of four zeroes
        under a pitch reads as evidence the pitch does not work.
      */}
      {summary.referredCount > 0 ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-ink-500">{stat.label}</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink-900">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/*
        The threshold, stated. A seller who discovers it by not being paid is
        exactly the outcome the no-silent-caps rule exists to prevent, so the
        number comes from the same constant the payout page enforces.
      */}
      <p className="mt-4 text-xs text-ink-500">
        {interpolate(a.referral.terms, {
          minimum: formatMoney(minimumCents, ledgerCurrency, locale),
        })}
      </p>
    </Card>
  );
}
