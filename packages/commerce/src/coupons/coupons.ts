import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { coupons, type CurrencyPrices } from "@sailo/db/schema";
import { normalizeCode, percentToBp } from "@sailo/core/pricing";

/**
 * Writing a discount code, from either surface.
 *
 * Every rule below was inside `apps/web/src/lib/actions/coupons.ts`, which made
 * them rules about a `FormData` rather than about a coupon. The phone posts
 * JSON, so each one would have had to be written a second time — and the two
 * that matter are the two that are silently wrong when they drift.
 *
 * **The percent ceiling.** `discountValue` is basis points for a percentage and
 * minor units for a fixed amount, in the same column. A `percent` coupon above
 * 100% is a negative order total, and nothing downstream refuses one:
 * `couponDiscount` multiplies, `computeTotals` subtracts, and the buyer is
 * quoted a shop that owes them money.
 *
 * **The clash check.** `code` is uniquely indexed per shop, so a duplicate is
 * caught either way — but as a driver error, which reaches the seller as a
 * failed save with no explanation of which of their codes it collided with.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * Parsing. The web reads `"12.50"` out of a form and the phone reads `"12,50"`
 * from a locale keypad, and both already know how to turn their own input into
 * minor units. This takes integers, so the one thing neither surface can get
 * wrong is what the other one meant.
 */

/** The most a percentage discount may be. Above this the order total goes negative. */
const MAX_PERCENT = 100;
/** Short codes are guessable, and a two-character code collides with real words. */
const MIN_CODE = 3;

export type SaveCouponInput = {
  shopId: string;
  /** Null creates; an id updates, and is checked against `shopId` first. */
  id: string | null;
  code: string;
  discountType: "percent" | "fixed";
  /**
   * A whole percentage for `percent` — converted to basis points here, so the
   * unit conversion is not a thing each caller remembers — and minor units for
   * `fixed`, already parsed by whoever read the seller's keyboard.
   */
  value: number;
  minSubtotalCents: number;
  /**
   * The same amounts in each other currency the shop quotes — spec 53.
   *
   * `price` is the fixed discount and `secondary` the minimum subtotal. A
   * **percentage** coupon with no minimum needs no entry at all: a percentage
   * is currency-free, and `couponAtCurrency` lets it through untouched. One
   * that names a minimum does need one, because a minimum is money.
   */
  currencyPrices?: CurrencyPrices;
  maxRedemptions: number | null;
  expiresAt: Date | null;
  isActive: boolean;
};

export type SaveCouponResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: "code_too_short" }
  | { ok: false; reason: "value_not_positive" }
  | { ok: false; reason: "percent_too_high" }
  | { ok: false; reason: "code_taken" }
  | { ok: false; reason: "not_found" };

export async function saveCoupon(input: SaveCouponInput): Promise<SaveCouponResult> {
  const code = normalizeCode(input.code);
  if (code.length < MIN_CODE) return { ok: false, reason: "code_too_short" };

  if (!Number.isFinite(input.value) || input.value <= 0) {
    return { ok: false, reason: "value_not_positive" };
  }
  if (input.discountType === "percent" && input.value > MAX_PERCENT) {
    return { ok: false, reason: "percent_too_high" };
  }

  const db = getDb();

  /*
   * The clash, named. The unique index would refuse this anyway, but as a
   * driver error — which reaches a seller as a save that failed, with no way
   * to tell it apart from the network dropping. Scoped with `ne(id)` so
   * re-saving a coupon does not collide with itself.
   */
  const clash = await db.query.coupons.findFirst({
    where: and(
      eq(coupons.shopId, input.shopId),
      eq(coupons.code, code),
      input.id ? ne(coupons.id, input.id) : undefined,
    ),
    columns: { id: true },
  });
  if (clash) return { ok: false, reason: "code_taken" };

  const values = {
    code,
    discountType: input.discountType,
    /* Basis points for a percentage, minor units for a fixed amount — one
       column, two units, which is why the conversion happens once, here. */
    discountValue:
      input.discountType === "percent" ? percentToBp(input.value) : Math.round(input.value),
    minSubtotalCents: Math.max(0, Math.round(input.minSubtotalCents)),
    currencyPrices: input.currencyPrices ?? {},
    maxRedemptions:
      input.maxRedemptions === null ? null : Math.max(1, Math.trunc(input.maxRedemptions)),
    expiresAt: input.expiresAt,
    isActive: input.isActive,
    updatedAt: new Date(),
  };

  if (input.id) {
    /*
     * Scoped by shop in the WHERE, and the result is what proves ownership —
     * never a prior read used as a permission check, which is a race the
     * update itself does not have.
     */
    const rows = await db
      .update(coupons)
      .set(values)
      .where(and(eq(coupons.id, input.id), eq(coupons.shopId, input.shopId)))
      .returning({ id: coupons.id });

    const row = rows[0];
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, id: row.id, created: false };
  }

  const rows = await db
    .insert(coupons)
    .values({ ...values, shopId: input.shopId })
    .returning({ id: coupons.id });

  /*
   * `timesRedeemed` is deliberately absent from `values`, on both branches. It
   * is the counter `claimCouponRedemption` increments, and an edit that reset
   * it would hand a seller's "first 50 customers" promotion back its fifty
   * uses every time they fixed a typo in the code.
   */
  return { ok: true, id: rows[0]?.id ?? "", created: true };
}

/** The seller's codes, newest first. */
export function listCoupons(shopId: string) {
  return getDb().query.coupons.findMany({
    where: eq(coupons.shopId, shopId),
    orderBy: [desc(coupons.createdAt)],
  });
}

/**
 * Switch one on or off.
 *
 * Read-then-write rather than a `NOT is_active` in SQL, because the caller
 * needs to know whether the row existed — and because the answer is what the
 * screen renders. The read is scoped; the write is scoped again.
 */
export async function toggleCoupon(shopId: string, id: string): Promise<boolean | null> {
  const db = getDb();
  const coupon = await db.query.coupons.findFirst({
    where: and(eq(coupons.id, id), eq(coupons.shopId, shopId)),
    columns: { isActive: true },
  });
  if (!coupon) return null;

  const isActive = !coupon.isActive;
  await db
    .update(coupons)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(coupons.id, id), eq(coupons.shopId, shopId)));

  return isActive;
}

export async function deleteCoupon(shopId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(coupons)
    .where(and(eq(coupons.id, id), eq(coupons.shopId, shopId)))
    .returning({ id: coupons.id });
  return rows.length > 0;
}
