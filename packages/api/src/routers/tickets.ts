import { z } from "zod";
import {
  addWalkUp,
  admitByTicket,
  admitOnce,
  undoAdmission,
  type Door,
} from "@sailo/commerce/door";
import { IDEMPOTENCY_WINDOW_SECONDS } from "@sailo/commerce/idempotency";
import { router, shopProcedure } from "../trpc";
import { byId } from "../shared";

/**
 * The door, from the seller's own phone.
 *
 * Every decision here — what a code means, whether a ticket may admit, what to
 * tell the other volunteers' screens — is `@sailo/commerce/door`'s, and is the
 * same code the web admin and the `/door/[token]` page call. This file does the
 * one thing neither of them can do for it: work out who is asking. That is a
 * session in apps/web and a bearer token on the volunteer page; here it is
 * `ctx.shopId`, which `shopProcedure` has already refused to leave null.
 *
 * A pass is deliberately not reachable from here. A door pass is a credential
 * this app hands to somebody who is *not* the seller, and every caller of these
 * procedures has already proved they are.
 */

/**
 * The seller in person, scoped to whichever event the screen is showing.
 *
 * `by` is null, which is what the door list renders as the owner rather than a
 * volunteer's name — the same value the web admin passes for the same reason.
 */
function ownerDoor(shopId: string, productId: string | null): Door {
  return { shopId, productId, by: null, passId: null };
}

/**
 * A key the client picks, and the server namespaces by shop.
 *
 * Opaque and bounded: A10 will mint one per queued scan — a uuid, or the
 * scan's own timestamp and code — and the server neither parses it nor trusts
 * it to be unique across shops, which is why it never becomes a cache key on
 * its own.
 */
const idempotencyKey = z.string().min(8).max(200);

export const ticketsRouter = router({
  /**
   * One scan.
   *
   * **The key buys the answer, not the safety.** A double admit at a venue door
   * is a real-world failure with an angry human attached, and what prevents it
   * is that the claim is a conditional UPDATE on `status = 'valid'` — a second
   * scan of the same wristband has never admitted anybody, key or no key. What
   * the key adds is that A10's offline queue, replaying a scan the venue's wifi
   * ate, gets back the `checked_in` it originally got instead of an
   * `already_used` that reads as a refusal to the volunteer holding the phone.
   *
   * `replayed` says which happened, so a scanner can show "already counted"
   * rather than flashing a second green tick at a guest who has walked off.
   *
   * The window is a day. Redis holds it, so an outage costs the nicer answer
   * and nothing else — see `@sailo/commerce/idempotency`.
   */
  admit: shopProcedure
    .input(
      z.object({
        code: z.string().min(1).max(200),
        /** Null admits against any event in the shop, as an owner may. */
        productId: z.uuid().nullish(),
        idempotencyKey,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const outcome = await admitOnce(
        ownerDoor(ctx.shopId, input.productId ?? null),
        { code: input.code, idempotencyKey: input.idempotencyKey },
      );
      return {
        ...outcome.result,
        replayed: outcome.replayed,
        /** So a client can say how long a replay stays answerable. */
        windowSeconds: IDEMPOTENCY_WINDOW_SECONDS,
      };
    }),

  /**
   * Admitting from the guest list, for somebody whose phone is dead.
   *
   * No idempotency key: this is a volunteer tapping a name they are looking
   * at, not a queued request being replayed, and a second tap on the same name
   * is a question rather than a duplicate.
   */
  admitByTicket: shopProcedure
    .input(byId.extend({ productId: z.uuid().nullish() }))
    .mutation(({ ctx, input }) =>
      admitByTicket(ownerDoor(ctx.shopId, input.productId ?? null), input.id),
    ),

  /**
   * Puts a ticket back, because the alternative is turning away the person it
   * belongs to. A mis-scan burns a real admission and the guest standing there
   * has no recourse without this.
   */
  undoAdmission: shopProcedure
    .input(byId)
    .mutation(({ ctx, input }) =>
      undoAdmission(ownerDoor(ctx.shopId, null), input.id),
    ),

  /**
   * Somebody who turned up without a ticket and is being let in anyway.
   *
   * `productId` is required rather than optional: a walk-up is minted against
   * an event, and there is no sensible shop-wide answer to "which door did
   * this person walk through".
   */
  addWalkUp: shopProcedure
    .input(
      z.object({
        productId: z.uuid(),
        name: z.string().min(1).max(120),
        email: z.string().max(200).nullish(),
        tier: z.string().max(80).nullish(),
      }),
    )
    .mutation(({ ctx, input }) =>
      addWalkUp(ownerDoor(ctx.shopId, input.productId), {
        name: input.name,
        email: input.email,
        tier: input.tier,
      }),
    ),
});
