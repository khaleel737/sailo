import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputes, shops } from "@sailo/db/schema";
import { requireUser } from "@/lib/session";

/**
 * Who may touch a dispute's documents, from this side: the seller, and only
 * on their own case.
 *
 * The seller half of what was one module answering for two callers behind an
 * `as: "staff" | "seller"` parameter. The staff half lives in apps/hq now,
 * where the staff session is and where `requireStaff("money:move")` can be
 * asked — this app's `requireStaff` takes no capability, so a staff branch
 * kept here was a door around the capability model. Removing the branch
 * removes the parameter, and with it the class of bug it invited: a caller
 * passing the wrong string got the wrong guard.
 *
 * Shared by the upload route and the remove action, which are deliberately two
 * different mechanisms — see the route's own note — and must not therefore be
 * two different answers to "may you?". A check that lives in one of them is a
 * check the other can be made to skip.
 *
 * A seller may reach a dispute that is their own shop's **and** is a
 * `connected` dispute: their Sailo subscription chargeback is an argument
 * between them and us, and letting them file evidence on it would be letting
 * one side of a dispute submit for the other.
 */

export type DisputeAccess =
  | {
      ok: true;
      /** Who to stamp on the row: the seller's own address. */
      actor: string;
      /** For rate limiting: the shop whose quota this spends. */
      shopId: string;
    }
  | { ok: false; error: string };

export async function authoriseDisputeFiles(
  disputeId: string,
): Promise<DisputeAccess> {
  const db = getDb();
  const dispute = await db.query.disputes.findFirst({
    where: eq(disputes.id, disputeId),
  });
  if (!dispute) return { ok: false, error: "That dispute no longer exists." };

  const user = await requireUser();
  if (dispute.scope !== "connected" || !dispute.shopId) {
    return { ok: false, error: "That dispute is not yours to answer." };
  }
  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, dispute.shopId),
    columns: { id: true, userId: true },
  });
  /*
   * Ownership from the row, never from the request. A seller posting somebody
   * else's dispute id is the whole of the attack here, and it would otherwise
   * put their document on a stranger's case — or, worse, let them read one back
   * through the preview link.
   */
  if (!shop || shop.userId !== user.id) {
    return { ok: false, error: "That dispute is not yours to answer." };
  }
  /*
   * No audit entry. `staffActions` records HQ reaching into somebody else's
   * money, and a seller attaching a document to their own case is not that — a
   * row there would read, months later, as staff having uploaded it. Who
   * uploaded is already on `disputeEvidenceFiles.uploadedBy`, which is where a
   * question about this document is actually asked.
   */
  return { ok: true, actor: user.email ?? user.id, shopId: shop.id };
}
