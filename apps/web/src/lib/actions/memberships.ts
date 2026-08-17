"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, subscriptions } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { can } from "@sailo/core/plans";
import { isUuid } from "@/lib/utils";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { appUrl } from "@/lib/app-url";
import { billingPortalSession, cancelSubscriptionAtPeriodEnd } from "@sailo/commerce/orders/server";
import { subscriptionForOrder } from "@/lib/membership-access";
import { isManual } from "@/lib/memberships";

/**
 * Stopping — from either end.
 *
 * A member can cancel and a seller can cancel, and neither writes the
 * cancellation here. Both ask Stripe, and Stripe tells us through
 * `customer.subscription.updated`, which is what actually updates the row.
 *
 * That is not indirection for its own sake. A button that wrote `canceled`
 * locally and then failed to reach Stripe would show a member as cancelled
 * while their card kept being charged every month — the single worst outcome
 * this feature can produce, and the one that ends in a chargeback and a
 * complaint. Letting the billing system be the thing that decides means the
 * two can never disagree for longer than a webhook takes to arrive.
 */

export type MembershipState = { ok: boolean; error?: string; message?: string };

/**
 * The member's own way out: Stripe's hosted billing portal.
 *
 * Reached from their delivery page with nothing but the order token, because
 * a member has no account here and must not need one to stop paying. The
 * token is the credential — the same one that opens their files — and the
 * portal Stripe returns is scoped to their customer record on the seller's
 * account, so it shows their card and their subscription and nothing else.
 *
 * Hosting none of this ourselves is the point: no card form, no cancellation
 * flow, no confirmation dialog to get wrong, and no state to leave stale.
 */
export async function openMembershipPortal(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/");

  /*
   * Public and unauthenticated, so it carries a ceiling like every other
   * public route. Keyed on the caller rather than the token: a made-up token
   * costs a database lookup and a Stripe call, and the address is what bounds
   * somebody trying thousands of them.
   */
  const gate = await rateLimit(`portal:${await callerIp()}`, 10, 300);
  if (!gate.allowed) redirect(`/download/${encodeURIComponent(token)}?busy=1`);

  const order = await getDb().query.orders.findFirst({
    where: eq(orders.downloadToken, token),
  });
  if (!order) redirect("/");

  const subscription = await subscriptionForOrder(order);
  /*
   * No subscription, or one with no customer behind it, is not an error to
   * explain — it is a token for an order that is not a membership, and the
   * page it came from does not show this button for those. Back to the page.
   */
  if (!subscription?.stripeCustomerId || !subscription.stripeAccountId) {
    redirect(`/download/${encodeURIComponent(token)}`);
  }

  const session = await billingPortalSession({
    accountId: subscription.stripeAccountId,
    customerId: subscription.stripeCustomerId,
    returnUrl: `${appUrl()}/download/${encodeURIComponent(token)}`,
  });

  redirect(session.url);
}

/**
 * The seller's end: stop billing at the end of the period.
 *
 * Never immediately, and not as a courtesy — the member has paid for the
 * month, so ending it today would be keeping money for access we withdrew.
 * `cancel_at_period_end` is also what makes this safe to press by mistake:
 * the member keeps everything they paid for, and the seller can undo it in
 * Stripe before the period runs out.
 */
export async function cancelMembership(
  _prev: MembershipState,
  formData: FormData,
): Promise<MembershipState> {
  const { shop } = await requireShop();
  if (!can(shop, "memberships")) {
    return { ok: false, error: "Memberships aren't on your plan." };
  }

  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Which membership?" };

  const row = await getDb().query.subscriptions.findFirst({
    // Shop-scoped in the WHERE: a guessed id from another shop must not be
    // cancellable, and a 404-shaped answer is what it gets.
    where: and(eq(subscriptions.id, id), eq(subscriptions.shopId, shop.id)),
  });
  if (!row) return { ok: false, error: "That membership isn't yours to change." };

  /*
   * A card membership is cancelled at Stripe; a manual one is cancelled here.
   *
   * The asymmetry is the whole difference between the two modes. Stripe holds
   * a card and will charge it again unless told not to, so telling it is the
   * only thing that actually stops the money — writing `canceled` locally
   * while Stripe kept billing is the worst outcome this feature can produce.
   * A manual membership has nothing charging anything: stopping it *is* the
   * row, because the row is what the renewal cron reads.
   */
  if (!isManual(row)) {
    if (!row.stripeAccountId || !row.stripeSubscriptionId) {
      return { ok: false, error: "This membership isn't connected to Stripe." };
    }
    try {
      await cancelSubscriptionAtPeriodEnd({
        accountId: row.stripeAccountId,
        subscriptionId: row.stripeSubscriptionId,
      });
    } catch (error) {
      console.error("[sailo] membership cancel failed", error);
      return { ok: false, error: "Stripe wouldn't accept that just now. Try again." };
    }
  }

  /*
   * Written here for both, and re-written by the webhook for one.
   *
   * On the card path the webhook is the authority — it always was — but it can
   * take a second to arrive, and a seller who presses Cancel and sees nothing
   * change presses it again. This makes the screen honest immediately; if
   * Stripe disagrees, `customer.subscription.updated` corrects it within
   * seconds. On the manual path no correction is coming, because this write is
   * the cancellation.
   */
  await getDb()
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(subscriptions.id, row.id));

  revalidatePath("/admin/members");
  return {
    ok: true,
    message: "It won't renew. They keep access until the period they've paid for ends.",
  };
}
