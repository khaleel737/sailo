import { NextResponse } from "next/server";
import { requireShop } from "@/lib/session";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { csvResponse } from "@/lib/csv";
import { rateLimit } from "@sailo/rate-limit";
import {
  calendarYearWindow,
  taxReport,
  taxReportCsv,
} from "@sailo/commerce/tax/server";

/**
 * The tax report as a file.
 *
 * Its own route rather than another `/api/export/[type]`, because every other
 * export is "this shop's whole X" and this one is a period — the two dates are
 * the point of the thing, and threading them through a signature built for
 * `(type, shopId, currency)` would bend that shape for one caller.
 */
export async function GET(request: Request) {
  // Redirects when signed out, so this is never publicly reachable.
  const { shop } = await requireShop("money:read");

  if (!can(shop, "csvExport")) {
    const plan = cheapestPlanWith("csvExport");
    return NextResponse.json(
      { error: `Exports are available on ${plan?.name ?? "a paid plan"}.` },
      { status: 402 },
    );
  }

  /*
   * Keyed per shop, like the other exports: a seller pulling four quarters in
   * a row is the normal case and must not be throttled by whoever shares their
   * office network. Fails open — a seller who cannot download their own
   * bookkeeping because a cache is down is worse than the traffic it stops.
   */
  const gate = await rateLimit(`tax-report:${shop.id}`, 20, 300);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many exports just now. Wait a moment and try again." },
      { status: 429 },
    );
  }

  const url = new URL(request.url);
  const year = calendarYearWindow(new Date());
  // Parsed, not trusted: both values reach a SQL `between`, and a date is one
  // of the few things a query string carries with an obvious wrong shape.
  const day = (key: string, fallback: Date) => {
    const raw = url.searchParams.get(key);
    return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T00:00:00.000Z`)
      : fallback;
  };

  const report = await taxReport({
    shopId: shop.id,
    from: day("from", year.from),
    to: day("to", year.to),
  });
  return csvResponse(`tax-${report.from}-to-${report.to}.csv`, taxReportCsv(report));
}
