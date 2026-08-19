import "server-only";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  orderItems,
  orders,
  productVariants,
  products,
  stockRequests,
  type StockRequest,
} from "@sailo/db/schema";
import { normalizeContact, preorderLimit } from "@sailo/core/preorders";

/**
 * The queue for something there is none of, and the ceiling on selling it
 * anyway — spec 33.
 *
 * TWO THINGS THIS MODULE WILL NOT DO
 *
 * It will not tell a caller whether a row was written, and it will not tell a
 * caller whether a variant exists. Both writes here are public and
 * unauthenticated, so an answer that varied would be a way to test which of a
 * seller's variants exist and who is watching them. `requestStock` answers the
 * same thing whether the row was new, already there, or refused — the caller
 * renders one sentence.
 *
 * It will not send anything. `claimNotifications` hands back the rows it won
 * and stops; who is emailed, under which preference and against which daily
 * ceiling, is `@sailo/workflows`, which knows about mail.
 */

/* -------------------------------------------------------------------------- */
/*  Joining the queue                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Records that somebody wants telling, once.
 *
 * Returns nothing at all, and that is the design rather than laziness. The one
 * fact a caller could usefully report — "you'll hear from us" — is true whether
 * or not a row was written, and every other outcome (this variant is not real,
 * this contact is already waiting, this product belongs to another shop) is
 * something the caller must not be able to distinguish.
 *
 * `onConflictDoNothing` is what makes a second submission free. The two partial
 * unique indexes behind it hold "one open request per contact per variant", and
 * both carry `NULLS NOT DISTINCT` — without which the constraint would not fire
 * for a product sold as one thing, where `variant_id` is null.
 *
 * The variant is checked against the product rather than trusted, because a
 * request body can pair any two ids: without it, one shop's product could be
 * joined to another's variant and the notification would go out on a restock
 * nobody here can see.
 */
export async function requestStock(input: {
  shopId: string;
  productId: string;
  variantId?: string | null;
  email?: string | null;
  phone?: string | null;
  locale?: string | null;
}): Promise<void> {
  const contact = normalizeContact(input);
  if (!contact) return;

  const db = getDb();

  /*
   * The product has to be this shop's, published, and the variant has to be
   * this product's. Three conditions, one query, and the answer is discarded on
   * failure rather than reported — see the header.
   */
  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, input.productId),
      eq(products.shopId, input.shopId),
      eq(products.isPublished, true),
    ),
    columns: { id: true },
  });
  if (!product) return;

  let variantId: string | null = null;
  if (input.variantId) {
    const variant = await db.query.productVariants.findFirst({
      where: and(
        eq(productVariants.id, input.variantId),
        eq(productVariants.productId, input.productId),
      ),
      columns: { id: true },
    });
    // A variant id that is not this product's is dropped rather than refused:
    // the request still means "tell me about this product", and refusing would
    // answer a question about which ids are real.
    variantId = variant?.id ?? null;
  }

  await db
    .insert(stockRequests)
    .values({
      shopId: input.shopId,
      productId: input.productId,
      variantId,
      email: contact.email,
      phone: contact.phone,
      locale: input.locale?.slice(0, 12) ?? null,
    })
    .onConflictDoNothing();
}

/* -------------------------------------------------------------------------- */
/*  Being told                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Claims every request owed for one variant, oldest first.
 *
 * The claim, and the whole of the once-ever guarantee. `notified_at is null` in
 * the WHERE means that of any number of concurrent restocks — a seller editing
 * stock while a refund puts units back — exactly one caller receives each row.
 * The rows come back so the caller can send; a row that comes back and is then
 * not sent is a message lost, which is the failure direction this is chosen for:
 * the other way round is messaging the same person twice in three days, which
 * is what gets a sending domain reported.
 *
 * `is not distinct from`, not `=`. `variant_id` is null for a product sold as
 * one thing and `null = null` is null, so an `=` here would claim nothing at
 * all for exactly those products — silently, for ever.
 *
 * Oldest first, and the seller's screen says so. If forty people are waiting
 * for twelve units, "I asked first" is the only fair reading that does not need
 * explaining.
 */
export async function claimStockNotifications(
  productId: string,
  variantId: string | null,
): Promise<StockRequest[]> {
  const db = getDb();

  return db
    .update(stockRequests)
    .set({ notifiedAt: new Date() })
    .where(
      and(
        eq(stockRequests.productId, productId),
        sql`${stockRequests.variantId} is not distinct from ${variantId}`,
        isNull(stockRequests.notifiedAt),
      ),
    )
    .returning();
}

