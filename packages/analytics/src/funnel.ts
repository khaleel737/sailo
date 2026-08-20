import { and, eq, ne, sql } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import { checkoutSessions, orders, visits } from "@sailo/db/schema";
import { inWindow, windowBounds } from "./bounds";
import type { Window } from "./bounds";

/**
 * The storefront's three honest stages: who came, who reached a checkout,
 * who completed one.
 *
 * Three and not Shopify's four, deliberately: "added to cart" is not an event
 * this pipeline records — the clicks table is outbound-link vocabulary and
 * bending it would poison both reports. When a cart event exists it becomes
 * stage two; until then a stage the data cannot back does not render, because
 * a funnel with an invented middle reads as measurement and is fiction.
 */
export type ConversionFunnel = {
  /** Distinct sessions on the storefront in the window. */
  sessions: number;
  /** Checkout sessions opened in the window — spec 32's ledger. */
  reachedCheckout: number;
  /** Orders placed in the window, cancellations excluded. */
  completed: number;
  /** completed / sessions, or null when nobody came. */
  conversion: number | null;
};

export async function getConversionFunnel(
  shopId: string,
  window: Window = 30,
): Promise<ConversionFunnel> {
  const db = getReadDb();
  const { since, until } = windowBounds(window);

  const [[visitRow], [checkoutRow], [orderRow]] = await Promise.all([
    db
      .select({ n: sql<string>`count(distinct ${visits.sessionId})` })
      .from(visits)
      .where(and(eq(visits.shopId, shopId), inWindow(visits.createdAt, since, until))),
    db
      .select({ n: sql<string>`count(*)` })
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.shopId, shopId),
          inWindow(checkoutSessions.openedAt, since, until),
        ),
      ),
    db
      .select({ n: sql<string>`count(*)` })
      .from(orders)
      .where(
        and(
          eq(orders.shopId, shopId),
          ne(orders.status, "cancelled"),
          inWindow(orders.createdAt, since, until),
        ),
      ),
  ]);

  const sessions = Number(visitRow?.n ?? 0);
  const completed = Number(orderRow?.n ?? 0);
  return {
    sessions,
    reachedCheckout: Number(checkoutRow?.n ?? 0),
    completed,
    /*
     * Capped at 1. `sessions` is client-recorded and ad-block suppressed,
     * while checkouts and orders are server-recorded — a shop whose visitors
     * block analytics can genuinely record more orders than sessions, and
     * "conversion over 100%" is a measurement artefact, not a rate.
     */
    conversion: sessions > 0 ? Math.min(completed / sessions, 1) : null,
  };
}
