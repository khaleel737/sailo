"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@sailo/db";
import { staffActions } from "@sailo/db/schema";
import { requireStaff } from "@/lib/session";
import {
  approvePartner,
  getPartnerById,
  setPartnerCommission,
  setPartnerNotes,
  setPartnerStatus,
} from "@sailo/partners/applications";
import { payPartner, runPayouts } from "@sailo/partners/payouts";
import { markPaidManually } from "@/lib/platform/partners";
import { updateProgramSettings } from "@sailo/partners/settings";
import { isPartnerStatus, shareLabel } from "@sailo/partners/program";
import { formatMoney } from "@sailo/core/currency";
import type { ActionState } from "@sailo/core/action-state";

/**
 * Everything staff do to the partner programme.
 *
 * This was the second half of `apps/web/src/lib/actions/partner-program.ts`,
 * whose header explained that it held "two audiences in one file, kept apart by
 * their guard" — a partner acting on their own row behind `requireUser()`, and
 * staff acting on anyone's behind `requireStaff()`. That separation is now a
 * deployment boundary rather than a paragraph, which is the stronger version of
 * the same idea: the seller app no longer contains these functions at all, so
 * there is no longer a way to reach one without the staff session this app
 * requires to serve any route.
 *
 * `applyToPartnerProgram` stayed in apps/web, where the partner who calls it is.
 *
 * WHY ALL BUT ONE OF THESE ARE `money:move`
 * Paying a partner obviously is. So is approving one — the decision commits us
 * to a commission on every sale they ever refer — and so is setting their rate,
 * which is the same commitment with a number on it. Only `savePartnerNotes` is
 * not, because a note about a partner is a note. The deployment boundary above
 * decides whether these functions are reachable at all; the capability decides
 * which staff member gets to spend money once they are.
 */

/** Writes the audit line every staff decision leaves behind. */
async function audit(actorEmail: string, action: string, summary: string) {
  await getDb().insert(staffActions).values({
    actorEmail,
    action,
    // Partner decisions are not about a shop, and most partners don't have
    // one. The column is nullable precisely so this can be honest about that.
    shopId: null,
    summary,
  });
}

/**
 * Approve, reject, suspend or requeue one partner.
 *
 * One action for all four because they are one decision with four answers, and
 * splitting them would mean four near-identical guards, four audit lines and
 * four chances for one of them to forget `requireStaff`.
 */
