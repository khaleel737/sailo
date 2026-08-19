import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, shops, type Dispute } from "@sailo/db/schema";
import { captureMessage } from "@sailo/observability";
import { publishShopEvent } from "@sailo/events";
import { restoreStock } from "@sailo/commerce/catalog";
import { normalizeDispute } from "@sailo/payments/disputes";
import {
  notifySellerDisputeClosed,
  notifySellerDisputeOpened,
  notifySellerFraudWarning,
} from "@sailo/workflows/disputes";
import { orderForIntent, shopIdFor } from "@sailo/payments";
import { freePlanFields } from "@sailo/billing/map";
import {
  applyEscalation,
  claimStaffNotice,
  enforceCardBillingBlock,
  holdPlanForDispute,
  linkWarningToDispute,
  paymentStatusForDispute,
  recordDispute,
  recordEarlyFraudWarning,
  reinstatePlanAfterWin,
} from "@sailo/commerce/disputes";
import { emitDisputeWebhook } from "@sailo/webhooks/emit";
import { revalidateShop } from "@/lib/cache";
import { autoFillEvidence } from "@/lib/evidence-pack";

/**
 * Every dispute event, on either Stripe account.
 *
 * Its own module because a dispute is the one object in Sailo that exists on both
 * — a buyer charging back a seller's sale lands on the connected account, a seller
 * charging back their own $49 subscription lands on the platform's — and because
 * the old handling of it, two cases inside `connect.ts`, was wrong in three ways
 * that each cost real money:
 *
 * **1. Inquiries were treated as chargebacks.** `charge.dispute.created` fires for
 * both. Verified against the API in test mode: an inquiry
 * (`pm_card_createDisputeInquiry`) arrives with `balance_transactions: []` and
 * `is_charge_refundable: true` — nothing has moved — while a chargeback
 * (`pm_card_createDispute`) arrives with one transaction of `net: -5700` on a $42
 * charge. The old code marked the order `disputed` for both, telling a seller
 * money had left their balance when none had, in a status
 * `SELLER_SETTABLE_PAYMENT_STATUSES` deliberately forbids them from correcting.
 *
 * **2. A closed inquiry was treated as a loss.** The branch was
 * `won = status === "won"`, so `warning_closed` — an inquiry that closed with no
 * chargeback behind it, which is the *good* outcome — fell through to the losing
 * side. The order was marked `refunded`, its stock was put back on the shelf and
 * the affiliate's commission was reversed, on a sale the seller had been paid for
 * and still held.
 *
 * **3. Platform subscription disputes were dropped silently.** The platform
 * route sends every `charge.dispute.*` to the connected handler, which looked for
 * an order by payment intent, found none, and returned "order not found" with a
 * 200. A seller could charge back their $468 annual invoice and keep the Business
 * plan indefinitely, and nothing anywhere recorded that it had happened.
 */

/** What `handleDisputeEvent` did, for the route's response body. */
type Outcome = string;

/**
 * The statuses that mean the case is over, and the seller is owed an outcome
 * rather than a deadline.
 *
 * `warning_closed` is included: an inquiry that closed without becoming a
 * chargeback is a real result and a good one, and a seller told money was
 * questioned and never told it was dropped will chase it.
 */
const TERMINAL = new Set([
  "won",
  "lost",
  "warning_closed",
  "prevented",
  "charge_refunded",
]);

