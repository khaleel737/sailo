import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import {
  automationRuns,
  automations,
  checkoutSessions,
  orders,
} from "@sailo/db/schema";

/**
 * The four tiles spec 42 adds, and the rule that decides which four.
 *
 * **No tile whose source has not shipped.** An always-zero tile reads as a
 * broken product — a seller looking at "Recovered revenue: $0" cannot tell
 * "nobody came back" from "this does not work", and the second reading is the
 * one they act on. That is why these are sequenced after 30 and 32, and why
 * the fourth one the spec lists — free products redeemed, from spec 07's
 * `lead` kind — is **not here**: that kind is another wave's, and a tile over
 * a column that does not exist yet is the exact failure this rule names.
 *
 * Every query is bounded by the same window the rest of the dashboard uses and
 * respects the plan clamp its caller applies, because a tile that quietly
 * rendered twelve months on a Free plan would undo the clamp beside it.
 */

export type ExpansionTiles = {
  /** Checkouts opened in the window — spec 32's sessions. */
  checkoutSessions: number;
  /** Of those, how many were recovered by the follow-up. */
  recoveredOrders: number;
  /** What those recovered orders were actually worth. */
  recoveredCents: number;
  /** Contacts who entered a flow in the window — spec 30. */
  automationRuns: number;
  /** Of those, how many finished it. */
  automationCompleted: number;
};

/**
 * All four, in two statements.
 *
 * Two rather than one because they are two unrelated tables and a join between
 * them would be a cross product with nothing to join *on* — a session and a
 * flow run are both about a person, and that is not a key.
 */
export async function expansionTiles(
  shopId: string,
  since: Date,
): Promise<ExpansionTiles> {
  const db = getReadDb();

  const [sessions, runs] = await Promise.all([
    db
      .select({
        opened: sql<string>`count(*)`,
        recovered: sql<string>`count(*) filter (where ${checkoutSessions.status} = 'recovered')`,
        /*
         * Read from the **order**, not from the session's subtotal.
         *
         * The session records what the basket was worth when it was abandoned;
         * the order records what was actually paid — and a recovery discount
         * applied on the way back makes those different numbers. Reporting the
         * first as revenue would overstate every recovery by exactly the
         * discount that caused it, which is the most flattering possible way
         * to get this wrong.
         */
        recoveredCents: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${checkoutSessions.status} = 'recovered'), 0)`,
      })
      .from(checkoutSessions)
      .leftJoin(orders, eq(orders.id, checkoutSessions.orderId))
      .where(
        and(
          eq(checkoutSessions.shopId, shopId),
          gte(checkoutSessions.openedAt, since),
        ),
      ),

    db
      .select({
        entered: sql<string>`count(*)`,
        completed: sql<string>`count(*) filter (where ${automationRuns.status} = 'done')`,
      })
      .from(automationRuns)
      .innerJoin(automations, eq(automations.id, automationRuns.automationId))
      .where(
        and(
          eq(automationRuns.shopId, shopId),
          gte(automationRuns.enteredAt, since),
          /*
           * Flows only. A scenario (spec 31) shares this table and is a
           * different thing entirely — counting a seller's Zapier posts as
           * "automation runs" on a marketing dashboard would be a number that
           * moves for reasons the dashboard cannot explain.
           */
          eq(automations.kind, "email"),
        ),
      ),
  ]);

  return {
    checkoutSessions: Number(sessions[0]?.opened ?? 0),
    recoveredOrders: Number(sessions[0]?.recovered ?? 0),
    recoveredCents: Number(sessions[0]?.recoveredCents ?? 0),
    automationRuns: Number(runs[0]?.entered ?? 0),
    automationCompleted: Number(runs[0]?.completed ?? 0),
  };
}

/**
 * Whether a shop has anything to show in these tiles at all.
 *
 * The other half of "no tile reads zero because its source does not exist": a
 * shop that has never switched recovery on or built a flow is shown nothing
 * rather than four zeroes. Zero is a meaningful number *once a seller is using
 * the feature* — before that it is noise that makes the dashboard look broken.
 */
export async function hasExpansionSources(shopId: string): Promise<{
  sessions: boolean;
  automations: boolean;
}> {
  const db = getReadDb();
  const [session, flow] = await Promise.all([
    db.query.checkoutSessions.findFirst({
      where: eq(checkoutSessions.shopId, shopId),
      columns: { id: true },
    }),
    db.query.automations.findFirst({
      where: and(eq(automations.shopId, shopId), eq(automations.kind, "email")),
      columns: { id: true },
    }),
  ]);
  return { sessions: Boolean(session), automations: Boolean(flow) };
}
