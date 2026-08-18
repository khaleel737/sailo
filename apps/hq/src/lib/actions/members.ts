"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@sailo/core/action-state";
import { isStaffRole, STAFF_ROLES } from "@sailo/security/staff";
import { recordStaffAction } from "@sailo/security/audit";
import { inviteStaff, revokeStaff, setStaffRole } from "@sailo/security/roster";
import { requireStaff } from "@/lib/session";

/**
 * Managing who works here.
 *
 * Every action opens with `requireStaff("members:manage")`, which only `owner`
 * holds. That is the one capability an admin deliberately does not have: a
 * compromised admin session can already do a great deal of damage, and the
 * thing that must stay out of its reach is the ability to *keep* the access —
 * to invite a second address, or to promote itself. An account that cannot
 * extend its own reach is an account whose damage ends when it is revoked.
 *
 * Every action also writes a `staffActions` row. Access changes are the one
 * category of staff act nobody else witnesses — a refund shows up in Stripe and
 * a suspension shows up on the seller's screen, but adding a colleague is
 * invisible unless it is written down.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("That doesn't look like an email address."));

const role = z.string().refine(isStaffRole, {
  message: `Pick one of: ${STAFF_ROLES.join(", ")}.`,
});

const inviteInput = z.object({
  email,
  role,
  note: z.string().trim().max(200).optional(),
});

/**
 * Add someone, or bring a revoked colleague back.
 *
 * No email is sent from here, deliberately. `inviteStaff` writes the row, and
 * that row is the entire grant — the person then signs in at `/login` like
 * anyone else and the magic link works because the roster now says it may. An
 * "invitation email" would be a second, weaker credential: a link that grants
 * access on click, sitting in an inbox, doing what the ordinary sign-in already
 * does. Tell them by whatever means you already talk to them.
 */
export async function inviteMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireStaff("members:manage");

  const parsed = inviteInput.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { email: address, role: newRole, note } = parsed.data;

  await inviteStaff({
    email: address,
    role: newRole,
    invitedByEmail: actor.email,
    note: note ?? null,
  });
  await recordStaffAction({
    actorEmail: actor.email,
    action: "staff.invited",
    shopId: null,
    summary: `Added ${address} as ${newRole}.`,
  });

  revalidatePath("/members");
  return { ok: true, message: `${address} can sign in now, as ${newRole}.` };
}

/**
 * End someone's access.
 *
 * `revokeStaff` deletes their live sessions as well as marking the row, and the
 * count comes back so this can say so. "Revoked" that waits for a cookie to
 * expire is not revoked, and the person clicking this is usually clicking it
 * because they need it to be true right now.
 */
export async function revokeMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireStaff("members:manage");

  const parsed = email.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, error: "Unknown member." };
  const address = parsed.data;

  /*
   * Refusing self-revocation is not paternalism about mistakes — it is about
   * the roster ending up with nobody who can edit it. An owner who removes
   * themselves while they are the only owner locks the whole company out of the
   * panel, recoverable only by editing `SAILO_STAFF_EMAILS` and redeploying.
   * Someone else can always revoke them, which is the safer shape anyway.
   */
  if (address === actor.email) {
    return { ok: false, error: "You can't revoke yourself — ask another owner." };
  }

  const { sessionsEnded } = await revokeStaff({
    email: address,
    revokedByEmail: actor.email,
  });
  await recordStaffAction({
    actorEmail: actor.email,
    action: "staff.revoked",
    shopId: null,
    summary:
      `Revoked ${address}` +
      (sessionsEnded ? `, ending ${sessionsEnded} live session${sessionsEnded === 1 ? "" : "s"}.` : "."),
  });

  revalidatePath("/members");
  return {
    ok: true,
    message: sessionsEnded
      ? `${address} is out. ${sessionsEnded} live session${sessionsEnded === 1 ? "" : "s"} ended.`
      : `${address} is out.`,
  };
}

/** Change what someone may do. Active members only — see `setStaffRole`. */
export async function changeMemberRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireStaff("members:manage");

  const parsed = z
    .object({ email, role })
    .safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const { email: address, role: newRole } = parsed.data;

  /*
   * Same reasoning as self-revocation: the last owner demoting themselves
   * leaves a roster nobody can edit. Cheaper to refuse than to build the
   * "are you the last owner" count and race on it.
   */
  if (address === actor.email) {
    return { ok: false, error: "You can't change your own role." };
  }

  await setStaffRole({ email: address, role: newRole });
  await recordStaffAction({
    actorEmail: actor.email,
    action: "staff.role_changed",
    shopId: null,
    summary: `Set ${address} to ${newRole}.`,
  });

  revalidatePath("/members");
  return { ok: true, message: `${address} is now ${newRole}.` };
}
