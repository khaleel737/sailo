import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publishShopEvent } from "@sailo/events";
import { DELIVERY_METHOD_LIST } from "@sailo/commerce/delivery";
import {
  deleteDelivery,
  listDelivery,
  saveDelivery,
  toggleDelivery,
} from "@sailo/commerce/delivery-settings";
import { router, shopProcedure } from "../trpc";
import { byId } from "../shared";

/**
 * How an order gets to the buyer: postage rates and collection points.
 *
 * Every rule is `@sailo/commerce/delivery-settings`', and the one worth knowing
 * before touching this file is the zone refusal. An empty `countries` array
 * means "ships anywhere", so a seller who chooses "selected countries" and
 * ticks none of them cannot have that stored — it would mean the exact
 * opposite of what they asked for, and they would find out from an order they
 * could not fulfil. There is no value for "somewhere, but I have not said
 * where", so the save is refused instead.
 */

const deliveryInput = z.object({
  id: z.uuid().nullish(),
  type: z.string().max(40),
  name: z.string().trim().min(1).max(60),
  /** Minor units. The client parses its own locale — `12,50` is not `1250`. */
  feeCents: z.number().int().min(0),
  freeOverCents: z.number().int().min(0).nullish(),
  config: z.record(z.string().max(40), z.string().max(500)).default({}),
  isEnabled: z.boolean(),
  zone: z.enum(["anywhere", "selected"]).default("anywhere"),
  /*
   * Capped well above the 244 codes that exist. The cap is about the request
   * rather than about geography: this is an array from a client, and
   * `parseCountries` drops anything that is not a real code anyway.
   */
  countries: z.array(z.string().max(8)).max(300).default([]),
});

export const deliveryRouter = router({
  /**
   * The shop's options, plus the two kinds it could add.
   *
   * `types` ships with the list for the same reason `payments.rails` sends the
   * whole catalogue: a screen has to offer what the seller has *not* set up,
   * and a query over their rows only knows what they have.
   */
  list: shopProcedure.query(async ({ ctx }) => ({
    methods: await listDelivery(ctx.shopId),
    types: DELIVERY_METHOD_LIST,
  })),

  save: shopProcedure.input(deliveryInput).mutation(async ({ ctx, input }) => {
    const result = await saveDelivery({
      shopId: ctx.shopId,
      id: input.id ?? null,
      type: input.type,
      name: input.name,
      feeCents: input.feeCents,
      freeOverCents: input.freeOverCents ?? null,
      config: input.config,
      isEnabled: input.isEnabled,
      zone: input.zone,
      countries: input.countries,
    });

    if (!result.ok) {
      if (result.reason === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such delivery option." });
      }
      /* The reason, machine-readable. The wording belongs to whichever surface
         is drawing the screen — this one renders in thirty-five languages. */
      throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
    }

    /* The storefront caches its checkout options per shop, and a rate that
       changed has to reach a buyer mid-basket. */
    await publishShopEvent(ctx.shopId, "catalog");
    return { id: result.id, created: result.created };
  }),

  toggle: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const result = await toggleDelivery(ctx.shopId, input.id);

    if (result === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No such delivery option." });
    }
    if (result === "unconfigured") {
      /*
       * Refused rather than silently ignored, which is what the web action
       * does — it returns early and the toggle springs back with no
       * explanation. A collection point with no address is a checkout choice
       * that strands the buyer, and the seller deserves to be told why.
       */
      throw new TRPCError({ code: "BAD_REQUEST", message: "unconfigured" });
    }

    await publishShopEvent(ctx.shopId, "catalog");
    return { id: input.id, isEnabled: result.isEnabled };
  }),

  delete: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    if (!(await deleteDelivery(ctx.shopId, input.id))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No such delivery option." });
    }
    await publishShopEvent(ctx.shopId, "catalog");
    return { id: input.id };
  }),
});
