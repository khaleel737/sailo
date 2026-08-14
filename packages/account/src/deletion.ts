import "server-only";
import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { del } from "@vercel/blob";
import { getDb } from "@sailo/db";
import {
  account,
  affiliates,
  categories,
  clients,
  coupons,
  deliveryMethods,
  orders,
  paymentMethods,
  productFiles,
  productImages,
  productVariants,
  products,
  reviews,
  session as sessionTable,
  shops,
  supportTickets,
  user as userTable,
  visits,
} from "@sailo/db/schema";
import { stripe, billingEnabled } from "@sailo/payments";

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
 */

/* -------------------------------------------------------------------------- */
/*  The refusal                                                               */
/* -------------------------------------------------------------------------- */

export type Obligations = {
  blocked: boolean;
  /** How many paid-but-undelivered orders are standing in the way. */
  count: number;
};

/**
 * Paid orders the seller still owes something on.
 *
 * Deleting mid-obligation is seller fraud tooling: take the money, delete the
 * shop, and the buyer has an invoice and no goods. So an open paid order is a
 * hard refusal, not a warning — fulfil or refund first.
 *
 * "Open" is deliberately narrow. Only `new` and `confirmed` count: `shipped`
 * has left the building, `completed` is done, and `cancelled`/`refunded` are
 * settled in the buyer's favour. And only *paid* orders count — an unpaid
 * cash-on-delivery order that never happened must not trap someone in an
 * account forever.
 */
export async function openObligations(shopId: string): Promise<Obligations> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId),
        eq(orders.paymentStatus, "paid"),
        inArray(orders.status, ["new", "confirmed"]),
        or(
          // A booking whose time has not come yet — the buyer is expecting
          // someone to turn up.
          and(isNotNull(orders.scheduledFor), gt(orders.scheduledFor, new Date())),
          // A physical order that has not shipped.
          and(eq(orders.productKind, "physical"), isNull(orders.shippedAt)),
        ),
      ),
    );

  const count = rows[0]?.count ?? 0;
  return { blocked: count > 0, count };
}

/* -------------------------------------------------------------------------- */
/*  The tombstone                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A handle nobody will ever type, inside the rules `validateHandleFormat`
 * enforces: `HANDLE_MAX` is 32, and a trailing dash is rejected — so the
 * uuid's hyphens come out and the hex is cut to fit exactly.
 */
export function tombstoneHandle(shopId: string): string {
  return `deleted-${shopId.replace(/-/g, "").slice(0, 24)}`;
}

/** An address at a domain that can never receive mail. RFC 2606 reserves it. */
export function tombstoneEmail(userId: string): string {
  return `deleted-${userId}@sailo.invalid`;
}

/* -------------------------------------------------------------------------- */
/*  The deletion                                                              */
/* -------------------------------------------------------------------------- */

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

/**
 * Cancels the platform subscription and confirms it really is cancelled.
 *
 * Immediately, not at period end: the store is gone, so "keep it running
 * until the month is up" would mean charging for something that no longer
 * exists. A subscription Stripe has never heard of counts as cancelled —
 * that is what makes a retry after a mid-way crash finish rather than fail.
 */
async function cancelPlatformSubscription(subscriptionId: string | null): Promise<void> {
  if (!subscriptionId || !billingEnabled()) return;

  try {
    await stripe().subscriptions.cancel(subscriptionId);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return;
  }

  // Read it back rather than trust the call — the whole point of this step is
  // that nobody keeps being charged, and that deserves a confirmation.
  const confirmed = await stripe().subscriptions.retrieve(subscriptionId);
  if (confirmed.status !== "canceled") {
    throw new Error(
      `[sailo] subscription ${subscriptionId} is still ${confirmed.status} after cancel`,
    );
  }
}

/** Stripe's "this object is gone", which for a cancellation means success. */
function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "resource_missing"
  );
}

