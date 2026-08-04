"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Lock, Sparkles, X } from "lucide-react";
import { startCheckout } from "@/lib/actions/billing";
import { PLAN_IDS, PLANS, type Features, type PlanId } from "@/lib/plans";
import { formatMoney } from "@/lib/utils";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { cn } from "@/lib/utils";

/** Copy for the headline when a specific locked feature triggered the modal. */
function featureCopy(feature: keyof Features, t: Dictionary) {
  const map: Partial<Record<keyof Features, { title: string; body: string }>> = {
    cardRails: { title: t.billing.cardTitle, body: t.billing.cardBody },
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
  const [interval, setInterval] = useState<"month" | "year">("month");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const copy = feature ? featureCopy(feature, t) : undefined;
  const needed = feature
    ? PLAN_IDS.find((id) => PLANS[id].features[feature])
    : undefined;

  // Rendered into <body>: an ancestor with backdrop-filter, filter or
  // transform becomes the containing block for position:fixed, which would
  // otherwise anchor this to the sticky header instead of the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy?.title ?? t.billing.upgradeTitle}
    >
      <button
        type="button"
        aria-label={t.common.close}
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm"
      />

      <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-900"
        >
          <X className="size-5" />
        </button>

        <div className="pr-10">
          {copy ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600">
              <Lock className="size-3" />
              {needed
                ? interpolate(t.billing.planFeature, {
                    plan: PLANS[needed].name,
                  })
                : t.billing.paidFeature}
            </span>
          ) : null}
          <h2 className="mt-2 text-xl font-semibold tracking-tight">
            {title ?? copy?.title ?? t.billing.upgradeTitle}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            {body ?? copy?.body ?? t.billing.upgradeBody}
          </p>
        </div>

        <div className="mt-5 flex justify-center">
          <div className="inline-flex rounded-xl border border-ink-200 p-1">
            {(["month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setInterval(value)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
                  interval === value
                    ? "bg-ink-900 text-white"
                    : "text-ink-600 hover:text-ink-900",
                )}
              >
                {value === "month" ? t.billing.monthly : t.billing.yearly}
                {value === "year" ? (
                  <span
                    className={cn(
                      "ml-1.5 text-xs",
                      interval === value ? "text-white/70" : "text-emerald-600",
                    )}
                  >
                    −20%
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                  "flex flex-col rounded-2xl border p-5",
                  recommended
                    ? "border-ink-900 ring-1 ring-ink-900"
                    : "border-ink-200",
                )}
              >
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{plan.name}</h3>
                  {recommended ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      <Sparkles className="size-3" />
                      {needed === id ? t.billing.unlocksThis : t.billing.bestValue}
                    </span>
                  ) : null}
                  {isCurrent ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      {t.billing.currentPlan}
                    </span>
                  ) : null}
                </div>

                <p className="mt-3">
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatMoney(monthly, "USD")}
                  </span>
                  <span className="text-sm text-ink-500"> {t.billing.perMonth}</span>
                </p>
                {interval === "year" ? (
                  <p className="text-xs text-ink-400">
                    {interpolate(t.billing.billedYearly, {
                      amount: formatMoney(plan.yearlyCents, "USD"),
                    })}
                  </p>
                ) : null}

                <ul className="mt-3 flex-1 space-y-1.5">
                  {plan.highlights.map((key) => (
                    <li key={key} className="flex gap-2 text-sm text-ink-700">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      {t.highlights[key]}
                    </li>
                  ))}
                </ul>

                <form action={startCheckout} className="mt-4">
                  <input type="hidden" name="plan" value={id} />
                  <input type="hidden" name="interval" value={interval} />
                  <button
                    type="submit"
                    disabled={isCurrent}
                    className={cn(
                      "h-10 w-full rounded-xl text-sm font-medium transition",
                      isCurrent
                        ? "cursor-not-allowed bg-ink-100 text-ink-400"
                        : recommended
                          ? "bg-ink-900 text-white hover:bg-ink-800"
                          : "border border-ink-200 bg-white text-ink-900 hover:bg-ink-50",
                    )}
                  >
                    {isCurrent
                      ? t.billing.yourPlan
                      : interpolate(t.billing.upgradeTo, { plan: plan.name })}
                  </button>
                </form>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-center text-xs text-ink-400">
          {t.billing.cancelAnyTime}
        </p>
      </div>
    </div>,
    document.body,
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
