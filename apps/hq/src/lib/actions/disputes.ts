"use server";

/**
 * The four things staff do about a chargeback.
 *
 * Answer it, refund instead of answering it, let a shop's payouts run again, and
 * — the one nothing automatic may do — close a storefront.
 *
 * Each is HQ reaching into somebody else's money, so each writes a staff note
 * naming who did it. The audit line is not decoration: "released a payout hold"
 * three months later is not an answer to "on what basis, and were they right?".
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputes, shops } from "@sailo/db/schema";
import { refundCharge } from "@sailo/payments";
import { releaseHold, respondToDispute } from "@sailo/commerce/disputes";
import { requireStaff } from "@/lib/session";
import { revalidateShopOnWeb } from "@/lib/web-cache";
import type { ActionState } from "@sailo/core/action-state";
import { recordOnAccount } from "./shared";

/**
 * Send the assembled evidence to Stripe.
 *
 * One shot. Stripe accepts exactly one *submitted* response per dispute, so this
 * refuses rather than retries if evidence has already gone — the second
 * submission does not replace the first, it is simply rejected, and a UI that
 * offered the button again would teach staff to press it twice.
 *
 * The evidence is assembled server-side from the order at the moment of
 * sending, never taken from the form. What the browser posts is a dispute id.
 */
export async function submitDisputeEvidence(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();

  const id = String(formData.get("disputeId") ?? "").trim();
  if (!id) return { ok: false, error: "That dispute no longer exists." };

  const db = getDb();
  const dispute = await db.query.disputes.findFirst({ where: eq(disputes.id, id) });
  if (!dispute) return { ok: false, error: "That dispute no longer exists." };

  const result = await respondToDispute({ disputeId: id, submit: true });
  if (!result.ok) return { ok: false, error: result.error };

  const shop = dispute.shopId
    ? await db.query.shops.findFirst({
        where: eq(shops.id, dispute.shopId),
        columns: { id: true, userId: true },
      })
    : undefined;

  if (shop) {
    await recordOnAccount(
      staff.email,
      "dispute.answered",
      shop.id,
      shop.userId,
      `Answered chargeback ${dispute.stripeDisputeId} ` +
        `(${dispute.reason}, ${(dispute.amountCents / 100).toFixed(2)} ${dispute.currency}) — ` +
        `evidence ${(result.completenessBp / 100).toFixed(0)}% complete, ` +
        `Visa CE3.0 ${result.ce3Submitted ? "submitted" : `not used: ${result.ce3Note}`}`,
    );
  }

  revalidatePath("/disputes");
  return {
    ok: true,
    message: result.ce3Submitted
      ? "Answer sent, with Visa's prior-transaction rule attached."
      : `Answer sent. ${result.ce3Note}`,
  };
}

/**
 * Give the money back rather than argue for it.
 *
 * Often the right call and rarely the obvious one. A refund on an open dispute
 * does **not** cancel the chargeback — the money has already left and the case
 * runs to its end — so this is only worth doing where the buyer is plainly right
 * and the seller would rather not spend a fortnight losing. The wording below
 * says so, because staff who believe it closes the case will use it wrongly.
 *
 * Where it genuinely does prevent a chargeback is an *early fraud warning*,
 * which is a different object and a different button.
 */
export async function refundDisputedCharge(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();

  const id = String(formData.get("disputeId") ?? "").trim();
  const db = getDb();
  const dispute = await db.query.disputes.findFirst({ where: eq(disputes.id, id) });
  if (!dispute) return { ok: false, error: "That dispute no longer exists." };

  if (!dispute.stripePaymentIntentId || !dispute.stripeAccountId) {
    return {
      ok: false,
      error: "This charge has no connected account on it — refund it from Stripe.",
    };
  }
  /*
   * An inquiry is the one where refunding actually helps: nothing has been
   * debited yet, and a refund usually stops the enquiry becoming a chargeback.
   * On a chargeback the money has already gone and refunding pays twice.
   */
  if (!dispute.status.startsWith("warning_")) {
    return {
      ok: false,
      error:
        "The money has already been taken by the chargeback. Refunding now would pay the buyer twice — answer it or let it close.",
    };
  }

  await refundCharge({
    accountId: dispute.stripeAccountId,
    paymentIntentId: dispute.stripePaymentIntentId,
    amountCents: dispute.amountCents,
  });

  const shop = dispute.shopId
    ? await db.query.shops.findFirst({
        where: eq(shops.id, dispute.shopId),
        columns: { id: true, userId: true },
      })
    : undefined;

  if (shop) {
    await recordOnAccount(
      staff.email,
      "dispute.refunded",
      shop.id,
      shop.userId,
      `Refunded ${(dispute.amountCents / 100).toFixed(2)} ${dispute.currency} ` +
        `on enquiry ${dispute.stripeDisputeId} rather than contesting it`,
    );
  }

  revalidatePath("/disputes");
  return { ok: true, message: "Refunded. The enquiry should close without a chargeback." };
}

/**
 * Let a shop's payouts run again.
 *
 * Held by arithmetic, released by a person — and never the other way round. The
 * arithmetic that would lift a hold is the same arithmetic that lifts it the
 * moment a shop's oldest cohort ages out of the twelve-month window, which
 * returns a fraudulent seller's payouts on a calendar technicality with nobody
 * having looked.
 *
 * `clear` records that a human decided the shop is fine, so the next assessment
 * does not simply re-apply what was just lifted. It is overridden by two further
 * chargebacks rather than by time — new evidence, not the passage of days.
 */
export async function releasePayoutHold(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();

  const shopId = String(formData.get("shopId") ?? "").trim();
  const clear = formData.get("clear") === "on";
  const note = String(formData.get("note") ?? "").trim();

  const db = getDb();
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop) return { ok: false, error: "That shop no longer exists." };
  if (!shop.payoutsPausedAt) return { ok: false, error: "Payouts are not held." };

  const result = await releaseHold(shop, { clear });
  if (!result.ok) return { ok: false, error: result.error };

  await recordOnAccount(
    staff.email,
    "payouts.released",
    shop.id,
    shop.userId,
    `Released the payout hold (back to ${result.interval})` +
      `${clear ? ", and cleared the shop" : ""}${note ? ` — ${note}` : ""}`,
  );

  await revalidateShopOnWeb({ id: shop.id, handle: shop.handle });
  revalidatePath("/disputes");
  return {
    ok: true,
    message: `Payouts back on a ${result.interval} schedule.`,
  };
}

/**
 * Stage the evidence without answering the case.
 *
 * Stripe stores it and does nothing with it, which is exactly what is wanted
 * while somebody reads it: `submit: false` is reversible, `submit: true` is not.
 * A platform that omits the flag by accident has a pipeline that appears to work
 * — `has_evidence: true` on every dispute — and wins nothing, which is why the
 * two are separate buttons rather than one with a checkbox.
 */
export async function stageDisputeEvidence(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();

  const id = String(formData.get("disputeId") ?? "").trim();
  const result = await respondToDispute({ disputeId: id, submit: false });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/disputes");
  return {
    ok: true,
    message:
      `Draft saved to Stripe at ${(result.completenessBp / 100).toFixed(0)}% complete. ` +
      `Nothing has been sent — press Send to answer the case.`,
  };
}
