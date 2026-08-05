import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { affiliates, type Shop } from "@/db/schema";
import { firstRow } from "@/lib/invariant";
import { generateCode, normalizeCode } from "@/lib/pricing";
import { formatPercent } from "@/lib/pricing";

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
      const created = firstRow(await db
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
        .returning(), "created");
      affiliate = created;
    }
  }

  if (!affiliate || affiliate.status !== "active") return null;

  return {
    code: affiliate.code,
    url: `${base}/${shop.handle}?ref=${affiliate.code}`,
    percent: formatPercent(affiliate.commissionBp ?? shop.affiliateDefaultBp),
  };
}

/**
 * Buyer submits the reference for a transfer they've already sent. Moves the
 * order to `pending` for the seller to confirm.
 */