export async function handleDisputeEvent(
  event: Stripe.Event,
  accountId: string | null,
): Promise<Outcome> {
  const dispute = normalizeDispute(event.data.object as Stripe.Dispute);
  const occurredAt = new Date(event.created * 1000);

  /*
   * Which account's money this is, decided by looking rather than guessing.
   *
   * `accountId` is present on every event Stripe delivers to the Connect
   * endpoint, so that settles it. Its absence does not: a shop whose Stripe
   * account *is* the platform's own takes direct charges with no account header
   * — `actingAs` supports exactly that so the whole flow can be exercised end to
   * end — and filing one of those as a subscription dispute would leave a buyer's
   * chargeback out of the shop's rate entirely.
   *
   * So an order lookup is the tie-breaker, and it goes through `orderForIntent`
   * — the only sanctioned route from a charge to an order, and the reason is a
   * bug that was already fixed once. `charge.refunded` used to run its own
   * `findFirst` on `stripePaymentIntentId` and act on whatever came back, which
   * let a seller mark another shop's order refunded from their own connected
   * account. Every seller on Sailo controls their own Stripe account, so an
   * event naming an order is not evidence that the order's seller sent it.
   * `stripe-webhooks.test.ts` counts those lookups across both halves of the
   * split and fails if a second one appears — which is how the first draft of
   * this file was caught.
   */
  const order = (await orderForIntent(dispute.stripePaymentIntentId, accountId)) ?? undefined;

  const scope = accountId || order ? "connected" : "platform";

  /*
   * A platform dispute needs its shop found a different way.
   *
   * There is no order and no connected account — only Sailo's own charge. The
   * shop is whoever the Stripe customer belongs to, which `shopIdFor` already
   * resolves for every subscription event.
   */
  let platformShopId: string | null = null;
  if (scope === "platform") {
    const charge = await chargeOf(event);
    platformShopId = await shopIdFor({
      shopId: charge?.metadata?.shopId,
      customerId: typeof charge?.customer === "string" ? charge.customer : null,
    });
  }

  const recorded = await recordDispute({
    dispute,
    accountId,
    scope,
    ...(scope === "platform" ? { shopId: platformShopId } : {}),
    occurredAt,
  });

  // An early fraud warning that predicted this one, so the pair can be measured.
  await linkWarningToDispute(dispute.stripeChargeId, recorded.id);

  if (!recorded.applied) {
    /*
     * An out-of-order delivery. Stripe retries, and a retry of an earlier event
     * can land after a later one — applying it would reopen a decided dispute.
     * Acknowledged, because it is genuinely Stripe's and genuinely already
     * handled.
     */
    return `dispute ${dispute.stripeDisputeId} stale (${dispute.status} after ${recorded.status})`;
  }

  if (scope === "platform") {
    return handlePlatformDispute(dispute, platformShopId, recorded.id);
  }

  const outcome = await handleConnectedDispute(
    dispute,
    order,
    recorded.id,
    recorded.shopId,
    /*
     * The row as the write just left it, rather than a re-read. Spec 45's
     * auto-fill needs `stripeAccountId` and `scope` off it, and a `findFirst`
     * here would be a second round trip on a path Stripe is waiting on — with a
     * chance of reading a *different* row, since a concurrent delivery can land
     * in between.
     */
    recorded.row,
  );

  /*
   * And tell the seller, which is the whole point of the deadline existing.
   *
   * After the handler rather than inside it, because the mail describes the row
   * as it now stands — the deduction, the deadline and the status all settle in
   * `recordDispute` and the branch above. Never awaited into the outcome: the
   * money has already moved and a mail provider having a bad afternoon must not
   * fail the webhook that recorded it, which would have Stripe retry an event
   * that was handled correctly.
   *
   * Which message is decided by the status rather than the event type. An
   * `updated` that first carries a deadline is the opening one as far as a seller
   * is concerned, and a `closed` is the outcome however it arrived — and both are
   * claimed, so a redelivery mails nobody twice.
   */
  const row = recorded.row;
  const closed = TERMINAL.has(row.status);
  if (closed) {
    await notifySellerDisputeClosed(row);
  } else {
    await notifySellerDisputeOpened(row);
  }

  /*
   * And tell the seller's own tooling, which is a different audience from the
   * mail above and often a more useful one.
   *
   * The evidence that wins a chargeback — the delivery scan, the helpdesk
   * thread, the login record — usually lives in a system that is not Sailo, and
   * the response window is about twenty days. A `dispute.opened` is what lets a
   * seller's automation go and fetch it on the day it arrives rather than on
   * whichever day they next open the payments page.
   *
   * In the connected branch only, and that is load-bearing: the platform branch
   * above returns before reaching here, so a seller charging back their own
   * Sailo subscription — Sailo's money, Sailo's problem — never arrives in that
   * seller's Zapier account dressed as a customer chargeback.
   *
   * `recorded.applied` was checked above, so a stale redelivery has already
   * returned and cannot emit a second `dispute.opened` for one case.
   */
  if (recorded.shopId) {
    const shop = await getDb().query.shops.findFirst({
      where: eq(shops.id, recorded.shopId),
    });
    if (shop) {
      await emitDisputeWebhook({
        shop,
        event: closed ? "dispute.closed" : "dispute.opened",
        disputeId: recorded.id,
      });
    }
  }

  return outcome;
}

