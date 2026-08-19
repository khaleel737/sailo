"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/session";
import { rateLimit } from "@sailo/rate-limit";
import type { ActionState } from "@sailo/core/action-state";

/**
 * Accepting an invitation — spec 37.
 *
 * Its own module rather than a function in `team.ts`, because everything there
 * is guarded by `requireShop("team:write")` and this one cannot be: the person
 * accepting is, by definition, not yet a member of the shop they are joining.
 * Putting it beside them would be one import away from somebody adding the
 * guard "for consistency" and breaking the only path in.
 *
 * `requireUser` is the guard that does apply: an invitation is accepted as a
 * person, and the plugin matches the invitation's address against the session's
 * — so the link alone is not enough, which is what keeps a forwarded email from
 * being a way into somebody else's shop.
 */
export async function acceptTeamInvitation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) return { ok: false, error: "That link is incomplete." };

  /*
   * DECISION B — fails closed. An invitation id is a bearer credential, so an
   * unmetered accept endpoint is a way to walk ids looking for a live one.
   * Keyed on the *user*, because that is who is spending the attempts.
   */
  const gate = await rateLimit(`invite-accept:${user.id}`, 10, 3_600, {
    onOutage: "closed",
  });
  if (!gate.allowed) {
    return { ok: false, error: "Too many attempts. Try again in a little while." };
  }

  try {
    await auth.api.acceptInvitation({
      body: { invitationId },
      headers: await headers(),
    });
  } catch (error) {
    console.warn(`[sailo] invitation ${invitationId} not accepted`, error);
    /*
     * One sentence for every failure — wrong account, expired, cancelled,
     * already used, no such id. The page already told them which address the
     * invitation was for, which is the only one of those they can act on.
     */
    return { ok: false, error: "This invitation is no longer open." };
  }

  return { ok: true, message: "You're in." };
}
