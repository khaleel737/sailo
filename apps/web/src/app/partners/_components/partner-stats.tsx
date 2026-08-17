import { CopyLink } from "@sailo/design-system/web";
import { formatMoney } from "@sailo/core/currency";
import type { PartnerSummary } from "@/lib/partners/store";

/**
 * The link, and the four numbers underneath it.
 *
 * "Available" leads because it is the number the partner came to see. "Held"
 * sits next to it rather than being folded into a single "unpaid" figure,
 * because the difference between *owed* and *sendable* is exactly the thing a
 * partner would otherwise email us about — and a hold nobody explained looks
 * like a payment that went missing.
 */
export function PartnerStats({
  url,
  summary,
  currency,
  minimumCents,
  holdDays,
}: {
  url: string;
  summary: PartnerSummary;
  currency: string;
  minimumCents: number;
  holdDays: number;
}) {
  const money = (cents: number) => formatMoney(cents, currency);

  const stats = [
    { label: "Ready to pay", value: money(summary.availableCents), accent: true },
    { label: `Held (${holdDays} days)`, value: money(summary.heldCents) },
    { label: "Paid out", value: money(summary.paidCents) },
    {
      label: "Creators paying",
      value: `${summary.convertedCount} of ${summary.referredCount}`,
    },
  ];

  return (
    <>
      <div className="mt-4">
        <CopyLink url={url} variant="surface" showUrl copyLabel="Copy" copiedLabel="Copied" />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-ink-100 p-3.5">
            <dt className="text-xs font-medium text-ink-500">{stat.label}</dt>
            <dd
              className={`mt-1 text-lg font-semibold tabular-nums ${
                stat.accent ? "text-brand-700" : "text-ink-900"
              }`}
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {/*
        The threshold and the hold, both stated. A partner who discovers either
        by not being paid is exactly what the no-silent-caps rule exists to
        prevent, so both numbers come from the same settings the payout run
        enforces rather than from copy written once and left behind.
      */}
      <p className="mt-3 text-xs leading-relaxed text-ink-500">
        {summary.availableCents < 0
          ? "A refund landed after we'd already paid you, so your balance is behind. Your next earnings work it off — nothing is owed by you."
          : summary.payable
            ? `You're over the ${money(minimumCents)} minimum — this goes out in the next payout run.`
            : `We send your balance once it passes ${money(minimumCents)}. Earnings are held for ${holdDays} days first, so refunds settle before the money leaves.`}
      </p>
    </>
  );
}
