import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  orderItems,
  productCodes,
  products,
  type ProductCode,
} from "@sailo/db/schema";
import { DEFAULT_CODE_PATTERN, checkCodePattern, mintCode } from "@sailo/core/codes";
import { isPublicLinkUrl } from "@sailo/storage/urls";

/**
 * A pool of codes, and the one statement that hands one out — spec 48.
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER LIST ON A PRODUCT
 *
 * A pool is a pile of **bearer tokens**. Whoever holds the string has the
 * good, so handing one out is spending inventory and every rule this repo
 * already earned about spending inventory applies at once:
 *
 *   * `claimCode` is a conditional UPDATE whose subselect takes `FOR UPDATE
 *     SKIP LOCKED`. Never a read followed by a write — that is the
 *     check-then-act shape that ended a buyer's checkout on an error page in
 *     `upsertClient`, and here it would hand two buyers one key. `SKIP LOCKED`
 *     rather than a plain `FOR UPDATE` so the second caller takes the *next*
 *     code instead of waiting for the first to commit.
 *   * The claim happens at **release**, not at checkout — see `releaseCodes`.
 *   * A refund **revokes** and does not return the code to the pool.
 *
 * WHAT THE SELLER SEES
 *
 * The pool is stock, not a second sold-out concept: uploading N codes adds N
 * to `stockQuantity`, so the storefront tile, the buy box, `maxPerOrder`, the
 * checkout's own reservation and spec 33's waitlist all keep working with no
 * knowledge that a pool exists.
 */

/** What a product's codes are drawn from. NULL is the one shared string. */
export type CodeSource = "pool" | "generated";

export function isCodeSource(value: unknown): value is CodeSource {
  return value === "pool" || value === "generated";
}

/* -------------------------------------------------------------------------- */
/*  Filling the pool                                                          */
/* -------------------------------------------------------------------------- */

export type AddCodesResult = {
  /** Rows actually written. */
  added: number;
  /** Offered but already in this product's pool. */
  duplicates: number;
  /** Offered but not a code we would hand anybody. */
  rejected: number;
};

const MAX_CODE_LENGTH = 500;
/** One upload. Beyond this a seller is importing a catalogue, not a pool. */
export const MAX_CODES_PER_UPLOAD = 5_000;

/**
 * Adds codes to a product's pool and moves the stock count with them.
 *
 * `onConflictDoNothing` on `(product_id, code)` rather than a prior read: a
 * seller pasting the same CSV twice is the ordinary case, and asking first
 * would reintroduce the gap in exactly the place the unique index closes it.
 * The stock count then moves by the number of rows that were actually
 * written, which is why `.returning()` is not decoration here — counting the
 * *input* would credit the seller for duplicates and let them oversell.
 *
 * `deliversLinks` decides which validation the strings get. Under
 * `digitalDelivery: "link"` a pool code is a one-seat invite URL, and it is
 * rendered as an anchor on the buyer's page — so it goes through
 * `isPublicLinkUrl` **at the write**, the same guard `digitalLinkUrl` gets,
 * rather than being checked wherever somebody remembers to.
 */
