import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { notificationPrefsSchema } from "@sailo/notifications/prefs";
import { deleteAccountFor } from "@sailo/account/deletion";
import { TRPCError } from "@trpc/server";
import { router, shopProcedure } from "../trpc";
import { found } from "../shared";

/**
 * The seller's own account rather than their shop: which emails they want,
 * and leaving.
 *
 * Both procedures are `shopProcedure` even though both act on rows keyed to
 * the *user*, and that is the shop-scoping rule applied one step further
 * rather than an exception to it — `ctx.shopId` came from the session, the
 * shop names its owner, and there is no input a caller could put someone
 * else's id into. Same property as every `eq(..., ctx.shopId)` elsewhere.
 */
export const accountRouter = router({
  /**
   * Which seller emails are switched on.
   *
   * Not the same thing as the push toggle on the same settings screen, and
   * they must not be merged into one row: `lib/push.ts` answers "will this
   * handset buzz", which is the OS's business and is per-device. This answers
   * "does Sailo email me when an order lands", which is per-account and
   * reaches them wherever they are.
   *
   * Absence of a key means ON. `{}` is "everything", which is why a shop that
   * has never opened this screen is subscribed to an event type added last
   * week without anyone running a backfill.
   */
  notificationPrefs: shopProcedure.query(async ({ ctx }) => {
    const shop = found(
      await getDb().query.shops.findFirst({
        where: eq(shops.id, ctx.shopId),
        columns: { notificationPrefs: true },
      }),
      "shop",
    );

    return shop.notificationPrefs ?? {};
  }),

  /**
   * Writing them back.
   *
   * Through `notificationPrefsSchema` and nothing else. It is a
   * `strictObject`, so a key it does not know is a refusal rather than a
   * value written into jsonb and ignored for ever — which matters here more
   * than it looks, because this column decides whether a human gets emailed
   * and is read by builds that will not exist when it is next read.
   *
   * A whole-object write, not a patch. The screen holds every switch, so it
   * always knows the complete answer, and a merge would make "turn this off"
   * and "this key was absent" indistinguishable at the point where absence
   * already means something.
   */
  setNotificationPrefs: shopProcedure
    .input(notificationPrefsSchema)
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(shops)
        .set({ notificationPrefs: input, updatedAt: new Date() })
        .where(eq(shops.id, ctx.shopId));

      return input;
    }),

  /**
   * Deleting the account, for real.
   *
   * An App Store hard requirement — Guideline 5.1.1(v) says an app that
   * offers account creation must offer account deletion — so this is not a
   * later phase, and it is not a "contact us" link either.
   *
   * The work is `@sailo/account/deletion`'s, which is the same code the admin
   * runs: the same refusal when there are paid orders still owed, the same
   * tombstone, the same orders and invoices left standing. Restating any of
   * that here would be a second answer to "what does deleting mean", and the
   * two would diverge on the first change.
   *
   * KNOWN OMISSION, and a real one. apps/web passes two effects this cannot:
   * the farewell email — the last message the account can ever receive, whose
   * catalogue is still inside apps/web pending `docs/mobile/A16-email-package.md`
   * — and the cache drop, which needs Next's request scope. So a deletion
   * started from the phone is identical in the database and silent in the
   * seller's inbox, and the old handle keeps serving a cached storefront until
   * its tag expires. Wiring A16's send seam into `DeletionEffects` closes the
   * first; the second is a caching lag, not a data difference.
   */
  delete: shopProcedure.mutation(async ({ ctx }) => {
    const shop = found(
      await getDb().query.shops.findFirst({
        where: eq(shops.id, ctx.shopId),
        columns: { userId: true },
      }),
      "shop",
    );

    const result = await deleteAccountFor(shop.userId, {
      /*
       * The closure record's fingerprint key, so a deletion started from the
       * phone leaves the same record as one started from the browser. This is
       * exactly the drift the package exists to prevent: two callers, one
       * deletion, and the one that forgot an effect writes a thinner row.
       */
      fingerprintKey: process.env.BETTER_AUTH_SECRET,
    });

    /*
     * The refusal, given back as an error rather than a value.
     *
     * `PRECONDITION_FAILED` and not `FORBIDDEN`: the seller is allowed to
     * delete their account, they just owe someone something first. The count
     * travels in the message because "you have 3 paid orders still to fulfil"
     * is actionable and "you can't do that" is not.
     */
    if (!result.ok && result.reason === "obligations") {
      /*
       * In the order the seller can act on them, matching apps/web. Orders are
       * theirs to fix today; a dispute resolves on the card network's clock; a
       * payout hold needs us.
       */
      const message =
        result.count > 0
          ? `Fulfil or refund ${result.count} paid ` +
            `${result.count === 1 ? "order" : "orders"} before deleting your account.`
          : result.openDisputes > 0
            ? `A buyer's bank is still deciding on ${result.openDisputes === 1 ? "a payment" : `${result.openDisputes} payments`} to your shop. ` +
              `Deleting now would erase the records needed to answer it.`
            : "Payouts from your shop are on hold. That has to be lifted before the account can be deleted.";

      throw new TRPCError({ code: "PRECONDITION_FAILED", message });
    }

    // No shop for this user. Same answer as every other missing row here.
    if (!result.ok) found(undefined, "account");

    return { deleted: true };
  }),
});
