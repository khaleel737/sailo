import "server-only";
import { and, asc, eq, gte, isNull, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  orderItems,
  orders,
  products,
  productVariants,
  type Order,
} from "@/db/schema";

/**
 * Stock movements. A null quantity means nobody is counting, and Postgres
 * carries that through arithmetic untouched — `null - 2` is still null — so
 * untracked rows fall out of these statements on their own.
 */

export type StockLine = {
  productId: string | null;
  variantId: string | null;
  quantity: number;
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
    await db
      .update(productVariants)
      .set({
        stockQuantity: sql`${productVariants.stockQuantity} + ${line.quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(productVariants.id, line.variantId));
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

/**
 * The lines an order took off the shelf. Falls back to the header columns for
 * rows written before orders could hold more than one product.
 */
async function stockLinesFor(order: Order): Promise<StockLine[]> {
  const items = await getDb().query.orderItems.findMany({
    where: eq(orderItems.orderId, order.id),
    orderBy: [asc(orderItems.position)],
  });

  if (items.length > 0) {
    return items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
    }));
  }

  return [
    { productId: order.productId, variantId: order.variantId, quantity: order.quantity },
  ];
}

/**
 * Puts a cancelled or refunded order's units back. `restockedAt` is claimed in
 * the same statement that reads it, so a seller clicking twice — or cancelling
 * an order that was already refunded — can't restock it twice.
 */
export async function restoreStock(order: Order): Promise<boolean> {
  const db = getDb();

  const [claimed] = await db
    .update(orders)
    .set({ restockedAt: new Date() })
    .where(and(eq(orders.id, order.id), isNull(orders.restockedAt)))
    .returning({ id: orders.id });
  if (!claimed) return false;

  for (const line of await stockLinesFor(order)) {
    await releaseStock(line);
  }
  return true;
}

/** Undoes a restock, for a cancellation the seller reverses. */
export async function retakeStock(order: Order): Promise<boolean> {
  const db = getDb();

  const [claimed] = await db
    .update(orders)
    .set({ restockedAt: null })
    .where(and(eq(orders.id, order.id), isNotNull(orders.restockedAt)))
    .returning({ id: orders.id });
  if (!claimed) return false;

  for (const line of await stockLinesFor(order)) {
    if (!line.productId) continue;
    // Deliberately unguarded: the seller is reversing their own decision, and
    // refusing to take the units back would leave the count too high.
    if (line.variantId) {
      await db
        .update(productVariants)
        .set({
          stockQuantity: sql`greatest(${productVariants.stockQuantity} - ${line.quantity}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(productVariants.id, line.variantId));
    } else {
      await db
        .update(products)
        .set({
          stockQuantity: sql`greatest(${products.stockQuantity} - ${line.quantity}, 0)`,
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
  }
  return true;
}

/** Statuses where the units are no longer going anywhere. */
export function isStockReleasingStatus(status: string) {
  return status === "cancelled" || status === "refunded";
}
