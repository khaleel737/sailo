import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  products,
  subscriptions,
  user,
  type Shop,
  type Subscription,
} from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import { wantsNotification } from "@sailo/notifications/prefs";
import type { NotificationEvent } from "@sailo/notifications/prefs";
import {
  sendSellerMembershipCancelled,
  sendSellerMembershipPaymentFailed,
  sendSellerMembershipStarted,
} from "@sailo/email/shop";

/**
 * Telling the seller what happened to a membership.
 *
 * The recurring half of `../orders/notify-seller.ts`, and it exists because
 * that file had no counterpart. Sailo has billed memberships for as long as it
 * has taken orders: a one-off £9 sale mailed the seller, and a £9/month member
 * worth twelve times as much could join, cancel, or fail a renewal in complete
 * silence. The only trace was a row changing colour in a list nobody keeps open.
 *
 * Same contract as the order half, deliberately: prefs and the daily ceiling
 * decide whether anything is sent, the builders decide only what it says, and
 * nothing throws — by the time this runs Stripe has already moved the money and
 * a mail provider having a bad afternoon must not fail the webhook that
 * recorded it.
 *
 * The ceiling is shared with order mail rather than given its own key, and that
 * is the point of reusing the string: a shop's total outbound seller mail is
 * what the limit is protecting, and two ceilings of five hundred is a ceiling
 * of a thousand.
 */

const DAILY_CEILING = 500;

const ceilingLogged = new Set<string>();

async function underDailyCeiling(shopId: string): Promise<boolean> {
  // The same key the order notifier uses — see the note above.
  const verdict = await rateLimit(`seller-mail:${shopId}`, DAILY_CEILING, 86_400);
  if (!verdict.allowed && !ceilingLogged.has(shopId)) {
    ceilingLogged.add(shopId);
    console.error(
      `[sailo] seller notification ceiling hit for shop ${shopId} — ` +
        `suppressing further seller mail today`,
    );
  }
  return verdict.allowed;
}

/**
 * `notificationEmail` first, then `contactEmail`, then the account address.
 *
 * Three steps rather than the order notifier's two, because this is the
 * fallback chain the new setting introduces: a seller who routes alerts to
 * `ops@` while buyers still write to `hello@` has said which is which, and
 * ignoring that here would send half their notifications to the wrong inbox.
 *
 * The web app's own copy of this lives in `sellerAddress` in the order
 * notifier; both read the same three fields in the same order, and
 * `notify-seller.test.ts` pins it.
 */
async function sellerAddress(shop: Shop): Promise<string | null> {
  if (shop.notificationEmail) return shop.notificationEmail;
  if (shop.contactEmail) return shop.contactEmail;
  const owner = await getDb().query.user.findFirst({
    where: eq(user.id, shop.userId),
    columns: { email: true },
  });
  return owner?.email ?? null;
}

/**
 * The member and the plan, as the mail names them.
 *
 * `productTitle` falls back to a generic phrase rather than to an empty string:
 * a subscription whose product was deleted still bills somebody, and a subject
 * line reading "New member — " is worse than one that admits it does not know
 * which plan.
 */
async function describe(row: Subscription) {
  const db = getDb();

  const client = row.clientId
    ? await db.query.clients.findFirst({ where: eq(clients.id, row.clientId) })
    : undefined;
  const product = row.productId
    ? await db.query.products.findFirst({ where: eq(products.id, row.productId) })
    : undefined;

  return {
    memberName: client?.name ?? null,
    memberEmail: client?.email ?? null,
    productTitle: product?.title ?? "a membership",
    priceCents: row.priceCents,
    currency: row.currency,
    interval: row.interval,
  };
}

/**
 * The shared preamble: is this wanted, is there room, and where does it go.
 *
 * Returns null when the answer is "send nothing", so each of the three public
 * functions below is a builder call and no policy of its own. Three copies of
 * this sequence is how one of them ends up ignoring the seller's switch.
 */
async function recipient(
  shop: Shop,
  event: NotificationEvent,
): Promise<string | null> {
  if (!wantsNotification(shop.notificationPrefs, event)) return null;
  if (!(await underDailyCeiling(shop.id))) return null;
  return sellerAddress(shop);
}

/** Reads the row back, so the mail describes what was actually stored. */
async function load(
  shopId: string,
  subscriptionId: string,
): Promise<Subscription | null> {
  const row = await getDb().query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
  // Ownership checked here rather than assumed: this is addressed by id from a
  // webhook handler, and a mismatch would describe one shop's member to another.
  return row && row.shopId === shopId ? row : null;
}

/** Somebody started paying. */
export async function notifySellerMembershipStarted(opts: {
  shop: Shop;
  subscriptionId: string;
}): Promise<void> {
  try {
    const to = await recipient(opts.shop, "membershipStarted");
    if (!to) return;

    const row = await load(opts.shop.id, opts.subscriptionId);
    if (!row) return;

    const result = await sendSellerMembershipStarted({
      shop: opts.shop,
      to,
      ...(await describe(row)),
      trialEndsAt: row.trialEndsAt,
    });
    if (!result.sent) {
      console.warn(`[sailo] seller membership email not sent: ${result.reason}`);
    }
  } catch (error) {
    console.error("[sailo] seller membership notification failed", error);
  }
}

/**
 * Somebody asked to stop, or their membership ran out.
 *
 * `ended` is the difference between the two, and it decides the whole message.
 * A cancellation still has a paid-through date and nothing for the seller to
 * do; an ending does not. Passing it rather than re-deriving it from the row is
 * deliberate — the caller knows which Stripe event it is holding, and
 * `cancelAtPeriodEnd` has already been cleared by the time a delete lands.
 */
export async function notifySellerMembershipCancelled(opts: {
  shop: Shop;
  subscriptionId: string;
  ended: boolean;
}): Promise<void> {
  try {
    const to = await recipient(opts.shop, "membershipCancelled");
    if (!to) return;

    const row = await load(opts.shop.id, opts.subscriptionId);
    if (!row) return;

    const result = await sendSellerMembershipCancelled({
      shop: opts.shop,
      to,
      ...(await describe(row)),
      endsAt: opts.ended ? null : row.currentPeriodEnd,
    });
    if (!result.sent) {
      console.warn(`[sailo] seller membership email not sent: ${result.reason}`);
    }
  } catch (error) {
    console.error("[sailo] seller membership notification failed", error);
  }
}

/** A renewal failed — the urgent one, and the reason this file exists. */
export async function notifySellerMembershipPaymentFailed(opts: {
  shop: Shop;
  subscriptionId: string;
}): Promise<void> {
  try {
    const to = await recipient(opts.shop, "membershipPaymentFailed");
    if (!to) return;

    const row = await load(opts.shop.id, opts.subscriptionId);
    if (!row) return;

    const result = await sendSellerMembershipPaymentFailed({
      shop: opts.shop,
      to,
      ...(await describe(row)),
      until: row.currentPeriodEnd,
    });
    if (!result.sent) {
      console.warn(`[sailo] seller membership email not sent: ${result.reason}`);
    }
  } catch (error) {
    console.error("[sailo] seller membership notification failed", error);
  }
}
