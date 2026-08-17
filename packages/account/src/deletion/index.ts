/**

 * Deleting a seller's account without destroying the money record.
 *
 * A naive `DELETE FROM "user"` would run — `shops.userId` cascades from
 * `user`, and most of the catalogue cascades from `shops` — and it would be
 * wrong three ways: it would take the invoices with it (a per-shop sequence a
 * tax authority expects unbroken), leave the platform subscription billing a
 * store that no longer exists, and orphan every uploaded blob, since deleting
 * a row does not delete the object it points at.
 *
 * So the shape is: **anonymise the ledger, delete the rest.** The `shops` row
 * survives as the retention container — it is what `orders` and `invoices`
 * hang off, and it carries the invoice counter — but it is tombstoned:
 * unpublished, `deletedAt` set, handle released, seller PII overwritten.
 *
 * Every step is written to be idempotent, because the alternative to "a retry
 * finishes the job" is "a crash halfway leaves an account that is neither
 * deleted nor usable".
 *
 * Split out of the server action so a scenario test can drive it without
 * inventing a session. The action in `apps/web/src/lib/actions/account.ts` is
 * the part that authenticates; this is the part that does the work.
 *
 * It lives in a package because Apple requires an app that offers sign-up to
 * offer deletion (Guideline 5.1.1(v)), so the phone has to be able to run
 * *this* deletion rather than something that resembles it. Two implementations
 * of "anonymise the ledger, delete the rest" is the shape of a bug that leaves
 * a shop half-tombstoned depending on which device asked.
 *
 * Two of the original steps do not survive the move as imports, and are passed
 * in instead — see `DeletionEffects`.
 *
 * WHY THIS IS A FOLDER
 *
 * It was 476 lines doing six jobs, with its own banners naming three of them. Two
 * pieces in particular were pure functions no test could reach: `tombstoneHandle`,
 * which has to satisfy a handle validator declared in another package, and `isBlobUrl`,
 * a hostname guard sitting behind a database call. Both are exported from their own
 * module now and asserted directly.
 *
 *   ./obligations   the one thing that refuses a deletion
 *   ./tombstone     what replaces a seller's identity (pure)
 *   ./subscription  making sure a deleted store stops being charged
 *   ./blobs         the uploaded objects, which no row deletion touches
 *   ./content       everything that is not the money record
 *   ./index         the order of operations, which is the load-bearing part
 */

import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { session as sessionTable, shops, user as userTable } from "@sailo/db/schema";
import { openObligations } from "./obligations";
import { tombstoneEmail, tombstoneHandle } from "./tombstone";
import { cancelPlatformSubscription } from "./subscription";
import { collectBlobUrls, deleteBlobs } from "./blobs";
import { hardDeleteShopContent } from "./content";

export * from "./obligations";
export * from "./tombstone";
export * from "./blobs";

export type DeletionResult =
  | { ok: true }
  | { ok: false; reason: "obligations"; count: number }
  | { ok: false; reason: "not_found" };

/**
 * The two steps that could not travel into this package, handed in by the
 * caller that can do them.
 *
 * Both are optional, and both being absent still performs a complete, correct
 * deletion — that is the test for whether something belongs here rather than
 * inside the function. What is lost when one is absent is stated on it, so a
 * caller that omits one is omitting something it can read about.
 */
export type DeletionEffects = {
  /**
   * The last email this account can ever receive, sent while there is still an
   * address to send it to.
   *
   * Injected rather than imported because the transactional mail catalogue is
   * 3,267 lines inside `apps/web` and is being lifted separately — see
   * `docs/mobile/A16-email-package.md`. apps/web passes `sendAccountDeleted`
   * and behaves exactly as it did. `packages/api` cannot, so **a deletion
   * started from the phone sends no farewell email today.** That is a known
   * omission with a named owner, not a decision: wire A16's seam here and the
   * two paths converge again.
   */
  notifyDeleted?: (seller: {
    to: string;
    name?: string | null;
    shopName: string;
  }) => Promise<{ sent: boolean; reason?: string }>;
  /**
   * Drop the caches keyed on this shop and its old handle.
   *
   * Next's `updateTag` only exists inside a request scope, which is not a
   * thing off-server, so this is the same seam `@sailo/commerce` uses for
   * `revalidatePath`. Omitting it costs nothing correctness-wise — the tags
   * expire on their own — but the old handle keeps resolving to a cached
   * storefront until they do.
   */
  dropCaches?: (shopId: string, handle: string) => Promise<void> | void;
};