export async function decidePartner(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("money:move");

  const partnerId = String(formData.get("partnerId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!partnerId) return { ok: false, error: "No partner given." };
  if (!isPartnerStatus(decision)) {
    return { ok: false, error: "That isn't a decision." };
  }

  const partner = await getPartnerById(partnerId);
  if (!partner) return { ok: false, error: "That partner no longer exists." };

  if (decision === "approved") {
    const code = await approvePartner(partnerId, staff.email, note);
    await audit(
      staff.email,
      "partner_approved",
      `Approved ${partner.name} as a partner (code ${code}).`,
    );
  } else {
    await setPartnerStatus({
      partnerId,
      status: decision,
      actorEmail: staff.email,
      note,
    });
    await audit(
      staff.email,
      `partner_${decision}`,
      `Set ${partner.name} to ${decision}${note ? ` — ${note}` : "."}`,
    );
  }

  revalidatePath("/partners");
  revalidatePath(`/partners/${partnerId}`);
  return { ok: true, message: `${partner.name} is now ${decision}.` };
}

/**
 * Moves one partner onto a negotiated rate, or back onto the programme's.
 *
 * An empty field means "use the default" rather than "zero", which is why the
 * blank is turned into null before it reaches the store. A deliberate 0% is
 * set by typing 0.
 */
export async function setPartnerRate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("money:move");

  const partnerId = String(formData.get("partnerId") ?? "").trim();
  if (!partnerId) return { ok: false, error: "No partner given." };

  const partner = await getPartnerById(partnerId);
  if (!partner) return { ok: false, error: "That partner no longer exists." };

  const raw = String(formData.get("percent") ?? "").trim();
  if (raw && Number.isNaN(Number(raw))) {
    return { ok: false, error: "That isn't a percentage." };
  }

  const bp = raw === "" ? null : Math.round(Number(raw) * 100);
  if (bp !== null && (bp < 0 || bp > 10_000)) {
    return { ok: false, error: "A rate has to be between 0% and 100%." };
  }

  await setPartnerCommission(partnerId, bp);
  await audit(
    staff.email,
    "partner_rate",
    bp === null
      ? `Put ${partner.name} back on the programme's default rate.`
      : `Set ${partner.name}'s rate to ${shareLabel(bp)}.`,
  );

  revalidatePath(`/partners/${partnerId}`);
  return {
    ok: true,
    message: bp === null ? "Back on the default rate." : `Rate set to ${shareLabel(bp)}.`,
  };
}

/** HQ's private note on a partner. Never shown to them. */
export async function savePartnerNotes(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff("notes:write");

  const partnerId = String(formData.get("partnerId") ?? "").trim();
  if (!partnerId) return { ok: false, error: "No partner given." };

  await setPartnerNotes(partnerId, String(formData.get("notes") ?? ""));
  revalidatePath(`/partners/${partnerId}`);
  return { ok: true, message: "Saved." };
}

/**
 * Sends one partner their balance now, rather than waiting for the run.
 *
 * The amount is never taken from the form — `payPartner` claims the ledger
 * rows and transfers what it actually claimed. A figure posted by a browser is
 * a figure an operator was looking at some minutes ago.
 */
export async function payPartnerNow(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("money:move");

  const partnerId = String(formData.get("partnerId") ?? "").trim();
  const currency = String(formData.get("currency") ?? "USD").trim();
  if (!partnerId) return { ok: false, error: "No partner given." };

  const result = await payPartner({
    partnerId,
    currency,
    initiatedBy: "manual",
    initiatedByEmail: staff.email,
  });

  revalidatePath("/partners");
  revalidatePath("/partners/payouts");
  revalidatePath(`/partners/${partnerId}`);

  if (!result.ok) return { ok: false, error: result.reason };

  const amount = formatMoney(result.amountCents, result.currency);
  await audit(staff.email, "partner_payout", `Sent ${amount} to a partner (${result.transferId}).`);
  return { ok: true, message: `Sent ${amount}.` };
}

/**
 * Settles a balance that was paid outside Stripe.
 *
 * The escape hatch for a wire, a correction, or a partner in a country Connect
 * can't reach. It stamps rows and writes a `paid` payout row for the record; it
 * moves no money, which is the entire point and is said plainly on the button.
 */
export async function markPartnerPaidManually(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("money:move");

  const partnerId = String(formData.get("partnerId") ?? "").trim();
  if (!partnerId) return { ok: false, error: "No partner given." };

  const partner = await getPartnerById(partnerId);
  if (!partner) return { ok: false, error: "That partner no longer exists." };

  const paid = await markPaidManually(partnerId, staff.email);

  // Zero rows is the second press of a double-clicked button, and it is not an
  // error worth colouring red: the first press stamped them.
  if (paid.rows === 0) {
    return { ok: true, message: "Already settled — nothing was left unpaid." };
  }

  const amount = formatMoney(paid.cents, paid.currency ?? "USD");
  await audit(
    staff.email,
    "partner_payout_manual",
    `Marked ${amount} settled off-Stripe for ${partner.name} over ${paid.rows} row${
      paid.rows === 1 ? "" : "s"
    }.`,
  );

  revalidatePath("/partners");
  revalidatePath(`/partners/${partnerId}`);
  return { ok: true, message: `Marked ${amount} settled.` };
}

/** Runs the whole payout batch by hand, from the payouts page. */
export async function runPayoutsNow(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("money:move");

  const run = await runPayouts({
    initiatedBy: "manual",
    initiatedByEmail: staff.email,
  });

  await audit(
    staff.email,
    "partner_payout_run",
    `Ran partner payouts by hand: ${run.paid} paid, ${run.failed} failed, ` +
      `${formatMoney(run.totalCents, "USD")} sent.`,
  );

  revalidatePath("/partners");
  revalidatePath("/partners/payouts");

  if (run.attempted === 0) {
    return { ok: true, message: "Nobody was over the minimum." };
  }

  const sent = formatMoney(run.totalCents, "USD");
  return {
    ok: run.failed === 0,
    message: `${run.paid} paid, ${sent} sent.`,
    ...(run.failed > 0
      ? { error: `${run.failed} failed — see the history below.` }
      : {}),
  };
}

/**
 * Saves the programme's terms.
 *
 * Worth restating because it is the thing an operator will fear: changing the
 * rate here changes what the *next* invoice earns and touches no existing
 * ledger row. Every earning records the rate it was computed at.
 */
export async function saveProgramSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("money:move");

  const num = (key: string) => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw === "" ? undefined : Number(raw);
  };

  const percent = num("commissionPercent");
  if (percent !== undefined && Number.isNaN(percent)) {
    return { ok: false, error: "That isn't a percentage." };
  }

  const minimum = num("payoutMinimum");
  if (minimum !== undefined && Number.isNaN(minimum)) {
    return { ok: false, error: "That isn't an amount." };
  }

  const next = await updateProgramSettings(
    {
      acceptingApplications: formData.get("acceptingApplications") === "on",
      autoApproveSellers: formData.get("autoApproveSellers") === "on",
      autoPayout: formData.get("autoPayout") === "on",
      ...(percent === undefined ? {} : { commissionBp: Math.round(percent * 100) }),
      ...(minimum === undefined
        ? {}
        : { payoutMinimumCents: Math.round(minimum * 100) }),
      ...(num("cookieDays") === undefined ? {} : { cookieDays: num("cookieDays") }),
      ...(num("holdDays") === undefined ? {} : { holdDays: num("holdDays") }),
      ...(num("payoutDayOfMonth") === undefined
        ? {}
        : { payoutDayOfMonth: num("payoutDayOfMonth") }),
      terms: String(formData.get("terms") ?? ""),
    },
    staff.email,
  );

  await audit(
    staff.email,
    "partner_settings",
    `Partner programme: ${shareLabel(next.commissionBp)}, ` +
      `${formatMoney(next.payoutMinimumCents, "USD")} minimum, ` +
      `${next.holdDays}-day hold, ${next.cookieDays}-day cookie, ` +
      `auto-payout ${next.autoPayout ? "on" : "off"}.`,
  );

  revalidatePath("/partners/settings");
  revalidatePath("/partners");
  return { ok: true, message: "Saved." };
}
