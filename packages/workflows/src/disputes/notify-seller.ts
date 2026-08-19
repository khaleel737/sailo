import "server-only";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  disputes,
  earlyFraudWarnings,
  orders,
  shops,
  user,
  type Shop,
} from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import {
  sendSellerDisputeClosed,
  sendSellerDisputeDeadline,
  sendSellerDisputeOpened,
  sendSellerFraudWarning,
} from "@sailo/email/shop";
import { pushSellerDispute } from "@sailo/notifications/push";
import { assembleEvidence, isInquiry } from "@sailo/core/disputes";
import { holdingsForOrder } from "@sailo/commerce/disputes";

/**
 * Telling a seller their money is being taken back.
 *
 * The gap this closes is the one that made the rest of the chargeback work
 * academic: a dispute was recorded, the order moved, /hq lit up — and the seller
 * found out on their next visit to the payments page. The response window is
 * about twenty days and the evidence that wins a case is usually a document only
 * they have. A seller who does not log in loses by default.
 *
 * Three decisions are made here rather than in the builders, and each is a
 * deliberate departure from how the rest of Sailo's seller mail works:
 *
 * **No notification preference.** `wantsNotification` gates order mail, and this
 * is not order mail. A chargeback is money leaving a balance inside a legal
 * window; a seller who muted "order placed" two years ago has not consented to
 * losing £400 without being told. `sendSellerWebhookDisabled` set the same
 * precedent for the same reason — some mail is operational, not optional. If a
 * seller genuinely wants this off, that is a support conversation and a
 * deliberate act, not a checkbox they ticked about receipts.
 *
 * **Its own ceiling, not the order-mail one.** Sharing `seller-mail:` would let
 * a burst of orders — or a bug in order mail — suppress the single most
 * important message Sailo sends. The bucket here is separate and generous
 * against reality: a shop with more than twenty disputes in a day has a problem
 * that a rate limit is not the answer to.
 *
 * **Idempotent by claim, not by check.** Stripe delivers at least once and out
 * of order, and one dispute arrives under several event ids. Every send is
 * claimed with a conditional update — `set … where … is null` — so two
 * deliveries racing produce one email, decided by Postgres. A read-then-send
 * would produce two.
 *
 * Same contract as every notifier here: failures are logged and swallowed. By
 * the time this runs the money has already moved, and a mail provider having a
 * bad afternoon must never fail the webhook that recorded it.
 */

/**
 * Generous against any real shop and tight against a loop. Twenty dispute mails
 * to one shop in a day is already a business emergency rather than a mail
 * problem, and the ceiling is there so a bug cannot turn it into a Resend bill.
 */
const DAILY_CEILING = 20;

/** `shop.contactEmail` when the seller set one, else the account's own email. */
async function sellerAddress(shop: Shop): Promise<string | null> {
  if (shop.contactEmail) return shop.contactEmail;
  const owner = await getDb().query.user.findFirst({
    where: eq(user.id, shop.userId),
    columns: { email: true },
  });
  return owner?.email ?? null;
}

async function underCeiling(shopId: string): Promise<boolean> {
  const verdict = await rateLimit(`dispute-mail:${shopId}`, DAILY_CEILING, 86_400);
  return verdict.allowed;
}

/**
 * Claim one send, so exactly one caller makes it.
 *
 * The whole of the idempotency, and it is a single statement on purpose: the
 * `where … is null` and the write happen in one atomic update, so two webhook
 * deliveries arriving in the same millisecond cannot both see null. Returns true
 * only for the caller that won.
 */
async function claim(
  disputeId: string,
  /*
   * `staffDeadlineNotifiedAt` joins the three seller columns here rather than
   * getting a claim of its own, because the *mechanism* is identical and it is
   * the mechanism that is load-bearing. What must not be shared is the column —
   * see spec 46 — and that is exactly what this argument keeps distinct.
   */
  column:
    | "sellerOpenedNotifiedAt"
    | "sellerDeadlineNotifiedAt"
    | "sellerClosedNotifiedAt"
    | "staffDeadlineNotifiedAt",
): Promise<boolean> {
  const db = getDb();
  const claimed = await db
    .update(disputes)
    .set({ [column]: new Date() })
    .where(and(eq(disputes.id, disputeId), isNull(disputes[column])))
    .returning({ id: disputes.id });
  return claimed.length > 0;
}

