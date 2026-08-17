/**
 * Everything that is not the money record.
 */

import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  account,
  affiliates,
  categories,
  clients,
  coupons,
  deliveryMethods,
  paymentMethods,
  products,
  reviews,
  supportTickets,
  visits,
} from "@sailo/db/schema";

/**
 * Everything that is not the money record.
 *
 * Deleting `products` cascades to variants, images, files, reviews, booking
 * claims and visits, and sets `orders.productId` / `orderItems.productId` to
 * null — which loses nothing, because the order already snapshots the title,
 * variant label, SKU and price it sold at.
 *
 * `clients` are deliberately kept: buyers did not ask to be deleted, and the
 * order rows that document their purchases point at them.
 */
export async function hardDeleteShopContent(shopId: string, userId: string): Promise<void> {
  const db = getDb();

  await db.delete(products).where(eq(products.shopId, shopId));
  await db.delete(categories).where(eq(categories.shopId, shopId));
  await db.delete(coupons).where(eq(coupons.shopId, shopId));
  await db.delete(affiliates).where(eq(affiliates.shopId, shopId));
  await db.delete(deliveryMethods).where(eq(deliveryMethods.shopId, shopId));
  /*
   * Payment methods hold the seller's own bank details — account number, IBAN,
   * SWIFT. Not in the spec's list, and deleted anyway: keeping a departed
   * seller's banking credentials in a table forever is not a defensible thing
   * to do with them.
   */
  await db.delete(paymentMethods).where(eq(paymentMethods.shopId, shopId));
  await db.delete(reviews).where(eq(reviews.shopId, shopId));
  await db.delete(visits).where(eq(visits.shopId, shopId));
  await db.delete(supportTickets).where(eq(supportTickets.shopId, shopId));

  // Auth rows: the password, any OAuth links, and the 2FA secret. `two_factor`
  // also cascades from `user`, but the user row survives here — so it has to
  // be said explicitly or an enrolled secret outlives the account.
  await db.delete(account).where(eq(account.userId, userId));
  await db.execute(sql`DELETE FROM "two_factor" WHERE "user_id" = ${userId}`);

  // Left standing on purpose: `orders`, `orderItems`, `invoices`, `tickets`
  // and `clients` — the ledger and the buyers it belongs to.
  void clients;
}
