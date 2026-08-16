import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, shops } from "@sailo/db/schema";

/**
 * Resolving an event to the row it is allowed to touch.
 *
 * The security seam of the whole webhook path. A connected account is
 * controlled by a seller, and a seller is not a trusted party — so every
 * lookup here scopes to the account that actually sent the event, using the
 * account recorded on the order rather than the one on the shop row, which a
 * seller can change.
 */

export async function shopIdFor(opts: {
  shopId?: string | null;
  customerId?: string | null;
}) {
  const db = getDb();
  if (opts.shopId) {
    const byId = await db.query.shops.findFirst({
      where: eq(shops.id, opts.shopId),
      columns: { id: true },
    });
    if (byId) return byId.id;
  }
  if (opts.customerId) {
    const byCustomer = await db.query.shops.findFirst({
      where: eq(shops.stripeCustomerId, opts.customerId),
      columns: { id: true },
    });
    if (byCustomer) return byCustomer.id;
  }
  return null;
}


/**
 * The account an event arrived on.
 *
 * Stripe omits `account` for events on the platform's own account, and that
 * account is a real seller here: `actingAs` in `lib/connect.ts` deliberately
 * drops the `stripeAccount` header when a shop is wired to the platform's own
 * account, so its charges are created — and its events delivered — with no
 * account named. Resolving null to the platform id keeps that one shop subject
 * to the same ownership rule as every other, rather than exempt from it.
 */
export function sendingAccount(accountId: string | null): string | null {
  return accountId ?? process.env.STRIPE_PLATFORM_ACCOUNT_ID ?? null;
}

/**
 * Whether an event from `sender` may act on an order owned by `owner`.
 *
 * Unknown on either side denies. A shop with no connected account has no
 * charges for an event to be about, and a sender we cannot identify has proved
 * nothing — neither is a reason to fall through to "allow".
 */
export function sameAccount(owner: string | null, sender: string | null): boolean {
  return Boolean(owner && sender && owner === sender);
}

/** A charge's, dispute's or session's payment intent, expanded or not. */
export function intentIdOf(
  intent: string | { id: string } | null | undefined,
): string | null {
  if (!intent) return null;
  return typeof intent === "string" ? intent : intent.id;
}

/**
 * Narrows an order to the account the event arrived on, or to nothing.
 *
 * Every seller on Sailo controls their own Stripe account, so an event naming
 * an order is not evidence that the order's seller sent it.
 */
export async function ownedBySender<T extends { shopId: string; stripeAccountId?: string | null }>(
  order: T | undefined,
  accountId: string | null,
): Promise<T | null> {
  if (!order) return null;

  /*
   * The account the charge was actually made on, when the order recorded one.
   *
   * `orders.stripeAccountId` is written at handoff and never changes, which is
   * what makes it the right authority. Resolving ownership through the live
   * `shops` row instead meant that disconnecting Stripe — or Stripe
   * deauthorizing the account — detached every historical order from its own
   * webhooks: a chargeback on last month's sale arrived on the old account,
   * failed to match the shop's new (or null) one, and was dropped. The order
   * kept reading as a completed sale while the money had already left.
   *
   * The shop is still the fallback for orders written before that column was
   * populated, and for rails that never touch Connect.
   */
  const owner =
    order.stripeAccountId ??
    (
      await getDb().query.shops.findFirst({
        where: eq(shops.id, order.shopId),
        columns: { stripeAccountId: true },
      })
    )?.stripeAccountId ??
    null;

  return sameAccount(owner, sendingAccount(accountId)) ? order : null;
}

/**
 * The order behind a payment intent, scoped to the sending account.
 *
 * The only route from a charge or a dispute to an order. `charge.refunded`
 * used to look the intent up itself and skip the scoping every sibling
 * handler applies, which let a seller mark another shop's order refunded — and
 * clear its own chargeback — from their own connected account. A test asserts
 * this stays the only place `stripePaymentIntentId` is searched on.
 */
export async function orderForIntent(
  intent: string | { id: string } | null | undefined,
  accountId: string | null,
) {
  const intentId = intentIdOf(intent);
  if (!intentId) return null;

  const order = await getDb().query.orders.findFirst({
    where: eq(orders.stripePaymentIntentId, intentId),
  });
  return ownedBySender(order, accountId);
}

/**
 * The order a completed session belongs to — and only if it really belongs to
 * the account that sent the event.
 *
 * The session id is ours: we wrote it when we created the session, and Stripe's
 * ids are globally unique, so a match there is proof enough. The fallback by
 * order id is not. `client_reference_id` is a field the *sending account*
 * controls, and every seller on Sailo controls their own Stripe account — so an
 * unscoped lookup let any seller mark any other seller's order paid by opening a
 * checkout session on their own account with the victim's order id in it. It
 * took three shops in one test to see it.
 */
export async function orderForSession(
  session: Stripe.Checkout.Session,
  accountId: string | null,
) {
  const db = getDb();

  if (session.id) {
    const bySession = await db.query.orders.findFirst({
      where: eq(orders.stripeSessionId, session.id),
    });
    if (bySession) return bySession;
  }

  const orderId = session.client_reference_id ?? session.metadata?.orderId;
  if (!orderId) return null;

  const byId = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  return ownedBySender(byId, accountId);
}

