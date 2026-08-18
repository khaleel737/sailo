import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputes, shops } from "@sailo/db/schema";
import { requireStaff } from "@/lib/session";

/**
 * Who may touch a dispute's documents, from this side.
 *
 * The staff half of what was `apps/web/src/lib/dispute-access.ts`. That module
 * answered for two callers — staff reaching any dispute, and a seller reaching
 * one of their own — behind a single `as: "staff" | "seller"` parameter. The
 * two halves now live in the two apps whose sessions they are about, which
 * removes the parameter and with it the class of bug it invited: a caller
 * passing the wrong string got the wrong guard, and nothing but the argument
 * stood between a seller's request and the staff branch.
 *
 * The seller half stayed in apps/web, where the seller's session is.
 *
 * `money:move` rather than a bare staff check: attaching or removing evidence
 * decides whether we contest a chargeback, and a contested case we lose costs
 * the disputed amount plus the fee. That is money moving, so support cannot do
 * it — see `can()` in `@sailo/security/staff`.
 */

export type DisputeAccess =
  | {
      ok: true;
      /** Who to stamp on the row. */
      actor: string;
      /** What the audit line is about, when the dispute belongs to a shop. */
      audit: { shopId: string; ownerId: string } | null;
      /** For rate limiting: the shop whose quota this spends. */
      shopId: string | null;
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

  const staff = await requireStaff("money:move");
  const shop = dispute.shopId
    ? await db.query.shops.findFirst({
        where: eq(shops.id, dispute.shopId),
        columns: { id: true, userId: true },
      })
    : undefined;

  return {
    ok: true,
    actor: staff.email,
    audit: shop ? { shopId: shop.id, ownerId: shop.userId } : null,
    shopId: shop?.id ?? null,
  };
}
