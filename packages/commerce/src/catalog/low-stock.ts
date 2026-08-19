import "server-only";
import { and, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { productVariants, products } from "@sailo/db/schema";

/**
 * Telling a seller before they run out — spec 51.
 *
 * `lowStock` matched zero files in this tree, so a seller found out they were
 * out of stock from a buyer. This is the claim that fixes it, and the claim is
 * the whole design rather than a detail of it.
 *
 * WHY IT IS A CONDITIONAL UPDATE AND NOT A READ FOLLOWED BY A SEND
 *
 * Stock falls on several paths — an order reserving units, a seller editing the
 * count, a CSV import — and a busy afternoon crosses the same threshold several
 * times in a minute. A read-then-send would mail on every one of them, and two
 * concurrent orders for the last three units would both read four and both
 * send. The ceiling lives in the WHERE, `returning` says who won, and only the
 * winner mails. The same shape as every other claim in this codebase.
 *
 * WHY THE RESET MATTERS AS MUCH AS THE CLAIM
 *
 * `lowStockNotifiedAt` is spent once. Without a reset, a seller who restocks on
 * Monday and sells down again on Friday hears nothing on Friday — and never
 * again, for the life of that product. A single restock-and-resell cycle going
 * silent for ever is worse than never having built the feature, because the
 * seller now believes they are being watched. So every path that *raises* stock
 * clears the claim, and it clears it only when the count is genuinely back
 * above the line.
 */

/** What the seller is told, once the claim is won. */
export type LowStockAlert = {
  productId: string;
  title: string;
  threshold: number;
  /** Units left across the product, or of the variant that crossed. */
  remaining: number;
  /** The combinations at or under the line, for a product sold with options. */
  variants: { label: string; remaining: number }[];
};

/**
 * Claims the right to tell this shop their stock is low, once per crossing.
 *
 * Answers null when the product is untracked, has no threshold, is still above
 * it, or when somebody else has already claimed this crossing — which are four
 * different facts that all mean the same thing to a caller: say nothing.
 *
 * Called after the units have already moved, never before. An alert sent for a
 * reservation that then failed would tell a seller they are nearly out of
 * something they still have.
 */
export async function claimLowStockAlert(
  productId: string,
): Promise<LowStockAlert | null> {
  const db = getDb();

  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
    columns: {
      id: true,
      title: true,
      trackInventory: true,
      stockQuantity: true,
      lowStockThreshold: true,
      options: true,
    },
  });
  if (!product?.trackInventory) return null;

  const threshold = product.lowStockThreshold;
  if (threshold === null || threshold < 0) return null;

  /*
   * Where the count actually lives.
   *
   * A product with options keeps nothing in `products.stockQuantity` — the
   * numbers are per combination — so the question "are we low" is asked of the
   * sum, and the alert names which combinations are short. Reading the product
   * column for a variant product would compare a threshold against null and
   * answer nothing, for ever.
   */
  const variantRows = await db.query.productVariants.findMany({
    where: eq(productVariants.productId, productId),
    columns: { options: true, stockQuantity: true, isAvailable: true },
  });

  const hasVariants = variantRows.length > 0;
  const remaining = hasVariants
    ? variantRows.reduce((sum, v) => sum + Math.max(0, v.stockQuantity ?? 0), 0)
    : Math.max(0, product.stockQuantity ?? 0);

  if (remaining > threshold) return null;

  /*
   * The claim. `lowStockNotifiedAt is null` in the WHERE is what makes this
   * once-per-crossing: of any number of concurrent callers, exactly one row
   * comes back.
   *
   * The threshold is re-read inside the statement rather than trusted from the
   * row above, so a seller who cleared it in the seconds since is not mailed
   * about a rule they just switched off.
   */
  const claimed = await db
    .update(products)
    .set({ lowStockNotifiedAt: new Date() })
    .where(
      and(
        eq(products.id, productId),
        isNotNull(products.lowStockThreshold),
        isNull(products.lowStockNotifiedAt),
      ),
    )
    .returning({ id: products.id });
  if (claimed.length === 0) return null;

  return {
    productId: product.id,
    title: product.title,
    threshold,
    remaining,
    variants: variantRows
      .filter((v) => (v.stockQuantity ?? 0) <= threshold && v.isAvailable)
      .map((v) => ({
        label: Object.values(v.options).filter(Boolean).join(" / "),
        remaining: Math.max(0, v.stockQuantity ?? 0),
      })),
  };
}