/** Undo a claim whose send then failed, so the next attempt may try again. */
async function releaseClaim(
  disputeId: string,
  column:
    | "sellerOpenedNotifiedAt"
    | "sellerDeadlineNotifiedAt"
    | "sellerClosedNotifiedAt",
): Promise<void> {
  await getDb()
    .update(disputes)
    .set({ [column]: null })
    .where(eq(disputes.id, disputeId));
}

/**
 * What this case needs that Sailo cannot produce, in the seller's own words.
 *
 * The single most useful line in the email, and the reason it is worth
 * assembling the evidence here rather than sending a generic "a dispute was
 * opened". Empty where there is no order to assemble from — a subscription
 * chargeback, or a charge taken outside Sailo.
 */
async function outstandingAsks(
  orderId: string | null,
  reason: string,
): Promise<{ missing: string[]; title: string | null }> {
  if (!orderId) return { missing: [], title: null };

  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return { missing: [], title: null };

  const shop = await db.query.shops.findFirst({ where: eq(shops.id, order.shopId) });
  const holdings = await holdingsForOrder(order, shop);
  const evidence = assembleEvidence(reason, holdings);

  return {
    /*
     * `needs_seller` and required only. A missing purchase IP is a gap nobody
     * can fill — the buyer's connection existed for one request months ago — and
     * listing it sends a seller looking for something that does not exist.
     */
    missing: evidence.fields
      .filter((field) => field.status === "needs_seller" && field.required)
      .map((field) => field.ask ?? field.field),
    title: order.productTitle,
  };
}

/** The one field the outcome mail needs from the order. */
async function orderTitleFor(orderId: string | null): Promise<string | null> {
  if (!orderId) return null;
  const order = await getDb().query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { productTitle: true },
  });
  return order?.productTitle ?? null;
}

type DisputeRow = typeof disputes.$inferSelect;

/**
 * "A buyer disputed a payment." Sent once, when the case opens.
 *
 * Called from the dispute webhook for connected disputes only. A seller charging
 * back their *own* Sailo subscription is not told by this — that is an argument
 * between them and us, and they already know: they started it.
 */
export async function notifySellerDisputeOpened(row: DisputeRow): Promise<void> {
  try {
    if (row.scope !== "connected" || !row.shopId) return;

    const db = getDb();
    const shop = await db.query.shops.findFirst({ where: eq(shops.id, row.shopId) });
    if (!shop) return;

    const to = await sellerAddress(shop);
    if (!to) return;
    if (!(await underCeiling(shop.id))) return;

    /* Claimed before sending, released if the send fails. */
    if (!(await claim(row.id, "sellerOpenedNotifiedAt"))) return;

    const { missing, title } = await outstandingAsks(row.orderId, row.reason);

    const result = await sendSellerDisputeOpened({
      shop,
      to,
      amountCents: row.amountCents,
      feeCents: row.feeCents,
      deductedCents: row.deductedCents,
      currency: row.currency,
      reason: row.reason,
      dueBy: row.dueBy,
      inquiry: isInquiry(row.status),
      orderTitle: title,
      missing,
    });

    if (!result.sent) {
      await releaseClaim(row.id, "sellerOpenedNotifiedAt");
      console.warn(`[sailo] dispute-opened email not sent: ${result.reason}`);
      return;
    }

    /*
     * And the phone. A seller who runs their shop from a handset is exactly the
     * one least likely to be reading email inside twenty days, and the push is
     * the only channel that interrupts.
     */
    await pushSellerDispute({
      shop,
      kind: isInquiry(row.status) ? "inquiry" : "chargeback",
      amountCents: row.amountCents,
      currency: row.currency,
      disputeId: row.id,
      dueBy: row.dueBy,
    });
  } catch (error) {
    console.error("[sailo] dispute-opened notification failed", error);
  }
}

