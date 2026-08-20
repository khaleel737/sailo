import "server-only";
import { and, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, productVariants } from "@sailo/db/schema";

/**
 * The two statements everything else in this package is built on.
 *
 * They were in `inventory.ts`, next to the order-level movements — the restock,
 * the un-cancel, the abandoned-checkout sweep — and that was fine until an
 * event's capacity claim needed them too. `ticketing/capacity.ts` takes a
 * band's seats and then the room's, so it imports `reserveStock`; and
 * `restoreStock` gives a refunded ticket's seat back to its band, so it imports
 * `releaseEventCapacity`. Between them that is a cycle, and `import/no-cycle`
 * is right to refuse it.
 *
 * So the primitives live here, importing nothing but the schema, and both
 * layers above depend on this rather than on each other. `inventory.ts`
 * re-exports them, so every existing caller is untouched.
 *
 * A null quantity means nobody is counting, and Postgres carries that through
 * arithmetic untouched — `null - 2` is still null — so untracked rows fall out
 * of these statements on their own.
 */

export type StockLine = {
  productId: string | null;
  variantId: string | null;
  quantity: number;
  /**
   * The band and the date this line took a seat from — spec 50.
   *
   * Optional because the type is built by hand at half a dozen call sites and
   * absent means the same as null: an ordinary line, with nothing above the
   * product to give back. Present, they are the whole of why `order_items`
   * carries the two columns — a refunded VIP ticket has to return its seat to
   * VIP, and a unit put back on the room while `event_tiers.sold` stays at
   * thirty leaves the band sold out for ever with the room half empty.
   */
  tierId?: string | null;
  sessionId?: string | null;
};

/**
 * Takes units off the shelf, or reports that they weren't there. The guard is
 * part of the WHERE clause rather than a read followed by a write, so two
 * buyers racing for the last one can't both be told yes.
 */
export async function reserveStock(input: {
  productId: string;
  variantId: string | null;
  quantity: number;
  trackInventory: boolean;
}): Promise<boolean> {
  if (!input.trackInventory || input.quantity <= 0) return true;
  const db = getDb();

  if (input.variantId) {
    const rows = await db
      .update(productVariants)
      .set({
        stockQuantity: sql`${productVariants.stockQuantity} - ${input.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productVariants.id, input.variantId),
          or(
            isNull(productVariants.stockQuantity),
            gte(productVariants.stockQuantity, input.quantity),
          ),
        ),
      )
      .returning({ id: productVariants.id });
    return rows.length > 0;
  }

  const rows = await db
    .update(products)
    .set({
      stockQuantity: sql`${products.stockQuantity} - ${input.quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(products.id, input.productId),
        or(
          isNull(products.stockQuantity),
          gte(products.stockQuantity, input.quantity),
        ),
      ),
    )
    .returning({ id: products.id });
  return rows.length > 0;
}

/**
 * Puts units back, unconditionally. Used both to undo a half-reserved cart and
 * to restock a cancelled order — neither can be refused the way a purchase can.
 */
export async function releaseStock(line: StockLine) {
  const db = getDb();
  if (line.quantity <= 0) return;

  if (line.variantId) {
    /*
     * The same two conditions the product branch below applies, because
     * `reserveStock` never took these units in the first place: it returns
     * early for an untracked product, and a null count means nobody is
     * counting. Adding units back regardless drifts the number upward on
     * every cancel, refund and failed handoff — and the drift only becomes
     * visible the day a seller turns tracking on.
     *
     * Tracking lives on the parent product, so the variant is judged by it.
     */
    await db
      .update(productVariants)
      .set({
        stockQuantity: sql`${productVariants.stockQuantity} + ${line.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productVariants.id, line.variantId),
          isNotNull(productVariants.stockQuantity),
          sql`exists (select 1 from ${products} where ${products.id} = ${productVariants.productId} and ${products.trackInventory})`,
        ),
      );
    return;
  }

  if (!line.productId) return;
  await db
    .update(products)
    .set({
      stockQuantity: sql`${products.stockQuantity} + ${line.quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(products.id, line.productId),
        eq(products.trackInventory, true),
        isNotNull(products.stockQuantity),
      ),
    );
}
