import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { can } from "@sailo/core/plans";
import { publishShopEvent } from "@sailo/events";
import {
  deleteCoupon,
  listCoupons,
  saveCoupon,
  toggleCoupon,
} from "@sailo/commerce/coupons";
import { router, shopProcedure } from "../trpc";
import { byId, found } from "../shared";

/**
 * Discount codes, from the phone.
 *
 * Every rule lives in `@sailo/commerce/coupons` and is the same one the web
 * form runs — the percent ceiling above all, because a `percent` coupon over
 * 100% is a negative order total and nothing downstream refuses one.
 *
 * This file adds the two things that are genuinely the API's: the plan gate,
 * and turning a verdict into a `TRPCError`.
 */

/**
 * Coupons are a paid feature, and the gate is here rather than only on the
 * client.
 *
 * The screen should show a lock rather than letting a seller fill a form in
 * and be refused after the tap, so `billing.plan` tells it what to draw — but
 * a client-side check is a suggestion. `planFor` is asked rather than
 * `shop.plan` read, because it accounts for comped accounts and for a
 * subscription that has lapsed into `past_due`, neither of which the raw
 * column says.
 */
async function requireCoupons(shopId: string) {
  const shop = found(
    await getDb().query.shops.findFirst({ where: eq(shops.id, shopId) }),
    "shop",
  );
  if (!can(shop, "coupons")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      /* The machine-readable half. The wording belongs to whoever is drawing
         the screen — `products.save` established the convention. */
      message: "upgrade:coupons",
    });
  }
  return shop;
}

const couponInput = z.object({
  id: z.uuid().nullish(),
  code: z.string().min(1).max(40),
  discountType: z.enum(["percent", "fixed"]),
  /**
   * A whole percentage, or minor units. Not a string: the seller's keyboard is
   * the client's problem — `1.234,50` and `1,234.50` are the same price in two
   * locales — and by the time it reaches here it is a number or it is a bug.
   */
  value: z.number().positive(),
  minSubtotalCents: z.number().int().min(0).default(0),
  maxRedemptions: z.number().int().min(1).nullish(),
  expiresAt: z.coerce.date().nullish(),
  isActive: z.boolean().default(true),
});

export const couponsRouter = router({
  /**
   * The seller's codes, newest first.
   *
   * Unpaged deliberately. A shop with more discount codes than fit on a phone
   * screen has a different problem, and the row carries `timesRedeemed` so the
   * list can rank by what is actually being used rather than by age.
   */
  list: shopProcedure.query(async ({ ctx }) => {
    await requireCoupons(ctx.shopId);
    return listCoupons(ctx.shopId);
  }),

  save: shopProcedure.input(couponInput).mutation(async ({ ctx, input }) => {
    await requireCoupons(ctx.shopId);

    const result = await saveCoupon({
      shopId: ctx.shopId,
      id: input.id ?? null,
      code: input.code,
      discountType: input.discountType,
      value: input.value,
      minSubtotalCents: input.minSubtotalCents,
      maxRedemptions: input.maxRedemptions ?? null,
      expiresAt: input.expiresAt ?? null,
      isActive: input.isActive,
    });

    if (!result.ok) {
      /*
       * `not_found` is its own code because it means something different from
       * the rest: the other four are the seller's input being wrong, and this
       * one is an id that is not theirs — which `found()` answers the same way
       * everywhere else in this package, so a client cannot use the difference
       * to probe another shop's ids.
       */
      if (result.reason === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such coupon." });
      }
      throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
    }

    await publishShopEvent(ctx.shopId, "catalog");
    return { id: result.id, created: result.created };
  }),

  toggle: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    await requireCoupons(ctx.shopId);
    const isActive = await toggleCoupon(ctx.shopId, input.id);
    if (isActive === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No such coupon." });
    }
    await publishShopEvent(ctx.shopId, "catalog");
    return { id: input.id, isActive };
  }),

  delete: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    /*
     * Not gated. A seller whose plan lapsed still has to be able to *remove* a
     * code — locking them out of deleting a 50%-off coupon that is still live
     * on their storefront would be the entitlement check costing them money.
     */
    if (!(await deleteCoupon(ctx.shopId, input.id))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No such coupon." });
    }
    await publishShopEvent(ctx.shopId, "catalog");
    return { id: input.id };
  }),
});