/**
 * Hands the claim back once stock is comfortably above the line again.
 *
 * Guarded on the count in the same statement that clears the marker, so a
 * partial restock that leaves the product still under its threshold does *not*
 * arm the alert again — otherwise a seller adding two units to a product that
 * needs ten would be told a second time about the same shortage.
 *
 * Only ever for a product sold as one thing. A product with options keeps its
 * counts on the variants, and `resetLowStockAlertFromVariants` below asks the
 * sum; splitting them is what stops this statement comparing a threshold
 * against a null that a variant product's `stockQuantity` always is.
 */
export async function resetLowStockAlert(productId: string): Promise<void> {
  const db = getDb();
  await db
    .update(products)
    .set({ lowStockNotifiedAt: null })
    .where(
      and(
        eq(products.id, productId),
        isNotNull(products.lowStockNotifiedAt),
        isNotNull(products.lowStockThreshold),
        gt(products.stockQuantity, products.lowStockThreshold),
      ),
    );
}

/**
 * The same reset, for a product whose stock lives on its combinations.
 *
 * The sum has to be computed rather than compared column to column, so this is
 * a correlated subquery rather than a second predicate. Still one statement,
 * still guarded, still safe to call from every path that puts units back.
 */
export async function resetLowStockAlertFromVariants(
  productId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(products)
    .set({ lowStockNotifiedAt: null })
    .where(
      and(
        eq(products.id, productId),
        isNotNull(products.lowStockNotifiedAt),
        isNotNull(products.lowStockThreshold),
        sql`coalesce((
          select sum(greatest(${productVariants.stockQuantity}, 0))
          from ${productVariants}
          where ${productVariants.productId} = ${productId}
        ), 0) > ${products.lowStockThreshold}`,
      ),
    );
}

/**
 * Arms or disarms the alert from wherever stock has just changed.
 *
 * One entry point rather than four call sites each choosing between the two
 * halves above, because "which reset do I need" is decided by whether the
 * product has variants — a fact the caller usually does not have to hand, and
 * getting it wrong fails silently in the direction of never alerting again.
 *
 * Answers the alert to send, or null. The caller does the sending: this module
 * is `@sailo/commerce` and knows nothing about email, preferences or ceilings,
 * all of which are `@sailo/workflows`.
 */
export async function afterStockChanged(
  productId: string,
): Promise<LowStockAlert | null> {
  const db = getDb();

  const anyVariants = await db.query.productVariants.findFirst({
    where: eq(productVariants.productId, productId),
    columns: { id: true },
  });

  if (anyVariants) await resetLowStockAlertFromVariants(productId);
  else await resetLowStockAlert(productId);

  return claimLowStockAlert(productId);
}

/**
 * Products a shop should be told about, for the seller's own list.
 *
 * Reads rather than claims, because a screen showing "3 low" every time it
 * loads must not spend the alert that the email depends on. Two questions, two
 * functions — conflating them is how a seller's dashboard silently swallows
 * their notifications.
 */
export async function lowStockProducts(shopId: string) {
  const db = getDb();
  return db.query.products.findMany({
    where: and(
      eq(products.shopId, shopId),
      eq(products.trackInventory, true),
      isNotNull(products.lowStockThreshold),
      lte(products.stockQuantity, products.lowStockThreshold),
    ),
    columns: { id: true, title: true, slug: true, stockQuantity: true, lowStockThreshold: true },
    limit: 50,
  });
}