export async function addCodes(input: {
  productId: string;
  variantId?: string | null;
  codes: string[];
  deliversLinks: boolean;
}): Promise<AddCodesResult> {
  const db = getDb();

  const seen = new Set<string>();
  const clean: string[] = [];
  let rejected = 0;

  for (const raw of input.codes.slice(0, MAX_CODES_PER_UPLOAD)) {
    const code = raw.trim();
    if (!code || code.length > MAX_CODE_LENGTH) {
      if (code) rejected += 1;
      continue;
    }
    if (input.deliversLinks && !isPublicLinkUrl(code)) {
      rejected += 1;
      continue;
    }
    // Deduplicated in memory as well as by the index, so `duplicates` counts
    // what the seller pasted twice rather than reporting a number the
    // database's own answer would have folded away.
    if (seen.has(code)) continue;
    seen.add(code);
    clean.push(code);
  }

  if (clean.length === 0) return { added: 0, duplicates: 0, rejected };

  const written = await db
    .insert(productCodes)
    .values(
      clean.map((code) => ({
        productId: input.productId,
        variantId: input.variantId ?? null,
        code,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: productCodes.id });

  await syncPoolStock(input.productId, written.length);

  return {
    added: written.length,
    duplicates: clean.length - written.length,
    rejected,
  };
}

/**
 * Mints `count` codes from the product's pattern into its pool.
 *
 * A refused pattern falls back to the default rather than minting nothing: the
 * seller asked for codes, and a silent zero is the worst of the three possible
 * answers. `saveProduct` refuses the pattern at the point it is typed, so a
 * product reaching here with a bad one is a row that predates the check.
 */
export async function generateCodes(input: {
  productId: string;
  variantId?: string | null;
  pattern: string | null;
  count: number;
}): Promise<AddCodesResult> {
  const checked = checkCodePattern(input.pattern);
  const pattern = checked.ok ? checked.pattern : DEFAULT_CODE_PATTERN;
  const count = Math.max(0, Math.min(MAX_CODES_PER_UPLOAD, Math.trunc(input.count)));
  if (count === 0) return { added: 0, duplicates: 0, rejected: 0 };

  return addCodes({
    productId: input.productId,
    variantId: input.variantId ?? null,
    codes: Array.from({ length: count }, () => mintCode(pattern)),
    // Minted codes are never URLs, whatever the delivery mode says.
    deliversLinks: false,
  });
}

/**
 * Deletes an unclaimed code and takes its unit back off the shelf.
 *
 * Claimed and revoked rows are deliberately unreachable from here. A claimed
 * code is a buyer's; a revoked one is the record of a refund, and both are
 * evidence in a dispute long after the seller has stopped thinking about them.
 */
export async function deleteUnclaimedCode(input: {
  productId: string;
  codeId: string;
}): Promise<boolean> {
  const db = getDb();

  const [gone] = await db
    .delete(productCodes)
    .where(
      and(
        eq(productCodes.id, input.codeId),
        eq(productCodes.productId, input.productId),
        isNull(productCodes.claimedAt),
        isNull(productCodes.revokedAt),
      ),
    )
    .returning({ id: productCodes.id });

  if (!gone) return false;
  await syncPoolStock(input.productId, -1);
  return true;
}

/**
 * Moves a pool product's stock count by `delta`.
 *
 * The pool *is* the stock, so this is what keeps `stockQuantity` — the number
 * the storefront, the buy box and `reserveStock` all read — telling the truth
 * about how many codes there are left to hand out. Guarded on `codeSource`
 * because a seller who has not turned pooling on is counting units of
 * something else, and adding to their stock because they uploaded a spare key
 * would be inventing inventory.
 *
 * `greatest(…, 0)` on the way down: a seller deleting the last unclaimed code
 * while an order is mid-checkout must not push the count negative, which
 * `reserveStock`'s `>=` would then read as unlimited.
 */
async function syncPoolStock(productId: string, delta: number): Promise<void> {
  if (delta === 0) return;

  await getDb()
    .update(products)
    .set({
      stockQuantity:
        delta > 0
          ? sql`coalesce(${products.stockQuantity}, 0) + ${delta}`
          : sql`greatest(coalesce(${products.stockQuantity}, 0) + ${delta}, 0)`,
      trackInventory: true,
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, productId), eq(products.codeSource, "pool")));
}

/* -------------------------------------------------------------------------- */
/*  Spending it                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Takes one code out of the pool for an order, or reports that there were
 * none.
 *
 * THE STATEMENT IS THE WHOLE SECURITY CONTENT OF THIS FEATURE
 *
 *   UPDATE product_codes SET claimed_by_order_id = $order, claimed_at = now()
 *   WHERE id = (
 *     SELECT id FROM product_codes
 *     WHERE product_id = $product AND (variant matches)
 *       AND claimed_at IS NULL AND revoked_at IS NULL
 *     ORDER BY created_at, id
 *     LIMIT 1 FOR UPDATE SKIP LOCKED
 *   )
 *   RETURNING code
 *
 * Three separate properties, each of which fails differently:
 *
 *   * The `claimed_at IS NULL` is inside the statement that writes, so there
 *     is no window between deciding a code is free and taking it.
 *   * `FOR UPDATE` locks the row the subselect picked, so a second transaction
 *     cannot pick the same one.
 *   * `SKIP LOCKED` makes the second transaction step over it and take the
 *     next one, rather than blocking until the first commits and then
 *     discovering it has to start again.
 *
 * VARIANT FALLBACK
 *
 * The variant's own pool first, the product-level pool second. A seller who
 * uploaded keys per variant means them; one who uploaded a single list means
 * that list to serve every variant, which is the same fallback
 * `filesForVariant` applies to files, for the same reason.
 */
export async function claimCode(input: {
  productId: string;
  variantId: string | null;
  orderId: string;
}): Promise<string | null> {
  const db = getDb();

  for (const scope of scopesFor(input.variantId)) {
    const [claimed] = await db
      .update(productCodes)
      .set({ claimedByOrderId: input.orderId, claimedAt: new Date() })
      .where(
        sql`${productCodes.id} = (
          select ${productCodes.id} from ${productCodes}
          where ${productCodes.productId} = ${input.productId}
            and ${scope}
            and ${productCodes.claimedAt} is null
            and ${productCodes.revokedAt} is null
          order by ${productCodes.createdAt}, ${productCodes.id}
          limit 1
          for update skip locked
        )`,
      )
      .returning({ code: productCodes.code });

    if (claimed) return claimed.code;
  }

  return null;
}

/**
 * The pools to try, narrowest first.
 *
 * A product-level order — no variant — must **not** fall through to a
 * variant's pool. Those codes were set aside for buyers of that variant, and
 * handing one to somebody who bought the plain product is the same kind of
 * mistake as delivering the expensive variant's files to the cheap one.
 */
function scopesFor(variantId: string | null) {
  return variantId
    ? [
        sql`${productCodes.variantId} = ${variantId}`,
        sql`${productCodes.variantId} is null`,
      ]
    : [sql`${productCodes.variantId} is null`];
}

/**
 * Claims one code per unit of every pooled line on an order.
 *
 * Called from `releaseDownloads`, after the `downloadReleasedAt` claim has
 * been won — so an abandoned card session burns nothing, a webhook retry finds
 * the release already claimed and never reaches here, and the codes an order
 * holds are exactly the ones its buyer has been shown.
 *
 * `alreadyClaimed` is the second half of that idempotency and it is not
 * belt-and-braces: `releaseDownloads` is one of several paths, and a seller
 * who toggles an order unpaid and paid again reaches it a second time with the
 * release timestamp cleared by nothing — so the count of codes this order
 * already holds is what stops a pool being drained one re-save at a time.
 *
 * Quantity fans out. Three licences bought is three keys, read from the
 * *lines* — the header's quantity describes the first line only, which is the
 * fourth of the six recurring bug shapes.
 */
export async function claimCodesForOrder(orderId: string): Promise<number> {
  const db = getDb();

  const lines = await db
    .select({
      productId: orderItems.productId,
      variantId: orderItems.variantId,
      quantity: orderItems.quantity,
      codeSource: products.codeSource,
      codePattern: products.codePattern,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.position));

  let claimed = 0;

  for (const line of lines) {
    if (!line.productId || !isCodeSource(line.codeSource)) continue;

    const wanted = Math.max(0, line.quantity);
    const held = await countClaimedFor(orderId, line.productId);
    for (let i = held; i < wanted; i += 1) {
      if (line.codeSource === "generated") {
        /*
         * Minted straight onto the order rather than into the pool and then
         * out of it. A generated code has no scarcity to model — Sailo is the
         * one making them — so putting one in the pool first would be a row
         * that exists to be taken out again in the same breath, and a window
         * in which somebody else's release could take it.
         */
        const [row] = await db
          .insert(productCodes)
          .values({
            productId: line.productId,
            variantId: line.variantId,
            code: mintCode(line.codePattern ?? DEFAULT_CODE_PATTERN),
            claimedByOrderId: orderId,
            claimedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning({ id: productCodes.id });
        if (row) claimed += 1;
        continue;
      }

      const code = await claimCode({
        productId: line.productId,
        variantId: line.variantId,
        orderId,
      });
      /*
       * An empty pool at release, which is a real state: the seller sold the
       * last key and a second order slipped through on stock that had drifted.
       * Stopping here rather than throwing — the buyer's files, tickets and
       * every other line of the same order still release, and the seller sees
       * a short order they can top up. Throwing would take the whole release
       * down with it, and this is the path that also sends the email.
       */
      if (!code) break;
      claimed += 1;
    }
  }

  return claimed;
}

async function countClaimedFor(orderId: string, productId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(productCodes)
    .where(
      and(
        eq(productCodes.claimedByOrderId, orderId),
        eq(productCodes.productId, productId),
      ),
    );
  return row?.n ?? 0;
}

/* -------------------------------------------------------------------------- */
/*  Giving it back, which it never is                                         */
/* -------------------------------------------------------------------------- */

/**
 * Revokes every code an order claimed, and reports how many.
 *
 * **A revoked code is not returned to the pool.** A key the buyer has already
 * seen is spent whatever happens next: they may have redeemed it, sold it or
 * pasted it in a forum, and none of that is visible from here. Handing it to
 * the next buyer turns one refund into two support cases and gives a stranger
 * something somebody already used.
 *
 * The count is what the restock path subtracts from the units it returns —
 * see `restoreStock` — so a refunded pool order gives back the units whose
 * codes were never spent and no more, and the seller is told the number so
 * they can top up.
 *
 * Idempotent through `revoked_at IS NULL`: a seller cancelling an order that
 * was already refunded revokes nothing a second time, which is what keeps the
 * subtraction from being applied twice.
 */
export async function revokeCodesForOrder(orderId: string): Promise<number> {
  const revoked = await getDb()
    .update(productCodes)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(productCodes.claimedByOrderId, orderId), isNull(productCodes.revokedAt)),
    )
    .returning({ id: productCodes.id });

  return revoked.length;
}

/** How many of an order's codes have been spent on each product. */
export async function spentCodesByProduct(
  orderId: string,
): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({
      productId: productCodes.productId,
      n: sql<number>`count(*)::int`,
    })
    .from(productCodes)
    .where(eq(productCodes.claimedByOrderId, orderId))
    .groupBy(productCodes.productId);

  return new Map(rows.map((r) => [r.productId, r.n]));
}

