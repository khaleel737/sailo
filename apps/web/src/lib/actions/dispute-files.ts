"use server";

/**
 * Taking a document back off a dispute.
 *
 * Attaching one is `POST /api/disputes/[id]/evidence` and deliberately not here:
 * a server action's request body is capped at 1 MB by default, and evidence runs
 * to 4.5 MB. Removing carries a dispute id and a field name, so it stays an
 * action — the mechanism should follow the payload, not the other way round.
 *
 * Both go through `authoriseDisputeFiles`, which is the point of that module
 * existing: two entry points to one capability must not be two answers to
 * "may you?".
 *
 * Outside `actions/hq/` on purpose, and the only dispute actions that are: every
 * other one is staff-only, and a seller-facing action filed under `hq/` reads to
 * the next person auditing this directory as something the allowlist guards.
 * These two are guarded by shop ownership instead, which is a different check
 * and has to look like one.
 */

import { revalidatePath } from "next/cache";
import { detachEvidenceFile } from "@sailo/commerce/disputes";
import { authoriseDisputeFiles } from "@/lib/dispute-access";
import type { ActionState } from "./shop";

async function detach(formData: FormData): Promise<ActionState> {
  const disputeId = String(formData.get("disputeId") ?? "").trim();
  const field = String(formData.get("field") ?? "").trim();

  const access = await authoriseDisputeFiles(disputeId, "seller");
  if (!access.ok) return { ok: false, error: access.error };

  const result = await detachEvidenceFile({ disputeId, field });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/payments");
  return { ok: true, message: "Removed. It will not be sent." };
}

/** A seller taking one back off their own case. */
export async function removeSellerDisputeFile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return detach(formData);
}
