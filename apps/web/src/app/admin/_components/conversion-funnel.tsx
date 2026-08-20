import type { ConversionFunnel } from "@sailo/analytics/queries";
import { Card } from "@sailo/design-system/web";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";

/**
 * Three stages, drawn to scale — spec 42's missing panel.
 *
 * Three and not four: "added to cart" is not an event the pipeline records
 * yet, and a funnel stage the data cannot back would read as measurement.
 * The bars share one scale (the sessions bar is always full width), so the
 * narrowing *is* the message and no axis is needed.
 */
export async function ConversionFunnelPanel({ funnel }: { funnel: ConversionFunnel }) {
  const { a, locale } = await getAdminT();

  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  const stages = [
    { label: a.funnel.sessions, count: funnel.sessions, tone: "bg-ink-300" },
    { label: a.funnel.reachedCheckout, count: funnel.reachedCheckout, tone: "bg-brand-300" },
    { label: a.funnel.completed, count: funnel.completed, tone: "bg-brand-600" },
  ];

  return (
    <Card className="mb-6 p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">{a.funnel.title}</h2>
        <p className="text-sm text-ink-500">
          {a.funnel.conversion}{" "}
          <span className="font-semibold text-ink-900">
            {funnel.conversion === null ? "—" : percent.format(funnel.conversion)}
          </span>
        </p>
      </div>

      {funnel.sessions === 0 ? (
        <p className="text-sm text-ink-500">{a.funnel.noData}</p>
      ) : (
        <div className="space-y-3">
          {stages.map((stage) => {
            /* Capped at 1: sessions are client-recorded and ad-block
               suppressed, the other stages are server-recorded — see the
               matching cap on `conversion` in @sailo/analytics/funnel. */
            const share =
              funnel.sessions > 0 ? Math.min(stage.count / funnel.sessions, 1) : 0;
            return (
              <div key={stage.label}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-ink-700">{stage.label}</span>
                  <span className="tabular text-ink-500">
                    {stage.count.toLocaleString(locale)}
                    {" · "}
                    {interpolate(a.funnel.ofSessions, {
                      percent: percent.format(share),
                    })}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink-50">
                  <div
                    className={`h-full rounded-full ${stage.tone}`}
                    style={{ width: `${Math.max(share * 100, stage.count > 0 ? 1 : 0)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
