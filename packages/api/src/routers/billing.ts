import { count, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "@sailo/db";
import { products, shops } from "@sailo/db/schema";
import {
  analyticsLimit,
  planFor,
  productLimit,
  PLAN_IDS,
  type PlanId,
} from "@sailo/core/plans";
import { clientEnv } from "@sailo/env";
import { stripe } from "@sailo/payments";
import { resolveCustomerId } from "@sailo/payments/billing-customer";
import { router, shopProcedure } from "../trpc";
import { found } from "../shared";

/**
 * What this shop's plan lets it do, and the way to change it.
 *
 * WHY THE ENTITLEMENTS COME FROM THE SERVER
 *
 * Every screen that offers a paid feature has to know whether to draw a lock,
 * and the tempting shortcut is to read `shop.plan` off the row the app already
 * has. That column is wrong in two directions that matter: a comped account
 * carries `free` in `plan` and its real entitlements in `compPlan`, and a shop
 * whose card was declined keeps `pro` in `plan` while `subscriptionStatus` has
 * gone `past_due`. `planFor` is the function that reconciles those, and it is
 * the same one every server-side gate calls — so a screen drawing from this
 * cannot show a seller a feature the API will then refuse.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Upgrading. Stripe Checkout for a *platform* subscription needs a price id per
 * plan and interval out of the environment, a mismatch check against what the
 * pricing page showed, and a success redirect — and the App Store takes a cut
 * of anything a seller can buy inside an iOS app. The portal below is the
 * honest middle: a seller manages an existing subscription through Stripe's own
 * hosted page, and starting a new one stays on the web.
 */

/** Where Stripe sends the seller when they close the portal. */
function returnUrl(): string {
  const base = clientEnv.PUBLIC_APP_URL ?? "https://sailo.store";
  return `${base}/admin/settings/billing`;
}

export const billingRouter = router({
  /**
   * The plan, its limits, and how much of them this shop is using.
   *
   * Usage comes back with the entitlement because a limit without a count is
   * not actionable — "10 products" tells a seller nothing about whether their
   * next upload will be refused. `atLimit` is derived here rather than on the
   * client so the comparison cannot be made with the wrong one of the two.
   */
  plan: shopProcedure.query(async ({ ctx }) => {
    const db = getDb();

    const shop = found(
      await db.query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
      "shop",
    );

    const rows = await db
      .select({ total: count() })
      .from(products)
      .where(eq(products.shopId, ctx.shopId));

    const plan = planFor(shop);
    const limit = productLimit(shop);
    const used = Number(rows[0]?.total ?? 0);

    return {
      id: plan.id,
      name: plan.name,
      /*
       * The whole feature map, not a handful of booleans. Every screen that
       * draws a lock reads one of these, and shipping them together means a
       * new gated feature does not need a new procedure.
       */
      features: plan.features,
      limits: {
        products: limit,
        analyticsDays: analyticsLimit(shop),
      },
      usage: {
        products: used,
        /* `limit === null` is unlimited, which is not the same as zero — a
           comparison that got that backwards would tell a Business seller
           they were out of room. */
        atProductLimit: limit !== null && used >= limit,
      },
      subscription: {
        status: shop.subscriptionStatus,
        interval: shop.subscriptionInterval,
        currentPeriodEnd: shop.currentPeriodEnd,
        cancelAtPeriodEnd: shop.cancelAtPeriodEnd,
        /*
         * Whether this plan is a gift rather than a purchase. A comped seller
         * has entitlements and no subscription to manage, so the screen has to
         * know not to offer them a portal that would show an empty page.
         */
        comped: Boolean(shop.compPlan),
      },
      /** Every plan there is, so a comparison screen needs no second call. */
      plans: PLAN_IDS as readonly PlanId[],
    };
  }),

  /**
   * A link to Stripe's hosted billing page — card, invoices, cancellation.
   *
   * A mutation rather than a query, for the same reason `payments.connectLink`
   * is one: each call creates a single-use session that expires in minutes, so
   * caching it would hand the seller a dead link on their second tap.
   *
   * The stored customer id is resolved rather than trusted. It is a cache of
   * something that lives in Stripe and goes stale in ways nobody caused — an id
   * minted against test keys on a deployment now running live ones, a customer
   * deleted in the dashboard, a row restored from a backup. Handing a stale one
   * to Stripe fails with `resource_missing`, which is what "the billing button
   * does nothing" looked like from the outside.
   */
  portalLink: shopProcedure.mutation(async ({ ctx }) => {
    const shop = found(
      await getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
      "shop",
    );

    if (!shop.stripeCustomerId) {
      /*
       * Nothing to manage. Distinct from a stale id below only in what the
       * screen should say — "you are on the free plan" rather than "we could
       * not reach Stripe" — which is why the two are separate codes rather
       * than one generic failure.
       */
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "no_subscription" });
    }

    const customer = await resolveCustomerId(shop.stripeCustomerId);
    if (!customer) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "no_subscription" });
    }

    const session = await stripe().billingPortal.sessions.create({
      customer,
      return_url: returnUrl(),
    });

    return { url: session.url };
  }),
});
