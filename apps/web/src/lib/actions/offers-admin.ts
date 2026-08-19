"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { offers, products } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { revalidateShop } from "@/lib/cache";
import { publishShopEvent } from "@sailo/events";
import { can } from "@sailo/core/plans";
import { parseMoneyToCents } from "@sailo/core/currency";
import { isOfferDisplay, isOfferPlacement } from "@sailo/core/offers";
import { shopMomentFrom } from "@/lib/products/form-fields";
import type { ActionState } from "./shop";

/**
 * The seller's side of an offer — specs 08 and 36.
 *
 * WHAT IS VALIDATED HERE AND WHAT IS NOT
 *
 * Ownership, twice: both products have to belong to this shop, checked in the
 * WHERE rather than after a read. Without it a seller could attach another
 * shop's product as their own offer and sell it from their storefront, which is
 * the one thing on this screen that would be somebody else's money.
 *
 * The *price* is not validated beyond being a number, because there is nothing
 * to validate: an override above the list price is a legitimate thing to do
 * (a bundle, a rush fee), and the storefront simply stops drawing a
 * struck-through comparison. What matters is that it is read from this row at
 * render and at charge, and never from a browser.
 */

/**
 * `as const` rather than `Record<string, string>`, and the difference is not
 * cosmetic: an index signature makes every lookup `string | undefined`, so each
 * one needed a `!` to satisfy the compiler — six assertions telling it to
 * believe six things it could have checked. A literal type checks them.
 */
const REFUSALS = {
  unknown_placement: "Choose where the offer appears.",
  no_product: "Pick the product to offer.",
  not_yours: "That product isn't in your shop.",
  self: "An offer can't be for the same product that triggers it.",
  inverted: "The offer has to close after it opens. Check the two dates.",
  locked: "Order bumps and cross-sells are on Pro.",
} as const;

export async function saveOffer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("products:write");

  // Gated here as well as in the form, because a form is not a gate.
  if (!can(shop, "offers")) return { ok: false, error: REFUSALS.locked };

  const placement = String(formData.get("placement") ?? "");
  if (!isOfferPlacement(placement)) {
    return { ok: false, error: REFUSALS.unknown_placement };
  }

  const offerProductId = String(formData.get("offerProductId") ?? "").trim();
  if (!offerProductId) return { ok: false, error: REFUSALS.no_product };

  const sourceProductId = String(formData.get("sourceProductId") ?? "").trim() || null;

  /*
   * An offer for the thing that triggers it is a loop, not an offer.
   *
   * Caught here rather than left to `offerEligibility`'s `already_bought` rule,
   * because that rule is about *this* buyer and this is about the configuration:
   * a seller who set it would see nothing render and have no idea why.
   */
  if (sourceProductId && sourceProductId === offerProductId) {
    return { ok: false, error: REFUSALS.self };
  }

  const db = getDb();

  /*
   * Both products, this shop's, in the WHERE.
   *
   * One query for the pair rather than two round trips. `inArray` rather than a
   * hand-built `ARRAY[…]` through `sql.raw`, and that is not a style
   * preference: these ids come out of a `FormData`, and `sql.raw` would splice
   * whatever a browser sent straight into the statement. `inArray` parameterises
   * them, so the worst a forged value can do is match nothing.
   *
   * A row count rather than a fetch, because whether they are both here is also
   * the only answer this action is allowed to give about somebody else's
   * catalogue.
   */
  const wanted = [...new Set([offerProductId, ...(sourceProductId ? [sourceProductId] : [])])];
  const owned = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.shopId, shop.id), inArray(products.id, wanted)));
  if (owned.length !== wanted.length) return { ok: false, error: REFUSALS.not_yours };

  const validFrom = shopMomentFrom(formData.get("validFrom"), shop.timeZone);
  const validUntil = shopMomentFrom(formData.get("validUntil"), shop.timeZone);
  if (validFrom && validUntil && validUntil.getTime() <= validFrom.getTime()) {
    return { ok: false, error: REFUSALS.inverted };
  }

  const priceRaw = String(formData.get("priceCents") ?? "").trim();

  const values = {
    placement,
    sourceProductId,
    offerProductId,
    /*
     * `parent_id` is never written. `GAP §4.6` refuses three-level down-sell
     * trees; the column exists so nesting is a migration and an editor away
     * rather than a rewrite, and a row with one set is ignored at render.
     */
    title: text(formData.get("title"), 120),
    body: text(formData.get("body"), 500),
    buttonLabel: text(formData.get("buttonLabel"), 40),
    display: isOfferDisplay(formData.get("display"))
      ? String(formData.get("display"))
      : "card",
    // Blank leaves the product's own price, which is not the same as free.
    priceCents: priceRaw ? parseMoneyToCents(priceRaw, shop.currency) : null,
    validFrom,
    validUntil,
    isActive: formData.get("isActive") !== "off",
    updatedAt: new Date(),
  };

  const id = String(formData.get("id") ?? "").trim();

  if (id) {
    const rows = await db
      .update(offers)
      .set(values)
      .where(and(eq(offers.id, id), eq(offers.shopId, shop.id)))
      .returning({ id: offers.id });
    if (rows.length === 0) return { ok: false, error: "Offer not found." };
  } else {
    /* Appended, so a new offer does not jump ahead of the order the seller
       already chose. */
    const [maxed] = await db
      .select({ max: sql<string>`coalesce(max(${offers.position}), 0)` })
      .from(offers)
      .where(eq(offers.shopId, shop.id));

    await db.insert(offers).values({
      ...values,
      shopId: shop.id,
      position: Number(maxed?.max ?? 0) + 1,
    });
  }

  revalidatePath("/admin/offers");
  // A bump changes what the checkout draws, which is a cached storefront read.
  revalidateShop(shop.id, shop.handle);
  after(() => publishShopEvent(shop.id, "catalog"));

  return { ok: true, message: id ? "Offer updated." : "Offer added." };
}

export async function deleteOffer(formData: FormData): Promise<void> {
  const { shop } = await requireShop("products:write");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  /*
   * A real delete, and `offer_events` goes with it by cascade.
   *
   * Deliberate: the events are a take-rate for an offer that no longer exists,
   * and keeping them would leave a seller reading a percentage against nothing
   * they can act on. Switching an offer *off* is what keeps the history —
   * `isActive` is the reversible control and this one is not.
   */
  await getDb()
    .delete(offers)
    .where(and(eq(offers.id, id), eq(offers.shopId, shop.id)));

  revalidatePath("/admin/offers");
  revalidateShop(shop.id, shop.handle);
}

/** Blank is "no answer" and stores as null, which is not the empty string. */
function text(value: FormDataEntryValue | null, max: number): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? raw.slice(0, max) : null;
}
