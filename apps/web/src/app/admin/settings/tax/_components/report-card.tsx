import { Download, Lock } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  EmptyRow,
  Field,
  Input,
  Table,
  Td,
  Th,
  Tr,
} from "@sailo/design-system/web";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { formatMoney } from "@sailo/core/currency";
import { countryName } from "@sailo/core/countries";
import type { TaxReport } from "@sailo/commerce/tax/server";

/**
 * The filable half: net, tax, orders and the B2B split, per place, per period.
 *
 * The reconciliation line under the table is the part that matters. A report
 * that disagrees with the orders it was folded from is a report nobody can
 * file, and a seller has no way to tell a wrong total from a right one by
 * looking at it — so the disagreement is stated rather than left to be
 * discovered by an accountant.
 *
 * A plain `GET` form, so the period lives in the URL and a seller can bookmark
 * a quarter or send one to their accountant.
 */
export async function ReportCard({
  report,
  from,
  to,
  canExport,
  exportPlan,
}: {
  report: TaxReport;
  from: string;
  to: string;
  canExport: boolean;
  exportPlan: string;
}) {
  const { a, locale } = await getAdminT();
  const r = report.reconciliation;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.tax.reportTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.tax.reportBody}</p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <Field label={a.tax.from} htmlFor="report-from">
          <Input id="report-from" name="from" type="date" defaultValue={from} />
        </Field>
        <Field label={a.tax.to} htmlFor="report-to">
          <Input id="report-to" name="to" type="date" defaultValue={to} />
        </Field>
        <Button type="submit" size="sm" variant="secondary">
          {a.tax.run}
        </Button>

        {canExport ? (
          <a
            href={`/api/tax/report?from=${from}&to=${to}`}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium text-ink-900 transition hover:bg-ink-50 pointer-coarse:h-11"
          >
            <Download className="size-4" />
            {a.tax.download}
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
            <Lock className="size-3.5" />
            {interpolate(a.tax.downloadLocked, { plan: exportPlan })}
          </span>
        )}
      </form>

      <Table
        minWidth="40rem"
        head={
          <>
            <Th>{a.tax.place}</Th>
            <Th align="end">{a.tax.ordersColumn}</Th>
            <Th align="end">{a.tax.totalNet}</Th>
            <Th align="end">{a.tax.b2bColumn}</Th>
            <Th align="end">{a.tax.totalTax}</Th>
          </>
        }
      >
        {report.rows.length === 0 ? (
          <EmptyRow colSpan={5}>{a.tax.reportEmpty}</EmptyRow>
        ) : (
          report.rows.map((row) => (
            <Tr key={`${row.key}-${row.currency}`}>
              <Td>
                <span className="font-medium text-ink-900">
                  {row.country ? countryName(row.country, locale) : a.tax.notRecorded}
                </span>
                {row.region ? (
                  <span className="ml-1 text-xs text-ink-500">{row.region}</span>
                ) : null}
              </Td>
              <Td align="end" label={a.tax.ordersColumn}>
                {row.orderCount}
              </Td>
              <Td align="end" label={a.tax.totalNet}>
                {formatMoney(row.netCents, row.currency)}
              </Td>
              <Td align="end" label={a.tax.b2bColumn}>
                {formatMoney(row.b2bNetCents, row.currency)}
              </Td>
              <Td align="end" label={a.tax.totalTax}>
                {formatMoney(row.taxCents, row.currency)}
              </Td>
            </Tr>
          ))
        )}
      </Table>

      {report.totals.length > 0 ? (
        <ul className="flex flex-wrap gap-4 text-sm">
          {report.totals.map((total) => (
            <li key={total.currency}>
              <span className="text-ink-500">{a.tax.totalTax} </span>
              <span className="font-semibold text-ink-900">
                {formatMoney(total.taxCents, total.currency)}
              </span>
              <span className="text-ink-500">
                {" · "}
                {a.tax.totalNet} {formatMoney(total.netCents, total.currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {r.agrees ? (
        <p className="text-xs text-ink-500">
          {interpolate(a.tax.reconciles, {
            count: String(r.orderCount),
            invoices: String(r.invoiceCount),
          })}
        </p>
      ) : (
        <Alert tone="warning">
          {interpolate(a.tax.reconcileOff, {
            folded: String(r.foldedOrderCount),
            count: String(r.orderCount),
          })}
        </Alert>
      )}

      {r.refundedOrderCount > 0 ? (
        <p className="text-xs text-ink-500">
          {interpolate(a.tax.refundedNote, {
            count: String(r.refundedOrderCount),
          })}
        </p>
      ) : null}
    </Card>
  );
}
