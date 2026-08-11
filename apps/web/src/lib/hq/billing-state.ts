import { and, eq, isNotNull, isNull, ne, notInArray, or, type SQL } from "drizzle-orm";
import { shops } from "@/db/schema";
import type { BillingState } from "@/lib/hq-metrics";

/** Which shops count as paying, expressed once so every figure agrees. */

export const ENTITLED = ["active", "trialing", "past_due"];

/**
 * The SQL twin of `billingState()` in hq-metrics.
 *
 * Deliberately duplicated rather than filtered in JavaScript: the accounts list
 * is paginated, and a filter applied after the page is fetched would return
 * three rows on a page that promised twenty-five. The two must be changed
 * together — that is the cost of paging in the database.
 */
export function stateFilter(state: BillingState): SQL | undefined {
  const uncomped = isNull(shops.compPlan);
  const paid = and(uncomped, ne(shops.plan, "free"));

  switch (state) {
    case "comped":
      return isNotNull(shops.compPlan);
    case "free":
      return and(
        uncomped,
        or(eq(shops.plan, "free"), isNull(shops.subscriptionStatus)),
      );
    case "paying":
      return and(paid, eq(shops.subscriptionStatus, "active"));
    case "trialing":
      return and(paid, eq(shops.subscriptionStatus, "trialing"));
    case "past_due":
      return and(paid, eq(shops.subscriptionStatus, "past_due"));
    case "canceled":
      return and(
        paid,
        isNotNull(shops.subscriptionStatus),
        notInArray(shops.subscriptionStatus, ENTITLED),
      );
  }
}

/* -------------------------------------------------------------------------- */
/*  Overview                                                                   */
/* -------------------------------------------------------------------------- */