/** The host every Vercel Blob object is served from. */
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/**
 * Whether this stored URL names an object we could plausibly delete.
 *
 * Deliberately *not* the same question as `isStoredFileUrl` in
 * `apps/web/src/lib/file-urls.ts`, and not a copy of it. That one guards a
 * server-side fetch against SSRF and therefore has to be strict about which
 * store the URL belongs to; this one only decides what to hand `del()`, and
 * `del()` is already scoped to our own store by `BLOB_READ_WRITE_TOKEN` — it
 * cannot reach another account's objects however this answers.
 *
 * So the job here is narrower: skip the nulls, and skip the seeded demo
 * images on picsum and unsplash, which are not ours and would each cost a
 * failed API call on the way out.
 */
function isBlobUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Every blob this shop owns, split by what happens to it.
 *
 * `orderItems.imageUrl` deliberately is not collected: those rows are ledger
 * and survive, and their thumbnails are the same objects as the product
 * images. Removing them leaves past receipts with a broken image, which is
 * the accepted cost of not keeping a deleted seller's photographs forever.
 */
async function collectBlobUrls(
  shopId: string,
  avatarUrl: string | null,
  logoUrl: string | null,
): Promise<{ images: string[]; files: string[] }> {
  const db = getDb();

  const shopProducts = db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.shopId, shopId));

  const [images, variantImages, files] = await Promise.all([
    db
      .select({ url: productImages.url })
      .from(productImages)
      .where(inArray(productImages.productId, shopProducts)),
    db
      .select({ url: productVariants.imageUrl })
      .from(productVariants)
      .where(inArray(productVariants.productId, shopProducts)),
    db
      .select({ url: productFiles.url })
      .from(productFiles)
      .where(inArray(productFiles.productId, shopProducts)),
  ]);

  return {
    images: [
      ...images.map((r) => r.url),
      ...variantImages.map((r) => r.url),
      avatarUrl,
      logoUrl,
    ].filter(isBlobUrl),
    files: files.map((r) => r.url).filter(isBlobUrl),
  };
}

/** Best effort, one call, failures logged — never fails the deletion. */
async function deleteBlobs(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  try {
    await del(urls);
  } catch (error) {
    console.error(
      `[sailo] ${urls.length} blob(s) survived an account deletion`,
      error,
    );
  }
}

/**
 * Everything that is not the money record.
 *
 * Deleting `products` cascades to variants, images, files, reviews, booking
 * claims and visits, and sets `orders.productId` / `orderItems.productId` to
 * null — which loses nothing, because the order already snapshots the title,
 * variant label, SKU and price it sold at.
 *
 * `clients` are deliberately kept: buyers did not ask to be deleted, and the
 * order rows that document their purchases point at them.
 */
async function hardDeleteShopContent(shopId: string, userId: string): Promise<void> {
  const db = getDb();

  await db.delete(products).where(eq(products.shopId, shopId));
  await db.delete(categories).where(eq(categories.shopId, shopId));
  await db.delete(coupons).where(eq(coupons.shopId, shopId));
  await db.delete(affiliates).where(eq(affiliates.shopId, shopId));
  await db.delete(deliveryMethods).where(eq(deliveryMethods.shopId, shopId));
  /*
   * Payment methods hold the seller's own bank details — account number, IBAN,
   * SWIFT. Not in the spec's list, and deleted anyway: keeping a departed
   * seller's banking credentials in a table forever is not a defensible thing
   * to do with them.
   */
  await db.delete(paymentMethods).where(eq(paymentMethods.shopId, shopId));
  await db.delete(reviews).where(eq(reviews.shopId, shopId));
  await db.delete(visits).where(eq(visits.shopId, shopId));
  await db.delete(supportTickets).where(eq(supportTickets.shopId, shopId));

  // Auth rows: the password, any OAuth links, and the 2FA secret. `two_factor`
  // also cascades from `user`, but the user row survives here — so it has to
  // be said explicitly or an enrolled secret outlives the account.
  await db.delete(account).where(eq(account.userId, userId));
  await db.execute(sql`DELETE FROM "two_factor" WHERE "user_id" = ${userId}`);

  // Left standing on purpose: `orders`, `orderItems`, `invoices`, `tickets`
  // and `clients` — the ledger and the buyers it belongs to.
  void clients;
}
