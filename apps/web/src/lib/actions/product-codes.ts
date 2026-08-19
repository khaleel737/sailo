"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products } from "@sailo/db/schema";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import {
  MAX_CODES_PER_UPLOAD,
  addCodes,
  deleteUnclaimedCodes,
  generateCodes,
} from "@sailo/commerce/catalog";
import { requireShop } from "@/lib/session";
import type { ActionState } from "./shop";

/**
 * Filling and emptying one product's code pool — spec 48.
 *
 * Its own file rather than three more exports on `products.ts`, because none
 * of this is the product form: a pool is edited after the product exists, one
 * upload at a time, and it is the only screen in the admin whose contents are
 * bearer tokens.
 *
 * TWO RULES EVERY ACTION HERE FOLLOWS
 *
 * **Ownership is in the WHERE**, never a read followed by a write on an id the
 * browser sent. Every function below resolves the product through
 * `ownedProduct`, which scopes on `shop_id`, so a product id belonging to
 * another shop matches nothing — the guard working, rather than an error.
 *
 * **Nothing here ever returns a code.** The counts come back; the strings do
 * not. An unclaimed code in a server action's return value is an unclaimed
 * code in an RSC payload, which is the inventory leaving the building in the
 * page source.
 */

async function ownedProduct(shopId: string, productId: string) {
  return getDb().query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.shopId, shopId)),
    columns: {
      id: true,
      shopId: true,
      codeSource: true,
      codePattern: true,
      digitalDelivery: true,
    },
  });
}

/** The upgrade sentence, named once so three actions cannot word it three ways. */
function poolPlanRefusal(): ActionState {
  const plan = cheapestPlanWith("codePools");
  return {
    ok: false,
    error: `Code pools are on ${plan?.name ?? "Pro"}. Upgrade to give each buyer their own code.`,
  };
}

/**
 * Adds pasted or uploaded codes to a pool.
 *
 * One code per line, which is what a seller gets out of every key generator
 * and every marketplace export. A CSV is accepted by the same route because a
 * single-column CSV *is* one code per line, and a multi-column one has its
 * first field taken — the alternative is asking a seller which column their
 * keys are in, on a screen where the answer is always "the first one".
 */
export async function addProductCodes(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("products:write");
  if (!can(shop, "codePools")) return poolPlanRefusal();

  const productId = String(formData.get("productId") ?? "");
  const product = await ownedProduct(shop.id, productId);
  if (!product) return { ok: false, error: "That product no longer exists." };

  const raw = String(formData.get("codes") ?? "");
  const codes = raw
    .split(/\r?\n/)
    // The first field, so a two-column CSV of `key,note` still works.
    .map((line) => (line.includes(",") ? (line.split(",")[0] ?? "") : line))
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  if (codes.length === 0) return { ok: false, error: "Paste at least one code." };

  const result = await addCodes({
    productId: product.id,
    codes,
    // A pooled `link` product hands out one-seat invite URLs, and every one of
    // them is rendered as an anchor on a buyer's page — so the public-link
    // guard applies at this write, not wherever somebody remembers to.
    deliversLinks: product.digitalDelivery === "link",
  });

  revalidatePath(`/admin/products/${product.id}`);

  /*
   * Clamped output says so — rule 8. A seller who pasted 6,000 keys and had
   * 5,000 taken must be told, or they will believe the other thousand are in
   * the pool and oversell against them.
   */
  const truncated = codes.length > MAX_CODES_PER_UPLOAD;
  const parts = [`${result.added} added.`];
  if (result.duplicates) parts.push(`${result.duplicates} already in the pool.`);
  if (result.rejected) parts.push(`${result.rejected} couldn't be read.`);
  if (truncated) {
    parts.push(`Only the first ${MAX_CODES_PER_UPLOAD} were taken — upload the rest again.`);
  }

  return { ok: true, message: parts.join(" ") };
}

/** Mints codes from the product's own pattern. */
export async function generateProductCodes(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("products:write");
  if (!can(shop, "codePools")) return poolPlanRefusal();

  const productId = String(formData.get("productId") ?? "");
  const product = await ownedProduct(shop.id, productId);
  if (!product) return { ok: false, error: "That product no longer exists." };

  const count = Math.trunc(Number(formData.get("count") ?? 0));
  if (!Number.isFinite(count) || count <= 0) {
    return { ok: false, error: "How many codes should we make?" };
  }

  const result = await generateCodes({
    productId: product.id,
    pattern: product.codePattern,
    count,
  });

  revalidatePath(`/admin/products/${product.id}`);
  const clamped = count > MAX_CODES_PER_UPLOAD;
  return {
    ok: true,
    message: clamped
      ? `${result.added} codes made — ${MAX_CODES_PER_UPLOAD} is the most in one go.`
      : `${result.added} codes made.`,
  };
}

/**
 * Empties the unclaimed half of a pool.
 *
 * The seller's undo for pasting the wrong file — which happens, and which
 * otherwise leaves two hundred wrong keys in the pool with no way to get them
 * out except selling them.
 *
 * **Claimed and revoked codes are unreachable from here by construction**: the
 * delete's WHERE requires both timestamps to be null. A claimed code is a
 * buyer's and a revoked one is the record of a refund, and both are evidence
 * in a dispute months after the seller has stopped thinking about them.
 *
 * One button rather than a list with a delete beside each row, and that is the
 * same decision the card makes about counts: rendering the codes so a seller
 * can pick one would put unclaimed inventory in an RSC payload, which is the
 * one thing this whole feature is careful not to do.
 */
export async function clearUnclaimedCodes(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("products:write");
  const productId = String(formData.get("productId") ?? "");

  const product = await ownedProduct(shop.id, productId);
  if (!product) return { ok: false, error: "That product no longer exists." };

  const removed = await deleteUnclaimedCodes(product.id);
  revalidatePath(`/admin/products/${product.id}`);
  return { ok: true, message: `${removed} unused codes removed.` };
}
