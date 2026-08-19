import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { rollUpTaxRevenue, runTaxMonitor } from "@sailo/commerce/tax/server";

/**
 * The nightly tax pass: fold paid orders per place per day, then compare each
 * place to its published threshold and mail the seller at 70% and 90%.
 *
 * Two steps in one route because the second reads what the first writes, and
 * splitting them across two schedules would mean a monitor that sometimes runs
 * against yesterday's fold — warning a seller at 68% on a day they crossed 71%.
 *
 * Signed with `CRON_SECRET` like every scheduled route. Without it this is an
 * endpoint anyone can use to make the fleet re-fold a hundred and twenty days
 * of orders on demand.
 */
export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const started = Date.now();
  const fold = await rollUpTaxRevenue();
  const monitor = await runTaxMonitor();

  return NextResponse.json({ fold, monitor, ms: Date.now() - started });
}

// A fleet's worth of days, and then a threshold pass per shop that sold.
export const maxDuration = 300;
