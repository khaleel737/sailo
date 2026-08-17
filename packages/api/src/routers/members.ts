import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, products, shops, subscriptions } from "@sailo/db/schema";
import { can } from "@sailo/core/plans";
import { isManual } from "@sailo/commerce/memberships";
import { cancelSubscriptionAtPeriodEnd } from "@sailo/payments";
import { publishShopEvent } from "@sailo/events";
import { router, shopProcedure } from "../trpc";
import { byId, found } from "../shared";

/**
 * Who is subscribed, and stopping it.
 *
 * THE ASYMMETRY THAT IS THE WHOLE FEATURE
 *
 * A card membership is cancelled at Stripe; a manual one is cancelled here.
 * Stripe holds a card and will charge it again unless told not to, so telling
 * it is the only thing that actually stops the money — writing `canceled`
 * locally while Stripe kept billing is the worst outcome this feature can
 * produce, and it ends in a chargeback. A manual membership has nothing
 * charging anything: stopping it *is* the row, because the row is what the
 * renewal cron reads.
 *
 * `isManual` is asked rather than re-derived from `billingMode`, so the phone
 * and the web admin cannot disagree about which of the two a membership is.
 *
 * NEVER IMMEDIATELY
 *
 * Cancelling ends the subscription at the end of the period the member has
 * already paid for. Not as a kindness — ending it today would be taking money
 * for access we then withdrew.
 */

/** Memberships are a paid feature; the gate is on the server, not only the screen. */
async function requireMemberships(shopId: string) {
  const shop = found(
    await getDb().query.shops.findFirst({ where: eq(shops.id, shopId) }),
    "shop",
  );
  if (!can(shop, "memberships")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "upgrade:memberships" });
  }
  return shop;
}

const listInput = z
  .object({
    /**
     * Defaults to the ones that are actually paying. A members screen opened on
     * every membership that has ever lapsed buries the list the seller came
     * for — and `canceled` rows are kept forever, because a cancelled
     * subscription is a fact about a person, not a row to delete.
     */
    status: z.enum(["active", "canceled", "all"]).default("active"),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .optional();

export const membersRouter = router({
  /**
   * The shop's members, newest first, with who they are and what they bought.
   *
   * Both joins are left joins, because both columns are `set null` on delete: a
   * seller who deletes the product has not ended anybody's billing, and a
   * subscription row that vanished with it would leave a member being charged
   * by Stripe with nothing here to cancel or even name. So a membership can
   * outlive its product, and the list has to render that rather than drop it.
   */
  list: shopProcedure.input(listInput).query(async ({ ctx, input }) => {
    await requireMemberships(ctx.shopId);
    const status = input?.status ?? "active";

    return getDb()
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        billingMode: subscriptions.billingMode,
        interval: subscriptions.interval,
        priceCents: subscriptions.priceCents,
        currency: subscriptions.currency,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        trialEndsAt: subscriptions.trialEndsAt,
        startedAt: subscriptions.startedAt,
        memberName: clients.name,
        memberEmail: clients.email,
        productTitle: products.title,
      })
      .from(subscriptions)
      .leftJoin(clients, eq(clients.id, subscriptions.clientId))
      .leftJoin(products, eq(products.id, subscriptions.productId))
      .where(
        and(
          eq(subscriptions.shopId, ctx.shopId),
          status === "all"
            ? undefined
            : status === "active"
              ? eq(subscriptions.status, "active")
              : eq(subscriptions.status, "canceled"),
        ),
      )
      .orderBy(desc(subscriptions.startedAt))
      .limit(input?.limit ?? 50);
  }),

  get: shopProcedure.input(byId).query(async ({ ctx, input }) => {
    await requireMemberships(ctx.shopId);
    return found(
      await getDb().query.subscriptions.findFirst({
        where: and(eq(subscriptions.id, input.id), eq(subscriptions.shopId, ctx.shopId)),
      }),
      "membership",
    );
  }),

  /**
   * Stop a membership renewing.
   *
   * Stripe is told first and the row is written second, and the order is the
   * point: a row that said `cancelAtPeriodEnd` while Stripe kept billing is the
   * failure this feature exists to avoid.
   *
   * The local write still happens on the card path, where Stripe's webhook is
   * the authority. It is not redundant — the webhook can take a second, and a
   * seller who presses Cancel and sees nothing change presses it again. This
   * makes the screen honest immediately; if Stripe disagrees,
   * `customer.subscription.updated` corrects it within seconds.
   */
  cancel: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    await requireMemberships(ctx.shopId);

    const row = found(
      await getDb().query.subscriptions.findFirst({
        // Shop-scoped in the WHERE: a guessed id from another shop must not be
        // cancellable, and a 404-shaped answer is what it gets.
        where: and(eq(subscriptions.id, input.id), eq(subscriptions.shopId, ctx.shopId)),
      }),
      "membership",
    );

    if (!isManual(row)) {
      if (!row.stripeAccountId || !row.stripeSubscriptionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "not_connected" });
      }
      try {
        await cancelSubscriptionAtPeriodEnd({
          accountId: row.stripeAccountId,
          subscriptionId: row.stripeSubscriptionId,
        });
      } catch {
        /*
         * Nothing is written when Stripe refuses. A local `cancelAtPeriodEnd`
         * over a subscription Stripe is still billing is exactly the divergence
         * the ordering above exists to prevent, and a seller who sees the
         * cancel fail will try again — which is the correct outcome.
         */
        throw new TRPCError({ code: "BAD_GATEWAY", message: "stripe_refused" });
      }
    }

    await getDb()
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
      .where(and(eq(subscriptions.id, row.id), eq(subscriptions.shopId, ctx.shopId)));

    await publishShopEvent(ctx.shopId, "account");
    return { id: row.id, cancelAtPeriodEnd: true, currentPeriodEnd: row.currentPeriodEnd };
  }),
});
