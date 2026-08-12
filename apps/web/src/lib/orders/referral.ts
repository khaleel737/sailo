import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { affiliates, type Shop } from "@sailo/db/schema";
import { ensurePortalToken } from "@/lib/affiliate-portal";
import { maybeRow } from "@/lib/invariant";
import { generateCode } from "@sailo/core/pricing";
import { formatPercent } from "@sailo/core/pricing";

/**
 * The buyer's own referral link, offered right after they order.
 *
 * That moment is the one time we know for certain they think the shop is worth
 * buying from. Buyer-sourced affiliates start active; the seller can turn any
 * of them off from the admin.
 */

export async function referralFor(
  shop: Shop,
  name: string | null,
  email: string,
  base: string,
) {
  const db = getDb();

  let affiliate = await db.query.affiliates.findFirst({
    where: and(eq(affiliates.shopId, shop.id), eq(affiliates.email, email)),
  });

  if (!affiliate) {
    // Retry on the rare code collision rather than failing the order.
    for (let attempt = 0; attempt < 5 && !affiliate; attempt++) {
      const localPart = email.split("@")[0] ?? email;
      /*
       * `maybeRow`, because no row is the outcome this loop exists for.
       * `onConflictDoNothing` returns nothing precisely when the generated
       * code collided, which is the case the retry handles — `firstRow` threw
       * instead, and it threw here on the checkout path *after* the order was
       * already written.
       */
      const created = maybeRow(await db
        .insert(affiliates)
        .values({
          shopId: shop.id,
          name: name ?? localPart,
          email,
          code: generateCode(name ?? localPart),
          status: "active",
          source: "buyer",
        })
        .onConflictDoNothing({ target: [affiliates.shopId, affiliates.code] })
        .returning());
      affiliate = created;
    }
  }

  if (!affiliate || affiliate.status !== "active") return null;

  return {
    code: affiliate.code,
    url: `${base}/${shop.handle}?ref=${affiliate.code}`,
    percent: formatPercent(affiliate.commissionBp ?? shop.affiliateDefaultBp),
    // Without this the confirmation hands out a link to share but no way to
    // ever see what it earned — the report exists, and nothing pointed at it.
    portalUrl: `${base}/partner/${await ensurePortalToken(affiliate)}`,
  };
}

/**
 * Buyer submits the reference for a transfer they've already sent. Moves the
 * order to `pending` for the seller to confirm.
 */