/** "It is over, and here is how." Sent once, on a terminal status. */
export async function notifySellerDisputeClosed(row: DisputeRow): Promise<void> {
  try {
    if (row.scope !== "connected" || !row.shopId) return;

    const db = getDb();
    const shop = await db.query.shops.findFirst({ where: eq(shops.id, row.shopId) });
    if (!shop) return;

    const to = await sellerAddress(shop);
    if (!to) return;
    if (!(await underCeiling(shop.id))) return;
    if (!(await claim(row.id, "sellerClosedNotifiedAt"))) return;

    /*
     * Just the title. The outcome mail says what happened rather than what is
     * still needed, so assembling the evidence to reach one string would be a
     * dozen queries for nothing — on a webhook Stripe is waiting on.
     */
    const title = await orderTitleFor(row.orderId);

    const result = await sendSellerDisputeClosed({
      shop,
      to,
      amountCents: row.amountCents,
      feeCents: row.feeCents,
      currency: row.currency,
      reason: row.reason,
      orderTitle: title,
      status: row.status,
    });

    if (!result.sent) {
      await releaseClaim(row.id, "sellerClosedNotifiedAt");
      console.warn(`[sailo] dispute-closed email not sent: ${result.reason}`);
    }
  } catch (error) {
    console.error("[sailo] dispute-closed notification failed", error);
  }
}

/** The issuer's advance warning, which is the only chargeback anyone can avoid. */
export async function notifySellerFraudWarning(warning: {
  id: string;
  shopId: string | null;
  orderId: string | null;
  fraudType: string;
}): Promise<void> {
  try {
    if (!warning.shopId) return;

    const db = getDb();
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, warning.shopId),
    });
    if (!shop) return;

    const to = await sellerAddress(shop);
    if (!to) return;
    if (!(await underCeiling(shop.id))) return;

    const claimed = await db
      .update(earlyFraudWarnings)
      .set({ sellerNotifiedAt: new Date() })
      .where(
        and(
          eq(earlyFraudWarnings.id, warning.id),
          isNull(earlyFraudWarnings.sellerNotifiedAt),
        ),
      )
      .returning({ id: earlyFraudWarnings.id });
    if (claimed.length === 0) return;

    const order = warning.orderId
      ? await db.query.orders.findFirst({ where: eq(orders.id, warning.orderId) })
      : undefined;

    const result = await sendSellerFraudWarning({
      shop,
      to,
      amountCents: order?.totalCents ?? 0,
      currency: order?.currency ?? shop.currency ?? "USD",
      fraudType: warning.fraudType,
      orderTitle: order?.productTitle ?? null,
      orderId: order?.id ?? null,
    });

    if (!result.sent) {
      await db
        .update(earlyFraudWarnings)
        .set({ sellerNotifiedAt: null })
        .where(eq(earlyFraudWarnings.id, warning.id));
      console.warn(`[sailo] fraud-warning email not sent: ${result.reason}`);
      return;
    }

    await pushSellerDispute({
      shop,
      kind: "fraud_warning",
      amountCents: order?.totalCents ?? 0,
      currency: order?.currency ?? shop.currency ?? "USD",
      disputeId: warning.id,
      dueBy: null,
    });
  } catch (error) {
    console.error("[sailo] fraud-warning notification failed", error);
  }
}

/**
 * The reminder sweep: every open case whose deadline is close and whose seller
 * has not yet been nagged.
 *
 * Four days, and one nudge. The window Stripe gives is around twenty days, which
 * is long enough to read the first email, mean to deal with it, and forget —
 * and short enough that a second reminder inside it would be nagging rather than
 * helping. Four days is the last point at which finding a document, scanning it
 * and uploading it is comfortably possible.
 *
 * Past-due cases are deliberately excluded. Telling somebody they have missed a
 * deadline they can no longer act on is a notification with no action attached,
 * and the payments page already says so.
 */