/**
 * A buyer's chargeback against a seller's sale.
 *
 * The order moves only when money has actually moved, and the stock only when the
 * loss is final.
 */
async function handleConnectedDispute(
  dispute: ReturnType<typeof normalizeDispute>,
  order: typeof orders.$inferSelect | undefined,
  disputeRowId: string,
  shopId: string | null,
  recordedRow: Dispute,
): Promise<Outcome> {
  const db = getDb();

  if (!order) {
    /*
     * Recorded, not dropped, and — since a live run caught this — still assessed.
     *
     * A dispute against a charge Sailo has no order for is a real case: the
     * seller took the payment from Stripe's own dashboard, or the order row was
     * deleted. It is still that shop's chargeback, still counts against the
     * platform with Visa, and its money still comes out of a balance Sailo is
     * the losses collector for.
     *
     * The first version returned here, before the escalation below. Verified
     * against live test mode on 17 August 2026: a real $500 chargeback landed on
     * a connected account, was recorded against the right shop with the right
     * $515 deduction — and the shop was never assessed, because there was no
     * order row to hang the assessment off. A seller taking payments outside
     * Sailo could accumulate chargebacks that were recorded and never acted on,
     * which is the one shape this whole feature exists to catch.
     *
     * So the order decides what happens to the *order*, and the shop decides
     * what happens to the *money*. They are separate questions and only the
     * first one needs an order row.
     */
    captureMessage(
      `Dispute ${dispute.stripeDisputeId} has no Sailo order (charge ${dispute.stripeChargeId})`,
      "warning",
    );
    const escalation = await escalate(shopId);
    return `dispute ${dispute.stripeDisputeId} recorded without an order${escalation}`;
  }

  /*
   * Spec 45 — fill the evidence slots Sailo can fill, at the moment the case
   * opens rather than at the moment somebody remembers.
   *
   * Seven of the nine file fields are documents Sailo already holds the facts
   * for, and the seller was being asked to hand-produce them out of our own
   * database an hour before a deadline. Registered as ordinary
   * `dispute_evidence_files` rows with `uploadedBy = 'sailo:auto'`, so the
   * readiness panel shows those slots as held and the seller's job shrinks to
   * the two that are genuinely theirs.
   *
   * Never overwrites a seller's own upload, never runs on a platform dispute,
   * and swallows its own failures: the chargeback is recorded either way and
   * every document here can be generated again from the same facts.
   */
  const shopRow = shopId
    ? await db.query.shops.findFirst({ where: eq(shops.id, shopId) })
    : undefined;
  if (shopRow) {
    const filled = await autoFillEvidence({
      dispute: recordedRow,
      order,
      shop: shopRow,
      now: new Date(),
    });
    if (filled.filled.length > 0) {
      captureMessage(
        `Filled ${filled.filled.length} evidence slot(s) for dispute ` +
          `${dispute.stripeDisputeId} from what Sailo already held: ${filled.filled.join(", ")}`,
        "info",
      );
    }
  }

  const change = paymentStatusForDispute(dispute, order.paymentStatus);

  if (change.paymentStatus) {
    /*
     * The stock, and only on a final loss.
     *
     * A lost chargeback is a refund the seller never chose, so the goods go back
     * on the shelf exactly as a refund would put them. Not on `created`: the money
     * is out but the case is not over, and restocking then would have a shop
     * selling a unit it may still have to ship if it wins.
     */
    if (dispute.status === "lost") {
      await restoreStock(order);
    }

    await db
      .update(orders)
      .set({
        paymentStatus: change.paymentStatus,
        ...(change.status ? { status: change.status } : {}),
        ...(dispute.status === "lost"
          ? {
              refundedCents: dispute.amountCents,
              refundedAt: new Date(),
              refundReason: `Chargeback lost: ${dispute.reason}`,
            }
          : {}),
        /*
         * Cleared on a win, and only the chargeback note. `refundReason` also
         * carries a seller's own refund note, so this writes null only where the
         * dispute wrote the note in the first place.
         */
        ...(dispute.status === "won" || dispute.status === "prevented"
          ? { refundReason: null }
          : {}),
        ...(dispute.status === "needs_response" ||
        dispute.status === "under_review"
          ? { refundReason: `Chargeback: ${dispute.reason}` }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));
  }

  await publishShopEvent(order.shopId, "payment");

  const escalation = await escalate(order.shopId);
  return `dispute ${disputeRowId} ${dispute.status} on order ${order.id} (${change.note})${escalation}`;
}

/**
 * Reassess the shop, and hold its payouts if the assessment says so.
 *
 * Run on every dispute event rather than nightly, because the thing being raced
 * is the payout run: a sweep that fires at 3am leaves the window open for up to
 * a day after the chargeback that should have closed it. Cheap enough to be —
 * two queries and one Stripe balance read.
 *
 * Its own function because both dispute paths need it and only one of them has
 * an order. The version that lived inline in the order branch meant a chargeback
 * against a charge Sailo had no order for was recorded and never assessed, which
 * a live test caught.
 */
async function escalate(shopId: string | null): Promise<string> {
  if (!shopId) return "";
  const shop = await getDb().query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop) return "";

  const outcome = await applyEscalation(shop);
  let note = `, ${outcome.decision.level}`;

  if (outcome.applied === "payouts_held") {
    note += " (payouts held)";
    captureMessage(
      `Payouts held for shop ${shop.handle}: ${outcome.decision.reason}`,
      "warning",
    );
    // The seller's own payments page shows the hold; it is cached.
    revalidateShop(shop.id, shop.handle);
    await publishShopEvent(shop.id, "account");
  }
  if (outcome.error) {
    captureMessage(
      `Payout hold for shop ${shop.handle} failed: ${outcome.error}`,
      "error",
    );
    note += " (hold FAILED — payouts still running)";
  }
  if (outcome.suspensionWarranted) {
    captureMessage(
      `Shop ${shop.handle} is past the point where suspension should be considered`,
      "error",
    );
  }
  return note;
}

