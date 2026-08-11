import { Lock } from "lucide-react";
import { cheapestPlanWith, planFor, type Features } from "@/lib/plans";
import { UpgradeButton } from "./upgrade-modal";
import { Card } from "@/components/ui";
import type { Shop } from "@sailo/db/schema";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";

/**
 * Small chip naming the plan that unlocks something. Locked features stay
 * visible with this rather than disappearing — a feature nobody can see is a
 * feature nobody upgrades for.
 */
export function PlanBadge({ feature }: { feature: keyof Features }) {
  const plan = cheapestPlanWith(feature);
  if (!plan) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      <Lock className="size-3" />
      {plan.name}
    </span>
  );
}

/**
 * Full-page state for a feature the current plan doesn't include: says what it
 * does, which plan unlocks it, and opens the upgrade modal in place.
 */
export function LockedFeature({
  shop,
  feature,
  icon,
  title,
  description,
  points,
  t,
}: {
  shop: Shop;
  feature: keyof Features;
  icon?: React.ReactNode;
  title: string;
  description: string;
  points?: string[];
  t: Dictionary;
}) {
  const plan = cheapestPlanWith(feature);
  const current = planFor(shop);

  return (
    <Card className="flex flex-col items-center px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-ink-300">{icon}</div> : null}

      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <PlanBadge feature={feature} />
      </div>

      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-600">
        {description}
      </p>

      {points?.length ? (
        <ul className="mt-4 space-y-1 text-sm text-ink-600">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      <UpgradeButton
        feature={feature}
        currentPlan={current.id}
        t={t}
        className="mt-6 inline-flex h-10 items-center rounded-xl bg-ink-900 px-5 text-sm font-medium text-white transition hover:bg-ink-800"
      >
        {interpolate(t.billing.upgradeTo, { plan: plan?.name ?? "" })}
      </UpgradeButton>

      <p className="mt-2 text-xs text-ink-400">
        {interpolate(t.billing.youAreOn, { plan: current.name })}
      </p>
    </Card>
  );
}
