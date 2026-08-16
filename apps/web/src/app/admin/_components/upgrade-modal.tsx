"use client";

import { useState, type ReactNode } from "react";
import { Check, Lock, Sparkles } from "lucide-react";
import { startCheckout } from "@/lib/actions/billing";
import {
  PLANS,
  PLAN_IDS,
  PLATFORM_FEE_RANGE_LABEL,
  type Features,
  type PlanId,
} from "@/lib/plans";
import { Badge, Button } from "@/components/ui";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Dialog } from "@/components/overlays";
import { formatMoney } from "@/lib/utils";
import { useAdminLocale } from "@/app/admin/_components/admin-i18n";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import { cn } from "@/lib/utils";

/*
 * A Dialog, not a Sheet: this is one decision — which plan — and everything
 * behind it is irrelevant until it is answered. It stays a dialog even at two
 * plans wide because there is no flow here, just a choice.
 */

/** Copy for the headline when a specific locked feature triggered the modal. */
function featureCopy(feature: keyof Features, t: Dictionary) {
  const map: Partial<Record<keyof Features, { title: string; body: string }>> = {
    cardRails: { title: t.billing.cardTitle, body: interpolate(t.billing.cardBody, { fee: PLATFORM_FEE_RANGE_LABEL }) },
    coupons: { title: t.billing.couponsTitle, body: t.billing.couponsBody },
    affiliates: {
      title: t.billing.affiliatesTitle,
      body: t.billing.affiliatesBody,
    },
    csvExport: { title: t.billing.exportTitle, body: t.billing.exportBody },
    removeBadge: { title: t.billing.badgeTitle, body: t.billing.badgeBody },
  };
  return map[feature];
}

export function UpgradeModal({
  open,
  onClose,
  feature,
  currentPlan,
  title,
  body,
  t,
}: {
  open: boolean;
  onClose: () => void;
  /** Highlights the cheapest plan that unlocks this. */
  feature?: keyof Features;
  currentPlan: PlanId;
  title?: string;
  body?: string;
  t: Dictionary;
}) {
  const locale = useAdminLocale();
  const [interval, setInterval] = useState<"month" | "year">("month");

  const copy = feature ? featureCopy(feature, t) : undefined;
  const needed = feature
    ? PLAN_IDS.find((id) => PLANS[id].features[feature])
    : undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      closeLabel={t.common.close}
      title={title ?? copy?.title ?? t.billing.upgradeTitle}
      description={body ?? copy?.body ?? t.billing.upgradeBody}
      eyebrow={
        copy ? (
          <Badge tone="neutral">
            <Lock className="size-3" />
            {needed
              ? interpolate(t.billing.planFeature, { plan: PLANS[needed].name })
              : t.billing.paidFeature}
          </Badge>
        ) : null
      }
      footer={
        <p className="w-full text-center text-xs text-ink-400">
          {interpolate(t.billing.cancelAnyTime, { fee: PLATFORM_FEE_RANGE_LABEL })}
        </p>
      }
    >
      <div className="flex justify-center">
        <SegmentedControl
          value={interval}
          onChange={setInterval}
          ariaLabel={t.billing.monthly}
          options={[
            { value: "month" as const, label: t.billing.monthly },
            {
              value: "year" as const,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {t.billing.yearly}
                  <span className="text-xs font-semibold text-brand-600">
                    −20%
                  </span>
                </span>
              ),
            },
          ]}
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {PLAN_IDS.filter((id) => id !== "free").map((id) => {
          const plan = PLANS[id];
          const isCurrent = currentPlan === id;
          const recommended = needed === id || (!needed && id === "business");
          const monthly =
            interval === "year"
              ? Math.round(plan.yearlyCents / 12)
              : plan.monthlyCents;

          return (
            <div
              key={id}
              className={cn(
                "flex flex-col rounded-2xl border p-5 transition-colors",
                recommended
                  ? "border-brand-600 bg-brand-50/40 ring-1 ring-brand-600"
                  : "border-ink-200",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-ink-900">{plan.name}</h3>
                {recommended ? (
                  <Badge tone="brand">
                    <Sparkles className="size-3" />
                    {needed === id ? t.billing.unlocksThis : t.billing.bestValue}
                  </Badge>
                ) : null}
                {isCurrent ? (
                  <Badge tone="green">{t.billing.currentPlan}</Badge>
                ) : null}
              </div>

              <p className="mt-3">
                <span className="tabular text-2xl font-semibold text-ink-900">
                  {formatMoney(monthly, "USD", locale)}
                </span>
                <span className="text-sm text-ink-500">
                  {" "}
                  {t.billing.perMonth}
                </span>
              </p>
              {interval === "year" ? (
                <p className="tabular text-xs text-ink-400">
                  {interpolate(t.billing.billedYearly, {
                    amount: formatMoney(plan.yearlyCents, "USD", locale),
                  })}
                </p>
              ) : null}

              <ul className="mt-3 flex-1 space-y-2">
                {plan.highlights.map((key) => (
                  <li
                    key={key}
                    className="flex gap-2 text-sm leading-snug text-ink-700"
                  >
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-brand-600"
                      strokeWidth={3}
                    />
                    {t.highlights[key]}
                  </li>
                ))}
              </ul>

              <form action={startCheckout} className="mt-4">
                <input type="hidden" name="plan" value={id} />
                <input type="hidden" name="interval" value={interval} />
                <Button
                  type="submit"
                  variant={recommended ? "brand" : "secondary"}
                  disabled={isCurrent}
                  className="w-full"
                >
                  {isCurrent
                    ? t.billing.yourPlan
                    : interpolate(t.billing.upgradeTo, { plan: plan.name })}
                </Button>
              </form>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/** Button that opens the upgrade modal, for use anywhere a gate bites. */
export function UpgradeButton({
  feature,
  currentPlan,
  children,
  className,
  title,
  body,
  t,
}: {
  feature?: keyof Features;
  currentPlan: PlanId;
  children: ReactNode;
  className?: string;
  title?: string;
  body?: string;
  t: Dictionary;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <UpgradeModal
        open={open}
        onClose={() => setOpen(false)}
        feature={feature}
        currentPlan={currentPlan}
        title={title}
        body={body}
        t={t}
      />
    </>
  );
}
