import "server-only";
import { deleteAccountFor as runDeletion } from "@sailo/account/deletion";
import type { DeletionResult } from "@sailo/account/deletion";
import { sendAccountDeleted } from "@/lib/email";
import { updateShopNow } from "@/lib/cache";

/**
 * Account deletion, now in `@sailo/account/deletion`.
 *
 * The App Store requires an app that offers sign-up to offer deletion, so the
 * phone has to run *this* deletion rather than something shaped like it — and
 * `packages/api` cannot import `apps/web`. What could not travel with it are
 * the two steps that are web's alone: the farewell email, whose catalogue is
 * still in this app, and the cache drop, which needs Next's request scope.
 * Both are passed in here, so a deletion started from the admin does exactly
 * what it did before this move.
 *
 * Everything else — the obligations refusal, the tombstone, the ledger
 * retention, the order the steps run in — is the package's, and is the same
 * code both callers run.
 */

export async function deleteAccountFor(userId: string): Promise<DeletionResult> {
  return runDeletion(userId, {
    notifyDeleted: sendAccountDeleted,
    dropCaches: updateShopNow,
  });
}

export { openObligations, tombstoneEmail, tombstoneHandle } from "@sailo/account/deletion";
export type { DeletionResult } from "@sailo/account/deletion";
