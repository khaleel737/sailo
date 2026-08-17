/**
 * A partner's own record of what they have been paid.
 *
 * Read-only and bounded — it backs the portal page a partner opens, which is the one view of
 * this data they can see for themselves.
 */

import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { partnerPayouts } from "@sailo/db/schema";

export async function getPartnerPayouts(partnerId: string, limit = 24) {
  return getDb()
    .select({
      id: partnerPayouts.id,
      amountCents: partnerPayouts.amountCents,
      currency: partnerPayouts.currency,
      status: partnerPayouts.status,
      failureReason: partnerPayouts.failureReason,
      initiatedBy: partnerPayouts.initiatedBy,
      createdAt: partnerPayouts.createdAt,
      paidAt: partnerPayouts.paidAt,
    })
    .from(partnerPayouts)
    .where(eq(partnerPayouts.partnerId, partnerId))
    .orderBy(sql`${partnerPayouts.createdAt} desc`)
    .limit(limit);
}
