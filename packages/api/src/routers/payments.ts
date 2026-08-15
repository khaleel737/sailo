import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { can } from "@sailo/core/plans";
import { clientEnv } from "@sailo/env";
import { publishShopEvent } from "@sailo/events";
import { connectOnboardingLink } from "@sailo/payments";
import { listRails, saveRail } from "@sailo/payments/rail-settings";
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

  /**
   * Every way this shop could take money, and which of them actually work.
   *
   * The full catalogue rather than the rows that exist — a settings screen has
   * to show a seller the rails they have *not* turned on, and the table only
   * knows about the ones they have. `listRails` merges the two.
   *
   * Three separate booleans come back per rail and none of them is redundant:
   * `configured` is "you have filled this in", `available` is "this can settle
   * your currency at all", `usable` is "a buyer could tap it right now". A
   * seller who set Venmo up in dollars and then priced their shop in euros has
   * a rail that is configured, unavailable and unusable, and a screen that
   * collapsed those into one flag could only tell them to check their settings.
   */
  rails: shopProcedure.query(async ({ ctx }) => {
    const shop = found(
      await getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
      "shop",
    );

    return {
      rails: await listRails(shop),
      /*
       * The card rail is entitlement-gated where the others are not, and the
       * screen has to say which — a toggle that refuses with "upgrade" after
       * the tap is worse than one that shows a lock before it. Read here rather
       * than derived on the client, because `planFor` accounts for comped and
       * past-due accounts that `shop.plan` alone does not.
       */
      cardAllowed: can(shop, "cardRails"),
      currency: shop.currency,
      stripe: {
        connected: Boolean(shop.stripeAccountId),
        chargesEnabled: shop.stripeChargesEnabled,
        detailsSubmitted: shop.stripeDetailsSubmitted,
      },
    };
  }),

  /**
   * Turn one rail on or off, and save what it needs to work.
   *
   * The refusal is the reason this is not a bare update. `saveRail` will not
   * enable a rail whose required fields are blank, because a half-configured
   * option puts a button on the storefront that takes a buyer somewhere broken
   * — and the seller cannot see it, since their own screen shows the toggle as
   * on. The same function answers the web form.
   *
   * `config` is `Record<string, string>` rather than a schema per rail: the
   * fields are defined in `@sailo/payments/rails`, twenty-odd rails' worth, and
   * a zod union restating them here would be a second definition to keep in
   * step. `saveRail` rebuilds the object from the rail's own field list and
   * drops anything else, so an unknown key is discarded rather than stored.
   */
  saveRail: shopProcedure
    .input(
      z.object({
        type: z.string().max(40),
        config: z.record(z.string().max(40), z.string().max(500)).default({}),
        isEnabled: z.boolean(),
        label: z.string().max(60).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await saveRail({
        shopId: ctx.shopId,
        type: input.type,
        config: input.config,
        isEnabled: input.isEnabled,
        label: input.label ?? null,
      });

      if (!result.ok) {
        if (result.reason === "unknown") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown payment method." });
        }
        /*
         * The blank fields, as keys, in `message`. The same arrangement
         * `products.save` uses for its refusals and for the same reason: the
         * server knows *which* fields are missing and the phone knows what they
         * are called in the seller's language, so the wording is the client's
         * and the fact is the server's.
         */
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `unconfigured:${result.missing.join(",")}`,
        });
      }

      /* Every other screen looking at this shop — the seller's own browser, the
         staff panel. Awaited: there is no `after` outside Next's request scope. */
      await publishShopEvent(ctx.shopId, "account");
      return { type: result.type };
    }),
});