/**
 * A seller charging back what they paid Sailo.
 *
 * The gap that existed before this function: the platform route sends every
 * `charge.dispute.*` to the connected handler, which found no order and returned
 * a 200. So a seller could reverse their $468 annual invoice and keep the
 * Business plan for as long as they liked, with no record anywhere.
 *
 * The response is deliberately staged rather than immediate:
 *
 * - **On an inquiry**, nothing. Their bank is asking a question and no money has
 *   moved. Downgrading a paying customer because their bank made an enquiry is
 *   how a billing misunderstanding becomes a lost account.
 * - **On a chargeback**, the plan stands and staff are told. The money is gone —
 *   Stripe debits it the moment it lands — so Sailo is now providing a paid
 *   service for nothing. But the seller may be right, and a plan yanked from
 *   under a business mid-month over a dispute they win is worse than sixty days
 *   of Pro.
 * - **On a loss**, the plan goes. The charge has been reversed with finality;
 *   continuing to bill nothing and serve everything is not a policy.
 */
async function handlePlatformDispute(
  dispute: ReturnType<typeof normalizeDispute>,
  shopId: string | null,
  disputeRowId: string,
): Promise<Outcome> {
  const db = getDb();
  const money = `${(dispute.deductedCents / 100).toFixed(2)} ${dispute.currency}`;

  if (!shopId) {
    /*
     * A platform charge with no shop behind it. Recorded and escalated to a
     * human, because Sailo's own balance has been debited and nobody can say
     * whose it was — which is a bookkeeping problem, not a webhook problem.
     */
    captureMessage(
      `Platform dispute ${dispute.stripeDisputeId} (${money}) could not be traced to a shop`,
      "error",
    );
    return `platform dispute ${disputeRowId} recorded, shop unknown`;
  }

  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop) return `platform dispute ${disputeRowId} recorded, shop ${shopId} missing`;

  /*
   * Tell the desk, once. Spec 46.
   *
   * The three `seller*NotifiedAt` claims are for telling a *seller* about their
   * dispute; a platform dispute needs the opposite, and reusing those columns
   * would make one mean two things depending on `scope`. Same conditional-update
   * shape, different columns — so a retried `charge.dispute.created` under a
   * fifth event id pages the desk once rather than five times.
   *
   * Before the branches below, because the message is worth sending whatever the
   * status turns out to be: an inquiry that nobody answers becomes a chargeback.
   */
  if (await claimStaffNotice(disputeRowId, "opened")) {
    captureMessage(
      `Sailo has a subscription chargeback to answer: shop ${shop.handle}, ${money}, ` +
        `${dispute.reason}. Due by ${dispute.dueBy?.toISOString() ?? "unknown"}. ` +
        `Open /hq/disputes — the evidence is assembled and the three decision ` +
        `questions are answered there.`,
      dispute.inquiry ? "info" : "warning",
    );
  }

  if (dispute.inquiry) {
    /*
     * No money has moved on an inquiry and the plan must not be touched. That is
     * unchanged and it is stated again here because it is the one thing spec 46
     * says twice: `isInquiry` keys on the `warning_` status prefix and applies
     * on this side exactly as it does on the connected one.
     */
    captureMessage(
      `Shop ${shop.handle} raised a billing enquiry on their subscription (${money})`,
      "info",
    );
    return `platform inquiry ${disputeRowId} on shop ${shop.handle}, plan untouched`;
  }

  if (dispute.status === "lost") {
    /*
     * The charge is reversed for good. Back to free, through the same columns the
     * ordinary lapse path uses — `freePlanFields` rather than a hand-written set,
     * so a downgrade here leaves the shop in exactly the state a cancellation
     * would and `planFor` reads it the same way.
     *
     * `compPlan` is deliberately not touched. A shop we comped has a plan granted
     * by us that outranks Stripe, and a chargeback on a $0 invoice they were never
     * billed for should not take away a gift.
     */
    await db
      .update(shops)
      .set(freePlanFields())
      .where(eq(shops.id, shop.id));
    revalidateShop(shop.id, shop.handle);
    await publishShopEvent(shop.id, "account");

    captureMessage(
      `Shop ${shop.handle} lost a subscription chargeback (${money}) and was moved to free`,
      "warning",
    );
    return `platform dispute ${disputeRowId} lost, shop ${shop.handle} moved to free`;
  }

  if (dispute.status === "won") {
    /*
     * Contesting and downgrading are not exclusive — spec 46. The plan was
     * remembered when the case opened, so a win puts the seller back on what
     * they were actually paying for rather than on whatever the code guesses.
     * Returns false when nothing was held, which is the ordinary case for a
     * dispute that never got as far as a downgrade.
     */
    const reinstated = await reinstatePlanAfterWin(shop.id);
    if (reinstated) {
      revalidateShop(shop.id, shop.handle);
      await publishShopEvent(shop.id, "account");
    }

    captureMessage(
      `Shop ${shop.handle} lost their subscription chargeback; ${money} reinstated to Sailo`,
      "info",
    );
    return `platform dispute ${disputeRowId} won, shop ${shop.handle} plan ${
      reinstated ? "reinstated" : "unchanged"
    }`;
  }

  /*
   * Remember the plan while the case runs, so a win can put it back.
   *
   * Claimed against a null, so two deliveries of `charge.dispute.created` cannot
   * overwrite the remembered plan with one a downgrade has already changed.
   */
  await holdPlanForDispute(shop.id);

  /*
   * And close the card rail if this is their second.
   *
   * A repeat is not an accident, and re-subscribing by card after one is how the
   * same amount is lost again. Deliberately the narrow control: the shop keeps
   * trading, keeps taking card payments from its own buyers, keeps its
   * storefront. All that closes is the rail it pays *us* on.
   */
  const blocked = await enforceCardBillingBlock(shop.id);
  if (blocked) {
    captureMessage(
      `Shop ${shop.handle} has a second subscription chargeback — card billing closed to them`,
      "warning",
    );
  }

  captureMessage(
    `Shop ${shop.handle} charged back their subscription (${money}, ${dispute.reason}). ` +
      `Plan left in place pending the outcome; due by ${dispute.dueBy?.toISOString() ?? "unknown"}.`,
    "warning",
  );
  return `platform chargeback ${disputeRowId} on shop ${shop.handle}, plan held pending outcome${
    blocked ? ", card billing closed" : ""
  }`;
}

