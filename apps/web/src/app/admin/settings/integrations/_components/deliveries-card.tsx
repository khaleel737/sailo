"use client";

import { Card } from "@sailo/design-system/web";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";

export type DeliveryRow = {
  id: string;
  event: string;
  status: string;
  attempt: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
};

/**
 * The last twenty attempts, and the only place a seller can find out *why* a
 * webhook did not arrive.
 *
 * Without it the failure mode is completely opaque: a Zap stops firing, the
 * shop keeps selling, and there is nothing anywhere that says the POST came
 * back 403. The error column is the whole point of the table.
 */
export function DeliveriesCard({ rows }: { rows: DeliveryRow[] }) {
  const a = useAdminT();
  const locale = useAdminLocale();

  const format = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(date));

  const tone: Record<string, string> = {
    ok: "text-emerald-700",
    failed: "text-red-600",
    pending: "text-ink-500",
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.integrations.logTitle}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.integrations.logBody}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-ink-500">{a.integrations.logEmpty}</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-start text-xs font-medium text-ink-500">
                <th scope="col" className="pb-2 text-start font-medium">
                  {a.integrations.colEvent}
                </th>
                <th scope="col" className="pb-2 text-start font-medium">
                  {a.integrations.colStatus}
                </th>
                <th scope="col" className="pb-2 text-start font-medium">
                  {a.integrations.colWhen}
                </th>
                <th scope="col" className="pb-2 text-start font-medium">
                  {a.integrations.colResult}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => (
                <tr key={row.id} className="text-xs">
                  <td className="py-2 font-mono text-ink-900">{row.event}</td>
                  <td className={`py-2 font-medium ${tone[row.status] ?? "text-ink-500"}`}>
                    {row.status}
                  </td>
                  <td className="py-2 text-ink-500">{format(row.createdAt)}</td>
                  <td className="py-2 text-ink-500">
                    {/*
                      The response code when there was one, the error when
                      there was not — a refused address and a timeout never
                      reach a status code at all, and those are exactly the
                      failures worth reading.
                    */}
                    {row.responseStatus ? `${row.responseStatus} · ` : ""}
                    {row.error ??
                      (row.deliveredAt
                        ? interpolate(a.integrations.attemptCount, {
                            n: String(row.attempt),
                          })
                        : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
