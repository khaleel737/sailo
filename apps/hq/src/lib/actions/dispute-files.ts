"use server";

/**
 * Taking a document back off a dispute, as staff.
 *
 * Attaching one is a route handler rather than an action, and deliberately: a
 * Server Action's request body is capped at 1 MB by default and evidence runs
 * to 4.5 MB. Removing carries a dispute id and a field name, so it stays an
 * action — the mechanism follows the payload, not the other way round.
 *
 * The seller's version of this — `removeSellerDisputeFile` — stayed in apps/web
 * with the seller session it checks. The two used to be one function behind an
 * `as: "staff" | "seller"` flag; they are now two functions in two apps, which
 * is the same distinction drawn where it cannot be passed wrongly.
 */

import { revalidatePath } from "next/cache";
import { detachEvidenceFile } from "@sailo/commerce/disputes";
import type { ActionState } from "@sailo/core/action-state";
import { authoriseDisputeFiles } from "@/lib/dispute-access";

/** Staff removing a document before the answer goes to Stripe. */
export async function removeDisputeFile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const disputeId = String(formData.get("disputeId") ?? "").trim();
  const field = String(formData.get("field") ?? "").trim();

  const access = await authoriseDisputeFiles(disputeId);
  if (!access.ok) return { ok: false, error: access.error };

  const result = await detachEvidenceFile({ disputeId, field });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/disputes/${disputeId}`);
  revalidatePath("/disputes");
  return { ok: true, message: "Removed. It will not be sent." };
}
