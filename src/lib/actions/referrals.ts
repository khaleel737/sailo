"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shops, staffActions } from "@/db/schema";
import { markReferralsPaid } from "@/lib/hq/referrals";
import { requireStaff } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import type { ActionState } from "./shop";

/**
 * Marking a referrer's earnings as sent, from /hq.
 *
 * The transfer itself is a human going to Stripe or their bank; this only
 * records that it happened. Deliberately so for v1 — a programme that pays
 * itself out is worth building once the numbers have been watched for a few
 * months, and building it first would mean the first bug in the ledger sends
 * real money.
 *
 * Its own file rather than `actions/hq.ts`, whose three actions are all
 * things done *to* a seller's account. This is Sailo settling a debt.
 */
export async function markReferralPayout(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();

  const shopId = String(formData.get("shopId") ?? "").trim();
  if (!shopId) return { ok: false, error: "No referrer given." };

  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.id, shopId),
    columns: { id: true, name: true, handle: true },
  });
  if (!shop) return { ok: false, error: "That account no longer exists." };

  /*
   * The amount comes back from the rows the update actually stamped — never
   * from the form. A figure posted by a browser is a figure an operator was
   * looking at some minutes ago, and the gap between that and what is really
   * owed is the whole reason the balance is a sum of rows.
   */
  const paid = await markReferralsPaid(shopId);

  /*
   * Zero rows is the second press of a double-clicked button, and it is not
   * an error worth colouring red: the money went out on the first press and
   * the stamp on those rows still records when.
   */
  if (paid.rows === 0) {
    return { ok: true, message: "Already settled — nothing was left unpaid." };
  }

  const amount = formatMoney(paid.cents, paid.currency ?? "USD");
  await getDb().insert(staffActions).values({
    actorEmail: staff.email,
    action: "referral_payout",
    shopId: shop.id,
    summary: `Settled ${amount} of referral commission over ${paid.rows} row${
      paid.rows === 1 ? "" : "s"
    }.`,
  });

  revalidatePath("/hq/referrals");
  return { ok: true, message: `Settled ${amount} to ${shop.name}.` };
}
