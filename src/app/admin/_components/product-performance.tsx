import Link from "next/link";
import { BarChart3 } from "lucide-react";
import type { ProductPerformance } from "@/lib/queries";
import { Card, EmptyState } from "@/components/ui";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@/i18n";
import { formatMoney } from "@/lib/utils";

/**
 * Views · Orders · Conversion · Revenue, one row per product.
 *
 * Titles come from the order-line snapshot (see `getProductPerformance`), so
 * a deleted product's revenue stays on the page under the name it sold as.
 * The table is a page of a whole, and says so — "showing top 50 of N" — per
 * the no-silent-caps rule.
 */
export async function ProductPerformancePanel({
  data,
  currency,
  locale,
  rangeQuery,
}: {
  data: ProductPerformance;
  currency: string;
  locale: string;
  /** The current window's query string, carried by the pager links. */
  rangeQuery: string;
}) {
  const { a } = await getAdminT();

  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  const pageHref = (page: number) =>
    `/admin?${rangeQuery ? `${rangeQuery}&` : ""}pp=${page}`;

  const lastShown = (data.page - 1) * data.perPage + data.rows.length;

  return (
    <Card className="mb-6 p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{a.performance.title}</h2>
        {data.total > data.perPage ? (
          <p className="text-xs text-ink-400">
            {interpolate(a.performance.showingTop, {
              shown: lastShown,
              total: data.total,
            })}
          </p>
        ) : null}
      </div>

      {data.rows.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="size-7" />}
          title={a.traffic.noData}
          description={a.performance.empty}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-start text-xs font-medium uppercase tracking-wide text-ink-400">
                <th className="pb-2 pe-3 text-start font-medium">
                  {a.columns.product}
                </th>
                <th className="pb-2 px-3 text-end font-medium">
                  {a.dashboard.views}
                </th>
                <th className="pb-2 px-3 text-end font-medium">
                  {a.columns.orders}
                </th>
                <th className="pb-2 px-3 text-end font-medium">
                  {a.performance.conversion}
                </th>
                <th className="pb-2 ps-3 text-end font-medium">
                  {a.performance.revenue}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {data.rows.map((row) => (
                <tr key={row.key}>
                  <td className="max-w-0 truncate py-2.5 pe-3" dir="auto">
                    <span className="font-medium text-ink-900">{row.title}</span>
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-ink-700">
                    {row.views.toLocaleString(locale)}
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-ink-700">
                    {row.orders.toLocaleString(locale)}
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-ink-700">
                    {/* No views means no rate — a dash, never Infinity. */}
                    {row.conversion === null ? "—" : percent.format(row.conversion)}
                  </td>
                  <td className="ps-3 py-2.5 text-end font-medium tabular-nums">
                    {formatMoney(row.revenueCents, currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.total > data.perPage ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs font-medium">
          {data.page > 1 ? (
            <Link
              href={pageHref(data.page - 1)}
              scroll={false}
              className="focus-ring rounded px-2 py-1 text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
            >
              {a.performance.previous}
            </Link>
          ) : null}
          {lastShown < data.total ? (
            <Link
              href={pageHref(data.page + 1)}
              scroll={false}
              className="focus-ring rounded px-2 py-1 text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
            >
              {a.performance.next}
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
