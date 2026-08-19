"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { collectionItems, collections, orders } from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import { recordProgress } from "@sailo/commerce/content";
import { orderedProductIds } from "@/lib/downloads";
import { membershipOpenForOrder } from "@/lib/membership-access";

/**
 * The one public write spec 40 adds: a buyer marking a lesson done.
 *
 * ─── WHAT IT CAN AND CANNOT DO ─────────────────────────────────────────────
 *
 * It writes `content_progress` and nothing else. There is no branch here that
 * touches an order, a subscription, a file or a token, which is why "progress
 * cannot alter entitlement" is a property of the shape rather than a rule
 * somebody has to remember not to break.
 *
 * ─── AND HOW IT IS BOUNDED ─────────────────────────────────────────────────
 *
 * **Keyed on the token**, which already resolves to an order — the same
 * identity the download route uses, and never an email, which a shared address
 * would let one person use to read another's progress.
 *
 * **Rate-limited, failing closed.** Decision B: it is a public write, and it is
 * an existence oracle by construction — an unmetered version would answer
 * whether a given item id belongs to a given order, one guess at a time.
 *
 * **It re-asks the access question rather than assuming it.** A lapsed member
 * marking lessons complete writes nothing: `membershipOpenForOrder` is the same
 * predicate the streaming route runs on every byte, called here for the same
 * reason — the token lives in an inbox forever and entitlement is decided when
 * it is presented.
 */

export type ProgressState = { ok: boolean };

export async function markContentProgress(
  _prev: ProgressState,
  formData: FormData,
): Promise<ProgressState> {
  const token = String(formData.get("token") ?? "").trim();
  const itemId = String(formData.get("itemId") ?? "").trim();
  const completed = formData.get("completed") === "on";

  if (!token || !itemId) return { ok: false };

  /*
   * DECISION B — fails closed. A public write, and one whose answer would say
   * whether an item belongs to an order. Keyed on the token because the token
   * is what identifies the resource being spent, exactly as the download route
   * keys its own ceiling.
   */
  const gate = await rateLimit(`content-progress:${token}`, 120, 300, {
    onOutage: "closed",
  });
  if (!gate.allowed) return { ok: false };

  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: eq(orders.downloadToken, token),
  });
  if (!order) return { ok: false };

  /*
   * The same question the streaming route asks on every request, and asked here
   * for the same reason: the token was emailed once and lives in an inbox for
   * good, so entitlement is decided when it is presented rather than when it was
   * minted. A lapsed member's tap writes nothing.
   */
  if (!(await membershipOpenForOrder(order))) return { ok: false };
  if (!order.downloadReleasedAt) return { ok: false };

  /*
   * And the item has to belong to something this order actually bought. Without
   * it, anybody holding any token could seed a row naming another seller's
   * lesson — which grants nothing, and makes the table unreadable.
   */
  const productIds = await orderedProductIds(order);
  if (productIds.length === 0) return { ok: false };

  const [owner] = await db
    .select({ productId: collections.productId })
    .from(collectionItems)
    .innerJoin(collections, eq(collections.id, collectionItems.collectionId))
    .where(eq(collectionItems.id, itemId));

  /*
   * Every product on the order, not only the header's first line. A basket
   * holding two courses is one order with two collections, and gating on
   * `order.productId` would refuse the second — the header-vs-lines bug, on a
   * route a buyer uses constantly.
   */
  if (!owner || !productIds.includes(owner.productId)) return { ok: false };

  const result = await recordProgress({ orderId: order.id, itemId, completed });
  return { ok: result.ok };
}