/**
 * An early fraud warning: the only advance notice anybody gets.
 *
 * The issuer has told the network the cardholder called this fraud, and a
 * chargeback usually follows within days. Refunding now avoids the chargeback and
 * the $15 fee — though not the fraud report itself, which still counts towards
 * Visa's VAMP fraud component, so this is not a way to keep a rate clean. It is a
 * way to stop losing the goods as well as the money.
 *
 * Deliberately not automatic. An EFW is the issuer's opinion, not a finding, and
 * auto-refunding every one would hand money back on legitimate sales the seller
 * has already shipped. It is recorded, surfaced, and the seller decides.
 */
export async function handleEarlyFraudWarning(
  event: Stripe.Event,
  accountId: string | null,
): Promise<Outcome> {
  const warning = event.data.object as Stripe.Radar.EarlyFraudWarning;
  const chargeId =
    typeof warning.charge === "string" ? warning.charge : warning.charge?.id ?? null;
  const intentId =
    typeof warning.payment_intent === "string"
      ? warning.payment_intent
      : warning.payment_intent?.id ?? null;

  const recorded = await recordEarlyFraudWarning({
    stripeWarningId: warning.id,
    stripeChargeId: chargeId,
    stripeAccountId: accountId,
    fraudType: warning.fraud_type,
    actionable: warning.actionable,
    stripeCreatedAt: new Date(warning.created * 1000),
    paymentIntentId: intentId,
  });

  if (!recorded.id) return `early fraud warning ${warning.id} already recorded`;

  if (recorded.shopId) {
    await publishShopEvent(recorded.shopId, "payment");
    /*
     * The only chargeback anybody can prevent, so this is the one notification
     * where a day's delay usually costs the money *and* the goods. Refunding
     * inside this window avoids the chargeback and its fee.
     */
    await notifySellerFraudWarning({
      id: recorded.id,
      shopId: recorded.shopId,
      orderId: recorded.orderId ?? null,
      fraudType: warning.fraud_type,
    });
    captureMessage(
      `Early fraud warning on shop ${recorded.shopId} (${warning.fraud_type}). ` +
        `Refunding now avoids the chargeback and its fee; the fraud report stands either way.`,
      "warning",
    );
  }

  return `early fraud warning ${warning.id} recorded${recorded.orderId ? ` on order ${recorded.orderId}` : ""}`;
}

/**
 * The charge behind a platform dispute, for the customer id on it.
 *
 * Expanded from the event rather than fetched, where the event already carries
 * it. A dispute's `charge` is a string id in the webhook payload, so this is a
 * retrieve — but only on the platform path, which is rare, and only when the
 * shop cannot be found any other way.
 */
async function chargeOf(event: Stripe.Event): Promise<Stripe.Charge | null> {
  const dispute = event.data.object as Stripe.Dispute;
  if (dispute.charge && typeof dispute.charge !== "string") return dispute.charge;

  const { stripe } = await import("@sailo/payments");
  try {
    const id = typeof dispute.charge === "string" ? dispute.charge : null;
    if (!id) return null;
    return await stripe().charges.retrieve(id);
  } catch {
    return null;
  }
}