/**
 * Which variants of a product currently have somebody waiting.
 *
 * Asked before anything is claimed, so a restock that moved one combination
 * does not have to walk every combination's queue. Reads rather than claims —
 * conflating the two is how a screen that shows "23 waiting" quietly spends the
 * notifications it is counting.
 */
export async function owedVariants(productId: string): Promise<(string | null)[]> {
  const rows = await getDb()
    .selectDistinct({ variantId: stockRequests.variantId })
    .from(stockRequests)
    .where(
      and(eq(stockRequests.productId, productId), isNull(stockRequests.notifiedAt)),
    );
  return rows.map((row) => row.variantId);
}

/* -------------------------------------------------------------------------- */
/*  The seller's list                                                          */
/* -------------------------------------------------------------------------- */

export type WaitingContact = StockRequest & {
  productTitle: string;
  variantLabel: string | null;
};

/**
 * Who is waiting, for the seller's own screen.
 *
 * Oldest first, matching the order they will be told in, because a list that
 * sorted differently from the send would have a seller reading two different
 * answers to "who is next".
 *
 * **A number about their shop, not about people.** The screen shows "23
 * waiting" and the contacts; nothing anywhere shows a *buyer* that 23 others
 * are waiting, which would be a nudge built out of somebody else's data.
 */
export async function waitingFor(
  shopId: string,
  opts: { productId?: string; limit?: number } = {},
): Promise<WaitingContact[]> {
  const db = getDb();

  const rows = await db
    .select({
      request: stockRequests,
      productTitle: products.title,
      variantOptions: productVariants.options,
    })
    .from(stockRequests)
    .innerJoin(products, eq(products.id, stockRequests.productId))
    .leftJoin(productVariants, eq(productVariants.id, stockRequests.variantId))
    .where(
      and(
        eq(stockRequests.shopId, shopId),
        isNull(stockRequests.notifiedAt),
        ...(opts.productId ? [eq(stockRequests.productId, opts.productId)] : []),
      ),
    )
    .orderBy(asc(stockRequests.createdAt))
    .limit(opts.limit ?? 200);

  return rows.map((row) => ({
    ...row.request,
    productTitle: row.productTitle,
    variantLabel: row.variantOptions
      ? Object.values(row.variantOptions).filter(Boolean).join(" / ")
      : null,
  }));
}

/* -------------------------------------------------------------------------- */
/*  The preorder ceiling                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whether one more preorder may be taken for this combination.
 *
 * Counted against *open* preorders — placed, not yet shipped, not cancelled or
 * refunded — because the ceiling is about what the seller has undertaken to
 * make, and an order they refunded is an undertaking that ended.
 *
 * WHY THIS IS A COUNT AND NOT A COLUMN
 *
 * A `preordersTaken` counter would be a second number to keep in step with the
 * orders themselves, and every cancellation, refund and sweep would have to
 * remember to move it — the shape that leaves a shop unable to sell because a
 * counter drifted upward and nothing can see why. Counting the orders is
 * slower and cannot be wrong.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not make the ceiling race-free on its own, and the caller must not
 * treat it as though it did: two buyers arriving in the same second both read
 * the same count. The claim that actually decides is in `createOrderIntent`,
 * where the count is re-taken *after* the order row exists — so the n+1th
 * buyer's own order is in the count that refuses it, and the loser is rolled
 * back like a failed coupon claim. This is the cheap check that stops the
 * common case before anything is written.
 */
export async function preorderRoom(input: {
  productId: string;
  variantId: string | null;
  product: Parameters<typeof preorderLimit>[0];
  variant?: Parameters<typeof preorderLimit>[1];
  /** An order to exclude — its own, when re-checking after the insert. */
  exceptOrderId?: string;
}): Promise<{ limited: false } | { limited: true; limit: number; taken: number }> {
  const limit = preorderLimit(input.product, input.variant);
  if (limit === null) return { limited: false };

  const db = getDb();

  const [row] = await db
    .select({ taken: count() })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.productId, input.productId),
        input.variantId
          ? eq(orderItems.variantId, input.variantId)
          : isNull(orderItems.variantId),
        eq(orders.isPreorder, true),
        /*
         * Open ones only. A cancelled or refunded preorder is an undertaking
         * that ended, and holding its place would mean a seller who refunded
         * one buyer could never sell that slot again.
         */
        sql`${orders.status} not in ('cancelled', 'refunded')`,
        ...(input.exceptOrderId ? [sql`${orders.id} <> ${input.exceptOrderId}`] : []),
      ),
    );

  const taken = row?.taken ?? 0;
  return taken >= limit ? { limited: true, limit, taken } : { limited: false };
}
