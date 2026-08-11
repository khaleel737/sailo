import Link from "next/link";
import { ArrowRight, Clock, Gift } from "lucide-react";
import { Card } from "@/components/ui";
import { CopyLink } from "@/components/shared/copy-link";
import { interpolate } from "@/i18n";
import type { AdminDictionary } from "@/i18n/admin/en";
import { formatMoney } from "@/lib/utils";
import { referralUrl, shareLabel } from "@/lib/partners/program";
import type { PartnerCard } from "@/lib/partners/store";

/**
 * "Bring another creator, keep 30% of what they pay us."
 *
 * On the dashboard rather than in settings, because it is a thing we want
 * sellers to *do* and settings is where things go to be configured once. It is
 * also deliberately the last card on the page: a seller who has not taken an
 * order yet has a shop to finish, and this is the reward for scrolling past
 * that.
 *
 * Not plan-gated. This is Sailo's own acquisition channel — charging for the
 * privilege of bringing us customers would be an odd way to run it.
 *
 * Four states, because a seller is now a *partner* rather than automatically a
 * referrer, and each state has a different next action:
 *
 *   - `join` — they've never applied. The card is a pitch and a button.
 *   - `pending` — applied, waiting on us. Says so, and offers nothing to do.
 *   - `rejected` — declined or suspended. Says nothing beyond that; the
 *     reason, if there is one, is on /partners where there is room for it.
 *   - `active` — the link, and what it has earned.
 *
 * The share is read from the card's data rather than a constant, so a seller
 * on a negotiated rate is quoted *their* rate and not the programme's.
 */
export function ReferralCard({
  card,
  currency,
  locale,
  a,
}: {
  card: PartnerCard;
  /** The shop's currency, for the empty state — the ledger names its own. */
  currency: string;
  locale: string;
  a: AdminDictionary;
}) {
  const share = shareLabel(card.commissionBp);

  const header = (
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Gift className="size-4" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink-900">{a.referral.title}</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          {interpolate(a.referral.body, { share })}
        </p>
      </div>
    </div>
  );

  if (card.state !== "active") {
    return (
      <Card className="mt-6 p-5">
        {header}
        {card.state === "join" ? (
          <Link
            href="/partners"
            className="focus-ring mt-4 inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white transition hover:bg-ink-800"
          >
            {a.referral.join}
            <ArrowRight className="size-4" />
          </Link>
        ) : (
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600">
            <Clock className="size-3.5 shrink-0" />
            {card.state === "pending"
              ? a.referral.underReview
              : a.referral.notActive}
          </p>
        )}
      </Card>
    );
  }

  const { summary, minimumCents } = card;

  /*
   * The ledger's currency, not the shop's: Sailo bills in one currency and the
   * seller may sell in another, so showing their own next to our number would
   * state a figure they cannot reconcile with what lands in their bank. Falls
   * back to the shop's only while the ledger is empty, where both read as zero.
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
      {header}

      <div className="mt-4">
        <CopyLink
          url={referralUrl(card.code)}
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
        number comes from the same setting the payout run enforces.
      */}
      <p className="mt-4 text-xs text-ink-500">
        {interpolate(a.referral.terms, {
          minimum: formatMoney(minimumCents, ledgerCurrency, locale),
        })}{" "}
        <Link href="/partners" className="underline hover:no-underline">
          {a.referral.dashboard}
        </Link>
      </p>
    </Card>
  );
}