/**
 * Runs the deletion for one user and their shop.
 *
 * The order of operations is the load-bearing part, and each step is placed
 * where a crash after it is survivable:
 *
 *  1. refuse if there are open obligations — before anything is touched;
 *  2. cancel the Stripe subscription, verified by re-reading it;
 *  3. email the seller *while we can still reach them*;
 *  4. collect the blob URLs, before the rows naming them are gone;
 *  5. tombstone the seller and the shop;
 *  6. hard-delete everything that is not the ledger;
 *  7. delete the blobs;
 *  8. revoke every session — the actor's own included, so this is last.
 */
export async function deleteAccountFor(
  userId: string,
  effects: DeletionEffects = {},
): Promise<DeletionResult> {
  const db = getDb();

  const shop = await db.query.shops.findFirst({
    where: eq(shops.userId, userId),
  });
  if (!shop) return { ok: false, reason: "not_found" };

  const obligations = await openObligations(shop.id);
  if (obligations.blocked) {
    return { ok: false, reason: "obligations", count: obligations.count };
  }

  const owner = await db.query.user.findFirst({
    where: eq(userTable.id, userId),
    columns: { id: true, name: true, email: true },
  });

  /* 1 — Stripe. Before the rows go, so a failure here is a failure of a
   * deletion that has not started rather than one that cannot finish. */
  await cancelPlatformSubscription(shop.stripeSubscriptionId);

  /* 2 — The last email this account can ever receive. Sent before the address
   * is overwritten, because afterwards there is no way to reach them at all,
   * and a deletion nobody asked for needs somewhere to be reported. */
  const alreadyTombstoned = shop.deletedAt !== null;
  if (
    effects.notifyDeleted &&
    owner &&
    !alreadyTombstoned &&
    !owner.email.endsWith("@sailo.invalid")
  ) {
    const sent = await effects.notifyDeleted({
      to: owner.email,
      name: owner.name,
      shopName: shop.name,
    });
    if (!sent.sent) {
      // Never a reason to abandon the deletion — they asked for it, and a mail
      // provider having a bad afternoon is not their problem.
      console.warn(`[sailo] account deletion email not sent: ${sent.reason}`);
    }
  }

  /* 3 — Every blob this shop owns, named before the rows naming them go. */
  const blobs = await collectBlobUrls(shop.id, shop.avatarUrl, shop.logoUrl);

  /* 4 — Tombstone. The shop row stays: it is the FK home of every order and
   * invoice, and it carries the invoice sequence. */
  const oldHandle = shop.handle;
  await db
    .update(shops)
    .set({
      handle: tombstoneHandle(shop.id),
      name: "Deleted shop",
      description: null,
      avatarUrl: null,
      logoUrl: null,
      contactEmail: null,
      location: null,
      socials: [],
      isPublished: false,
      deletedAt: shop.deletedAt ?? new Date(),
      // Nothing may keep billing or charging against a deleted store.
      stripeSubscriptionId: null,
      subscriptionStatus: null,
      subscriptionInterval: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      plan: "free",
      /*
       * The Connect account belongs to the seller, not to us — deactivating it
       * would be reaching into their Stripe. Disconnecting is all that is ours
       * to do, and it is what takes the card rail off the storefront.
       */
      stripeAccountId: null,
      stripeChargesEnabled: false,
      stripeDetailsSubmitted: false,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  if (owner) {
    await db
      .update(userTable)
      .set({
        name: "Deleted user",
        email: tombstoneEmail(owner.id),
        emailVerified: false,
        image: null,
        twoFactorEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(userTable.id, owner.id));
  }

  /* 5 — Everything that is not the ledger. */
  await hardDeleteShopContent(shop.id, userId);

  /* 6 — The objects themselves. Best effort: a blob we fail to delete is a
   * bill, not a breach, and it must not strand the deletion. */
  await deleteBlobs(blobs.images);

  /*
   * Product files are kept for 90 days rather than deleted with the images.
   * A buyer who paid for a download still has a live token, and taking the
   * file away the moment the seller leaves punishes the wrong person.
   *
   * TODO(sweep): delete blobs for shops whose `deletedAt` is over 90 days old
   * from `/api/cron/sweep`, which already runs hourly and is the home for
   * exactly this kind of idempotent housekeeping. Until that lands the files
   * persist — which is the safe direction to be wrong in.
   */

  /* 7 — Sessions last: this is where the actor signs themselves out. */
  await db.delete(sessionTable).where(eq(sessionTable.userId, userId));

  // The storefront caches by handle, and the old handle must stop resolving
  // now rather than whenever the tag happens to expire.
  await effects.dropCaches?.(shop.id, oldHandle);

  return { ok: true };
}
