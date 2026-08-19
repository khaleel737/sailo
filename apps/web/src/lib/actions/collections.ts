"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { collectionItems, collections, productFiles, products } from "@sailo/db/schema";
import { can } from "@sailo/core/plans";
import {
  PREVIEW_REFUSAL,
  isDripMode,
  isEmbeddableUrl,
  isValidPreview,
} from "@sailo/core/content";
import type { ActionState } from "@sailo/core/action-state";
import { requireShop } from "@/lib/session";
import { revalidateShop } from "@/lib/cache";

/**
 * Building a collection. Spec 40.
 *
 * ─── THE PLAN GATE, AND WHAT IT ACTUALLY GATES ─────────────────────────────
 *
 * Pro for one collection, Business for many and for drip. Enforced here rather
 * than in the UI, because a hidden button is not a control — and stated in the
 * refusal rather than silently clamped, which rule 8 requires: *no silent caps.*
 *
 * ─── AND THE TWO GUARDS THAT ARE NOT ABOUT MONEY ───────────────────────────
 *
 * **A preview may never carry a file.** A preview is readable with no order at
 * all — that is what it is for — so a preview with a `fileId` is a paid file
 * given away to anybody with the link. Refused at the write and again at the
 * read.
 *
 * **An embed URL goes through the allowlist at the write**, never at render.
 * Same rule as every other seller-supplied URL, and the same four writes that
 * had to be fixed once already.
 */

/** The seller's own collection for one of their products, or null. */
async function loadCollection(shopId: string, id: string) {
  return getDb().query.collections.findFirst({
    where: and(eq(collections.id, id), eq(collections.shopId, shopId)),
  });
}

export async function saveCollection(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("products:write");
  const db = getDb();

  const productId = String(formData.get("productId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim().slice(0, 160);
  if (!productId || !title) return { ok: false, error: "Give the collection a title." };

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.shopId, shop.id)),
    columns: { id: true, kind: true },
  });
  if (!product) return { ok: false, error: "That product no longer exists." };

  /*
   * Digital and membership products only. A collection on a physical mug or a
   * booking is a list of lessons attached to something with no delivery page to
   * show them on.
   */
  if (product.kind !== "digital" && product.kind !== "membership") {
    return {
      ok: false,
      error: "Gated content works on a digital product or a membership.",
    };
  }

  const dripMode = String(formData.get("dripMode") ?? "none");
  const dripDays = Number.parseInt(String(formData.get("dripIntervalDays") ?? ""), 10);

  if (!isDripMode(dripMode)) return { ok: false, error: "Choose how the content unlocks." };

  /*
   * Drip is a Business feature, and the refusal says so rather than quietly
   * saving `none`. A seller who set an interval and found it ignored would have
   * no way to discover why.
   */
  if (dripMode === "interval" && !can(shop, "integrations")) {
    return {
      ok: false,
      error:
        "Releasing content over time is on the Business plan. Everything unlocks at once on your plan.",
    };
  }

  const existing = await db.query.collections.findFirst({
    where: eq(collections.productId, productId),
  });

  if (existing) {
    if (existing.shopId !== shop.id) {
      return { ok: false, error: "That product no longer exists." };
    }
    await db
      .update(collections)
      .set({
        title,
        description: String(formData.get("description") ?? "").trim() || null,
        dripMode,
        dripIntervalDays:
          dripMode === "interval" && Number.isFinite(dripDays) && dripDays >= 0
            ? dripDays
            : null,
        updatedAt: new Date(),
      })
      .where(eq(collections.id, existing.id));
  } else {
    /*
     * The count gate, checked before the insert and stated in the refusal. Pro
     * gets one collection; a second needs Business.
     */
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(collections)
      .where(eq(collections.shopId, shop.id));

    if (n >= 1 && !can(shop, "integrations")) {
      return {
        ok: false,
        error:
          "Your plan includes one collection. Upgrade to Business to build content on more than one product.",
      };
    }

    await db.insert(collections).values({
      shopId: shop.id,
      productId,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      dripMode,
      dripIntervalDays:
        dripMode === "interval" && Number.isFinite(dripDays) && dripDays >= 0
          ? dripDays
          : null,
    });
  }

  revalidateShop(shop.id, shop.handle);
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, message: "Saved." };
}