/* -------------------------------------------------------------------------- */
/*  Reading it                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The codes an order was given.
 *
 * The *only* read that returns an unclaimed code is none of them: every path
 * out of this module is either scoped to one order or counts rows. An
 * unclaimed code must appear in no RSC payload, no preview, no OG image and no
 * CSV export — it is inventory, and rendering it anywhere is the inventory
 * leaving the building.
 */
export async function codesForOrder(orderId: string): Promise<ProductCode[]> {
  return getDb().query.productCodes.findMany({
    where: eq(productCodes.claimedByOrderId, orderId),
    orderBy: [asc(productCodes.claimedAt), asc(productCodes.id)],
  });
}

export type PoolCounts = {
  available: number;
  claimed: number;
  revoked: number;
};

/** What the seller's product form shows above the upload box. */
export async function poolCounts(productId: string): Promise<PoolCounts> {
  const [row] = await getDb()
    .select({
      available: sql<number>`count(*) filter (where ${productCodes.claimedAt} is null and ${productCodes.revokedAt} is null)::int`,
      claimed: sql<number>`count(*) filter (where ${productCodes.claimedAt} is not null and ${productCodes.revokedAt} is null)::int`,
      revoked: sql<number>`count(*) filter (where ${productCodes.revokedAt} is not null)::int`,
    })
    .from(productCodes)
    .where(eq(productCodes.productId, productId));

  return {
    available: row?.available ?? 0,
    claimed: row?.claimed ?? 0,
    revoked: row?.revoked ?? 0,
  };
}

/**
 * The seller's export, and the one rule it has: **claimed codes only.**
 *
 * An export of unclaimed keys is the inventory leaving the building in a file
 * that will sit in a downloads folder for ever. What a seller actually needs
 * from an export is the audit — which code went to which order, and when — and
 * that is exactly the half that is safe to write down.
 */
export async function claimedCodeRows(productId: string) {
  return getDb()
    .select({
      code: productCodes.code,
      claimedAt: productCodes.claimedAt,
      revokedAt: productCodes.revokedAt,
      orderId: productCodes.claimedByOrderId,
    })
    .from(productCodes)
    .where(and(eq(productCodes.productId, productId), sql`${productCodes.claimedAt} is not null`))
    .orderBy(asc(productCodes.claimedAt));
}
