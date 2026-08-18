"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { applyToProgram } from "@sailo/partners/applications";
import type { ActionState } from "./shop";

/**
 * What a partner does to their own row.
 *
 * The staff half of this file — approve, reject, set a commission, run payouts,
 * change the programme's settings — moved to apps/hq with the panel that calls
 * it. It used to sit below, separated from this by a comment and a different
 * guard; it is now separated by being in another deployment, which is the same
 * rule enforced rather than described.
 *
 * The user id comes from the session and never from the form. A partner id is a
 * UUID in a hidden input, and treating one as authorisation would let any
 * signed-in user act on someone else's row.
 */

/* -------------------------------------------------------------------------- */
/*  What a partner does                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Files an application, for whoever is signed in.
 *
 * The user id comes from the session and never from the form. Auto-approval
 * for paying sellers happens inside `applyToProgram`, so this action doesn't
 * know or care which outcome it got — it revalidates and lets the page render
 * whichever state is now true.
 */
export async function applyToPartnerProgram(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Tell us what to call you." };

  const result = await applyToProgram({
    userId: user.id,
    name,
    website: String(formData.get("website") ?? ""),
    audience: String(formData.get("audience") ?? ""),
    pitch: String(formData.get("pitch") ?? ""),
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/partners");
  return {
    ok: true,
    message:
      result.status === "approved"
        ? "You're in. Your link is ready below."
        : "Application received — we'll email you when it's reviewed.",
  };
}
