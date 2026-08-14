import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { can } from "@sailo/core/plans";
import { clientEnv } from "@sailo/env";
import { connectOnboardingLink } from "@sailo/payments";
import { router, shopProcedure } from "../trpc";
import { found } from "../shared";

/**
 * Getting the seller paid.
 *
 * One procedure today, and it is the one the app cannot ship without: a seller
 * who cannot connect Stripe from their phone has to go and find a laptop
 * before their first card sale.
 */

/**
 * Where Stripe sends the seller when it is finished with them.
 *
 * `sailo://` and not an https URL, and this is the entire point of the step.
 * The app opens the account link with `WebBrowser.openAuthSessionAsync`, which
 * watches for a redirect to this scheme and **dismisses its own sheet** when it
 * sees one. Point these at the website instead and the seller finishes
 * onboarding inside a browser that has no way back — which is exactly what
 * Stan's app does, right down to telling the user to "please click close in
 * the top left corner to get back to the app".
 *
 * Two different paths rather than one. `return` is the seller having finished
 * or given up; `refresh` is Stripe saying the link is stale and the flow has
 * to be started again. Both dismiss the sheet, and only the app can tell them
 * apart — so the second one asks for a new link and opens it, rather than
 * dropping the seller on a screen that still says "not connected" with no
 * explanation. `apps/web/src/lib/auth.ts` already trusts `sailo://`.
 */
const CONNECT_RETURN_URL = "sailo://connect/return";
const CONNECT_REFRESH_URL = "sailo://connect/refresh";

/**
 * This deployment's public address, for the storefront URL Stripe is told
 * about. Absent in a local checkout, where `publicShopUrl` will refuse it
 * anyway — Stripe rejects a business URL it cannot reach.
 */
function siteUrl(): string {
  return clientEnv.PUBLIC_APP_URL ?? "http://localhost:3000";
}

export const paymentsRouter = router({
  /**
   * A fresh Stripe onboarding link for the "get paid" step, creating the
   * seller's connected account on the way if they have none.
   *
   * A mutation, not a query: the first call to this creates a Stripe account
   * and writes its id onto the shop. Account links are single-use and expire
   * in minutes, so the app asks for one per tap rather than caching it.
   *
   * Gated on the plan, exactly as the web action is. Without this a seller on
   * the free tier could open a Connect account from the phone that the
   * storefront would then refuse to offer — `getCheckoutMethods` checks the
   * same entitlement where buyers read it — leaving them with a Stripe
   * account, a completed onboarding, and no card button.
   */
  connectLink: shopProcedure.mutation(async ({ ctx }) => {
    const shop = found(
      await getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
      "shop",
    );

    if (!can(shop, "cardRails")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Card payments are a Business feature.",
      });
    }

    const url = await connectOnboardingLink(shop, {
      siteUrl: siteUrl(),
      returnUrl: CONNECT_RETURN_URL,
      refreshUrl: CONNECT_REFRESH_URL,
    });

    return { url };
  }),
});
