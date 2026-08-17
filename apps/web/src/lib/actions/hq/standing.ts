"use server";

/**
 * A shop's standing: its plan, whether it is suspended, whether its marketing is paused.
 *
 * The three switches HQ throws that change what a shop may do, as opposed to what it may
 * access. Each one is reversible and each one is visible to the seller, which is what separates
 * them from the revocations in `./access`.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { isPlanId, PLANS } from "@sailo/core/plans";
import type { ActionState } from "../shop";
import { loadShop, record } from "./shared";


/**
 * Grants a plan we aren't charging for, or takes one back.
 *
 * Written to `compPlan`, never to `plan` — see the column's note. The seller
 * sees the features; they don't see a bill, because there isn't one.
 */
export async function setCompPlan(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const requested = String(formData.get("plan") ?? "none").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  if (requested === "none") {
    if (!shop.compPlan) {
      return { ok: false, error: "This account isn't comped." };
    }
    const previous = shop.compPlan;
    await getDb()
      .update(shops)
      .set({ compPlan: null, compNote: null, updatedAt: new Date() })
      .where(eq(shops.id, shop.id));

    await record(
      staff.email,
      "clear_comp",
      shop,
      `Removed the comped ${previous} plan — back to whatever Stripe says.`,
    );
    return { ok: true, message: "Comp removed." };
  }

  if (!isPlanId(requested) || requested === "free") {
    return { ok: false, error: "Pick a paid plan, or None to remove the comp." };
  }

  await getDb()
    .update(shops)
    .set({ compPlan: requested, compNote: note || null, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  await record(
    staff.email,
    "comp_plan",
    shop,
    `Comped ${PLANS[requested].name}${note ? ` — ${note}` : ""}.`,
  );
  return { ok: true, message: `${PLANS[requested].name} granted.` };
}

/**
 * Takes a shop off the air, or puts it back.
 *
 * Separate from the seller's own publish switch: they can turn that one back
 * on, and someone we suspended for fraud absolutely would.
 */
export async function setSuspended(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const suspend = String(formData.get("suspend") ?? "") === "1";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  if (suspend) {
    if (!reason) {
      return {
        ok: false,
        error: "Say why. Whoever reads this in six months won't remember.",
      };
    }
    await getDb()
      .update(shops)
      .set({
        suspendedAt: new Date(),
        suspendedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(shops.id, shop.id));

    await record(staff.email, "suspend", shop, `Suspended — ${reason}`);
    return { ok: true, message: "Shop suspended. It is offline now." };
  }

  await getDb()
    .update(shops)
    .set({ suspendedAt: null, suspendedReason: null, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  await record(staff.email, "unsuspend", shop, "Suspension lifted.");
  return { ok: true, message: "Shop is back online." };
}

/**
 * Stops this shop's marketing email, or lets it start again.
 *
 * Narrower than a suspension on purpose, and the two must not be confused. A
 * suspension takes the storefront down; this leaves the shop trading, selling
 * and sending receipts, and stops only the broadcasts. It is normally written
 * by `lib/broadcasts/reputation.ts` when a shop's bounce or complaint rate
 * crosses a threshold — this is the human end of that: the way it comes off,
 * and the way it goes on for a shop we have decided about before the numbers
 * have.
 *
 * Lifting it does not forgive the numbers. The rolling window is still what it
 * is, so the next bounce or complaint re-evaluates and can pause the shop
 * again within the minute. That is the intended behaviour — the pause is a
 * measurement, not a punishment to be served — and it is why lifting one
 * without fixing the list is not a way to get a bad send out.
 */
export async function setMarketingPaused(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const pause = String(formData.get("pause") ?? "") === "1";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  if (pause) {
    if (!reason) {
      return {
        ok: false,
        error: "Say why. Whoever reads this in six months won't remember.",
      };
    }
    await getDb()
      .update(shops)
      .set({
        marketingPausedAt: new Date(),
        marketingPausedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(shops.id, shop.id));

    await record(staff.email, "marketing_pause", shop, `Marketing paused — ${reason}`);
    return { ok: true, message: "Marketing sending stopped for this shop." };
  }

  await getDb()
    .update(shops)
    .set({
      marketingPausedAt: null,
      marketingPausedReason: null,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  await record(staff.email, "marketing_resume", shop, "Marketing pause lifted.");
  return { ok: true, message: "They can send marketing again." };
}