export async function saveCollectionItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("products:write");
  const db = getDb();

  const collectionId = String(formData.get("collectionId") ?? "").trim();
  const collection = await loadCollection(shop.id, collectionId);
  if (!collection) return { ok: false, error: "That collection no longer exists." };

  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the item a title." };

  const fileId = String(formData.get("fileId") ?? "").trim() || null;
  const externalUrl = String(formData.get("externalUrl") ?? "").trim() || null;
  const isPreview = formData.get("isPreview") === "on";

  /*
   * THE ONE PLACE A MISTAKE HANDS THE GOODS OVER. A preview is public; a preview
   * carrying a file is a paid file given away to anybody with the link. Refused
   * with the reason rather than silently un-ticked.
   */
  if (!isValidPreview({ isPreview, hasFile: Boolean(fileId) })) {
    return { ok: false, error: PREVIEW_REFUSAL };
  }

  /*
   * The embed allowlist, at the *write*. Never at render — the same rule spec 35
   * follows, and the same four writes that had to be fixed once already.
   */
  if (externalUrl && !isEmbeddableUrl(externalUrl)) {
    return {
      ok: false,
      error: "Embeds are limited to YouTube, Vimeo and Loom, over https.",
    };
  }

  /*
   * A file has to be one of this shop's own. The id comes from a form, and
   * without this check a seller could attach another shop's file by pasting its
   * id — which the download route would then happily stream, because the item
   * is on a collection their buyer is entitled to.
   */
  if (fileId) {
    const [owned] = await db
      .select({ id: productFiles.id })
      .from(productFiles)
      .innerJoin(products, eq(products.id, productFiles.productId))
      .where(and(eq(productFiles.id, fileId), eq(products.shopId, shop.id)));
    if (!owned) return { ok: false, error: "That file is not one of yours." };
  }

  const id = String(formData.get("id") ?? "").trim();
  const values = {
    section: String(formData.get("section") ?? "").trim() || null,
    title,
    bodyMd: String(formData.get("bodyMd") ?? "").trim() || null,
    fileId,
    externalUrl,
    isPreview,
    position: Number.parseInt(String(formData.get("position") ?? "0"), 10) || 0,
    availableAfterDays: readOverride(formData.get("availableAfterDays")),
  };

  if (id) {
    await db
      .update(collectionItems)
      .set(values)
      .where(
        and(eq(collectionItems.id, id), eq(collectionItems.collectionId, collection.id)),
      );
  } else {
    await db.insert(collectionItems).values({ collectionId: collection.id, ...values });
  }

  revalidateShop(shop.id, shop.handle);
  revalidatePath(`/admin/products/${collection.productId}`);
  return { ok: true, message: "Saved." };
}

/**
 * Blank ≠ zero, on a field where the two mean opposite things.
 *
 * `0` is a seller saying "this one opens immediately even though the rest drip";
 * blank is a seller who has said nothing about this item and means the
 * collection's interval.
 */
function readOverride(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function deleteCollectionItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("products:write");
  const db = getDb();

  const collection = await loadCollection(
    shop.id,
    String(formData.get("collectionId") ?? "").trim(),
  );
  if (!collection) return { ok: false, error: "That collection no longer exists." };

  await db
    .delete(collectionItems)
    .where(
      and(
        eq(collectionItems.id, String(formData.get("id") ?? "").trim()),
        eq(collectionItems.collectionId, collection.id),
      ),
    );

  revalidateShop(shop.id, shop.handle);
  revalidatePath(`/admin/products/${collection.productId}`);
  return { ok: true, message: "Removed." };
}