export async function sendDueDisputeReminders(now = new Date()): Promise<{
  considered: number;
  sent: number;
}> {
  const db = getDb();
  const horizon = new Date(now.getTime() + 4 * 86_400_000);

  const due = await db
    .select()
    .from(disputes)
    .where(
      and(
        isNull(disputes.sellerDeadlineNotifiedAt),
        /* Still answerable: a deadline ahead of us, inside the window. */
        gte(disputes.dueBy, now),
        lte(disputes.dueBy, horizon),
        /* Still open, and not already answered. */
        isNull(disputes.evidenceSubmittedAt),
        sql`${disputes.status} in ('needs_response', 'warning_needs_response')`,
        eq(disputes.scope, "connected"),
      ),
    )
    .limit(200);

  let sent = 0;
  for (const row of due) {
    try {
      if (!row.shopId) continue;

      const shop = await db.query.shops.findFirst({ where: eq(shops.id, row.shopId) });
      if (!shop) continue;

      const to = await sellerAddress(shop);
      if (!to) continue;
      if (!(await underCeiling(shop.id))) continue;
      if (!(await claim(row.id, "sellerDeadlineNotifiedAt"))) continue;

      const { missing, title } = await outstandingAsks(row.orderId, row.reason);

      const result = await sendSellerDisputeDeadline({
        shop,
        to,
        amountCents: row.amountCents,
        feeCents: row.feeCents,
        deductedCents: row.deductedCents,
        currency: row.currency,
        reason: row.reason,
        dueBy: row.dueBy,
        inquiry: isInquiry(row.status),
        orderTitle: title,
        missing,
        now,
      });

      if (result.sent) {
        sent += 1;
      } else {
        await releaseClaim(row.id, "sellerDeadlineNotifiedAt");
      }
    } catch (error) {
      console.error(`[sailo] dispute reminder failed for ${row.id}`, error);
    }
  }

  return { considered: due.length, sent };
}

/**
 * The platform-side twin: claim the "Sailo's own chargeback is about to lapse"
 * notice.
 *
 * Spec 46. The sweep above is for a seller and is scoped `connected`; this one is
 * for the desk. Same shape, and the same claim discipline — a conditional update
 * on `staffDeadlineNotifiedAt`, so two overlapping ticks page once — but the
 * columns are different on purpose. Reusing the seller ones would make a column
 * mean two things depending on `scope`, which is the shape of bug that silently
 * stops notifying somebody.
 *
 * **It returns the claimed rows rather than alerting.** There is no seller to
 * email; the audience is staff, and the channel they already watch is
 * `captureMessage`, which lives in `@sailo/observability` — a package this one
 * does not depend on and should not start depending on for one line. The caller
 * (the cron route, which already imports it) does the alerting. That also keeps
 * the claim and the alert one step apart in a way worth stating: the claim is
 * what makes it once, and losing an alert to a crash between them is the cheaper
 * side of the trade than paging the desk on every tick.
 */
export async function claimDuePlatformDisputes(now = new Date()): Promise<
  {
    id: string;
    stripeDisputeId: string;
    reason: string;
    deductedCents: number;
    currency: string;
    dueBy: Date | null;
  }[]
> {
  const db = getDb();
  const horizon = new Date(now.getTime() + 4 * 86_400_000);

  const due = await db
    .select()
    .from(disputes)
    .where(
      and(
        isNull(disputes.staffDeadlineNotifiedAt),
        gte(disputes.dueBy, now),
        lte(disputes.dueBy, horizon),
        isNull(disputes.evidenceSubmittedAt),
        sql`${disputes.status} in ('needs_response', 'warning_needs_response')`,
        eq(disputes.scope, "platform"),
      ),
    )
    .limit(200);

  const claimed: Awaited<ReturnType<typeof claimDuePlatformDisputes>> = [];
  for (const row of due) {
    if (!(await claim(row.id, "staffDeadlineNotifiedAt"))) continue;
    claimed.push({
      id: row.id,
      stripeDisputeId: row.stripeDisputeId,
      reason: row.reason,
      deductedCents: row.deductedCents,
      currency: row.currency,
      dueBy: row.dueBy,
    });
  }

  return claimed;
}
