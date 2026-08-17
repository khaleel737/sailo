import "server-only";
import { and, desc, asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { categories, coupons, products } from "@sailo/db/schema";
import { getShopClients } from "@sailo/customers/roster";
import { tagVocabulary } from "@sailo/customers/tags";

/**
 * Everything the compose screen's dropdowns need, in one round trip.
 *
 * Assembled here rather than in the page because three routes render the
 * composer — new, edit, and the list's own audience summary — and a picker
 * populated on two of them is a condition a seller can create in one place
 * and cannot read back in another.
 */

/**
 * How many options a dropdown may carry.
 *
 * A `<select>` with four thousand entries is not a picker, so the list is
 * bounded — and the bound is *reported* rather than silently applied, because
 * a seller scrolling for a product that is not there has no way to tell a
 * missing product from a full list. Newest first for the same reason: if only
 * some of a catalogue can be listed, the ones worth promoting are the recent
 * ones, not whichever happen to start with A.
 */
const PICKER_LIMIT = 200;

export type PickerOption = { id: string; label: string };

export type SegmentPickers = {
  tags: string[];
  products: PickerOption[];
  categories: PickerOption[];
  coupons: PickerOption[];
  /** Events, for the "turned up to" condition. A subset of products. */
  events: PickerOption[];
  /** True when the catalogue is longer than one dropdown can hold. */
  productsTruncated: boolean;
  productLimit: number;
};

export async function segmentPickers(shopId: string): Promise<SegmentPickers> {
  const db = getDb();

  const [clientRows, productRows, categoryRows, couponRows] = await Promise.all([
    getShopClients(shopId),
    db
      .select({
        id: products.id,
        title: products.title,
        kind: products.kind,
      })
      .from(products)
      .where(eq(products.shopId, shopId))
      .orderBy(desc(products.createdAt))
      // One past the ceiling, so "there are more" is a fact rather than a
      // guess made by comparing against the limit exactly.
      .limit(PICKER_LIMIT + 1),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.shopId, shopId))
      .orderBy(asc(categories.position))
      .limit(PICKER_LIMIT),
    db
      .select({ id: coupons.id, code: coupons.code })
      .from(coupons)
      // Expired codes stay listed — a broadcast may be exactly what reminds a
      // seller to extend one. Only a code they switched off is hidden.
      .where(and(eq(coupons.shopId, shopId), eq(coupons.isActive, true)))
      .orderBy(asc(coupons.code))
      .limit(PICKER_LIMIT),
  ]);

  const productsTruncated = productRows.length > PICKER_LIMIT;
  const shown = productRows.slice(0, PICKER_LIMIT);

  return {
    tags: tagVocabulary(clientRows),
    products: shown.map((row) => ({ id: row.id, label: row.title })),
    categories: categoryRows.map((row) => ({ id: row.id, label: row.name })),
    coupons: couponRows.map((row) => ({ id: row.id, label: row.code })),
    // "Turned up to" only means anything for a thing with a door.
    events: shown
      .filter((row) => row.kind === "event")
      .map((row) => ({ id: row.id, label: row.title })),
    productsTruncated,
    productLimit: PICKER_LIMIT,
  };
}
