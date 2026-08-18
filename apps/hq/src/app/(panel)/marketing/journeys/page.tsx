import type { Metadata } from "next";
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { Card, PageHeader } from "@sailo/design-system/web";
import { SectionTitle } from "@/app/_components/hq-ui";
import { hqLifecycleSteps } from "@/lib/platform";
import { formatMoment } from "@/lib/format";

export const metadata: Metadata = { title: "Journeys" };

/**
 * The behaviour-triggered mail, made visible.
 *
 * Sailo has been sending this since long before there was a marketing section:
 * twelve rungs, each with a real anchor (the signup, the shop, the first
 * product, the first sale), each re-checked at send time against what the
 * seller has actually done. What it never had was a screen. The only way to
 * find out whether a rung was firing was to query the table by hand, so a step
 * whose predicate quietly stopped matching — a column renamed, a default
 * changed — would go silent and nothing would say so.
 *
 * This is that screen, and the column that earns it is `Last`. A rung with a
 * last send three weeks ago on a product taking signups daily is a bug; it is
 * only visible next to the eleven that fired this morning.
 *
 * Read-only, and deliberately. The ladder is code — anchors, predicates and
 * expiries in `@sailo/marketing/lifecycle` — because every one of those is a
 * decision that should be reviewed in a pull request rather than typed into a
 * form at speed. A rule engine here would move twelve reviewed decisions into
 * a database where nobody can see them change.
 */

/** What each rung is for, in the words somebody reading this screen needs. */
const WHAT_IT_SAYS: Record<string, string> = {
  no_shop_1: "Signed up two hours ago and built nothing yet.",
  no_shop_2: "Two days in, still no shop.",
  no_shop_3: "Nine days. Says outright that it is the last one.",
  shop_live: "Their shop is live — carries the public link they will want again.",
  no_product_1: "A shop with nothing in it, two days on.",
  no_product_2: "Still empty after a week.",
  no_rail: "Something to sell and no way to be paid for it. The costliest gap.",
  no_orders_1: "Ready to sell, three days, nobody has bought.",
  no_orders_2: "Still no first sale.",
  first_sale: "They sold something.",
  upgrade: "Selling enough that the plan is worth talking about.",
  catch_up: "Everyone the rungs above have gone stale for.",
  retired: "Tombstone — the pipeline has run out of things to say.",
};

export default async function HqJourneysPage() {
  const steps = await hqLifecycleSteps();

  const total = steps.reduce((sum, step) => sum + step.sent, 0);
  const failed = steps.reduce((sum, step) => sum + step.failed, 0);
  /*
   * A rung that has never fired is not automatically wrong — a brand-new one
   * genuinely has not had a seller reach it yet — so it is flagged rather than
   * called an error, and the flag is what sends somebody to look.
   */
  const silent = steps.filter((step) => step.claimed === 0);

  return (
    <>
      <PageHeader
        title="Journeys"
        description="The mail Sailo sends sellers about Sailo, triggered by what they have actually done rather than by a schedule."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-ink-400">Sent, all time</p>
          <p className="tabular mt-1.5 text-2xl font-semibold text-ink-900">
            {total.toLocaleString()}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-ink-400">Failed</p>
          <p className="tabular mt-1.5 text-2xl font-semibold text-ink-900">
            {failed.toLocaleString()}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            A claim is kept after a failure rather than released, so a miss is
            visible instead of becoming a second send.
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-ink-400">Never fired</p>
          <p className="tabular mt-1.5 text-2xl font-semibold text-ink-900">
            {silent.length}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            {silent.length === 0
              ? "Every rung has reached somebody."
              : "New, or the predicate stopped matching. Worth a look either way."}
          </p>
        </Card>
      </div>

      <SectionTitle>The ladder</SectionTitle>
      <ol className="space-y-2">
        {steps.map((step) => {
          const icon =
            step.claimed === 0 ? (
              <CircleDashed className="size-4 text-ink-300" aria-hidden />
            ) : step.failed > 0 ? (
              <CircleAlert className="size-4 text-amber-600" aria-hidden />
            ) : (
              <CircleCheck className="size-4 text-emerald-600" aria-hidden />
            );

          return (
            <li key={step.step}>
              <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <span className="shrink-0">{icon}</span>
                <div className="min-w-48 flex-1">
                  <p className="font-mono text-xs text-ink-900">{step.step}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                    {WHAT_IT_SAYS[step.step] ?? "—"}
                  </p>
                </div>
                <div className="tabular flex shrink-0 gap-6 text-sm">
                  <span title="Sent">
                    <span className="text-ink-900">{step.sent.toLocaleString()}</span>
                    <span className="ms-1 text-xs text-ink-400">sent</span>
                  </span>
                  <span title="Failed">
                    <span
                      className={step.failed > 0 ? "text-amber-700" : "text-ink-400"}
                    >
                      {step.failed.toLocaleString()}
                    </span>
                    <span className="ms-1 text-xs text-ink-400">failed</span>
                  </span>
                </div>
                <span className="w-40 shrink-0 text-end text-xs text-ink-500">
                  {formatMoment(step.lastAt)}
                </span>
              </Card>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        Nobody hears from this pipeline twice inside twenty hours, and an
        address that unsubscribes is written to the same platform-wide opt-out
        the newsletter uses — one address, one promise, whichever of our two
        streams they were reading when they decided.
      </p>
    </>
  );
}
