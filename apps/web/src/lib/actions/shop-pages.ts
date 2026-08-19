"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, shops } from "@sailo/db/schema";
import { absolute } from "@sailo/core/origin";
import type { ActionState } from "@sailo/core/action-state";
import {
  SHOP_PAGE_SLUGS,
  analyticsPreanswer,
  isShopPageKind,
  renderShopPage,
  renderShopPages,
  shopPageFacts,
  toPageSlug,
  validatePageSlug,
  type GeneratorAnswers,
  type ShopPageKind,
} from "@sailo/core/shop-pages";
import {
  createMissingPages,
  replacePageBody,
  savePage,
  setPagePublished,
  shopPageOfKind,
  slugTakenBy,
} from "@sailo/commerce/pages";
import { requireShop } from "@/lib/session";
import { revalidateShop } from "@/lib/cache";

/**
 * The seller's own documents — generate, edit, publish, and the one click the
 * whole spec exists for.
 *
 * Spec 41. `requireTerms` has been enforceable since spec 05 and unusable in
 * practice, because a seller with no document to link at leaves it off. The last
 * action in this file — `useAsCheckoutTerms` — points `shops.termsUrl` at a page
 * Sailo hosts and turns the switch on, and that single click is the reason any
 * of the rest of this exists.
 *
 * **No plan gate anywhere in here.** A seller with no terms is a compliance risk
 * to the platform as well as to themselves, and charging for the fix would mean
 * the shops least able to pay are the ones trading without a refund policy.
 */

/** The four answers `shops` cannot supply, read off the generator form. */
function readAnswers(formData: FormData, shop: Parameters<typeof analyticsPreanswer>[0]): GeneratorAnswers {
  const rawWindow = String(formData.get("refundWindowDays") ?? "").trim();
  const parsed = Number.parseInt(rawWindow, 10);

  return {
    /*
     * Blank is not zero, and the two mean opposite things here: an unanswered
     * question leaves the template saying so, while a deliberate `0` publishes
     * "we offer no refunds beyond the law". Writing one as the other would put
     * a policy on a seller's shop that they never chose.
     */
    refundWindowDays:
      rawWindow === "" || Number.isNaN(parsed) || parsed < 0 || parsed > 365
        ? null
        : parsed,
    extraDataCollected: String(formData.get("extraDataCollected") ?? "").trim() || null,
    /*
     * The checkbox is pre-ticked from the shop's pixel columns and the seller
     * may untick it — but only in the direction of *more* disclosure. A shop
     * with a Meta pixel configured says so whatever the form posts, because a
     * privacy policy claiming no analytics on a page that loads a pixel is a
     * false statement about personal data.
     */
    usesAnalytics: formData.get("usesAnalytics") === "on" || analyticsPreanswer(shop),
    shipsPhysicalGoods: formData.get("shipsPhysicalGoods") === "on",
  };
}

/** The product kinds this shop actually publishes, for the delivery wording. */
async function soldKinds(shopId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ kind: products.kind })
    .from(products)
    .where(eq(products.shopId, shopId));
  return rows.map((row) => row.kind).filter(Boolean);
}

/** Today, as a plain date. Passed into the renderer so it stays pure. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Write the pages that do not exist yet.
 *
 * Never overwrites. A seller who has already edited their refunds page and then
 * presses Generate again gets the four they were missing and keeps the one they
 * wrote — the count in the message says which happened, because "generated" over
 * a page that was left alone is a claim the seller would find out was false the
 * next time they read it.
 */
export async function generateShopPages(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  const facts = shopPageFacts(shop, readAnswers(formData, shop), {
    sells: await soldKinds(shop.id),
    generatedOn: today(),
    locale: shop.locale ?? "en",
  });

  const created = await createMissingPages(shop.id, renderShopPages(facts));
  revalidateShop(shop.id, shop.handle);

  if (created.length === 0) {
    return {
      ok: true,
      message: "You already have all five pages. Edit them below.",
    };
  }
  return {
    ok: true,
    message:
      created.length === 1
        ? "One page added as a draft. Read it before you publish it."
        : `${created.length} pages added as drafts. Read them before you publish.`,
  };
}

/** The seller's edit. Publishing is part of the same save, as the form is. */
export async function saveShopPage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  const kind = String(formData.get("kind") ?? "");
  if (!isShopPageKind(kind)) return { ok: false, error: "That page no longer exists." };

  const existing = await shopPageOfKind(shop.id, kind);
  if (!existing) return { ok: false, error: "That page no longer exists." };

  const title = String(formData.get("title") ?? "").trim().slice(0, 120);
  if (!title) return { ok: false, error: "Give the page a title." };

  /*
   * A blank slug falls back to the title, then to the kind's default — rather
   * than refusing. The seller is editing a document, and the web address is the
   * part of this form they are least likely to care about.
   */
  const rawSlug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const slug = rawSlug || toPageSlug(title) || SHOP_PAGE_SLUGS[kind];

  const slugProblem = validatePageSlug(slug);
  if (slugProblem) return { ok: false, error: slugProblem };

  if (await slugTakenBy(shop.id, slug, kind)) {
    return { ok: false, error: "Another one of your pages already uses that web address." };
  }

  const bodyMd = String(formData.get("bodyMd") ?? "").trim();
  if (!bodyMd) return { ok: false, error: "The page is empty." };

  const isPublished = formData.get("isPublished") === "on";

  await savePage({ shopId: shop.id, kind, title, slug, bodyMd, isPublished });
  revalidateShop(shop.id, shop.handle);

  return {
    ok: true,
    message: isPublished ? "Saved and live on your shop." : "Saved as a draft.",
  };
}

/**
 * Regenerate one page over what the seller wrote, after they have said yes.
 *
 * Its own action rather than a flag on `saveShopPage`, because it is the one
 * call here that destroys work. The screen shows the seller both versions before
 * this runs; the confirmation token below is what proves they saw them.
 */
export async function regenerateShopPage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  const kind = String(formData.get("kind") ?? "");
  if (!isShopPageKind(kind)) return { ok: false, error: "That page no longer exists." };
  if (formData.get("confirm") !== "replace") {
    return { ok: false, error: "Confirm the replacement first." };
  }

  const facts = shopPageFacts(shop, readAnswers(formData, shop), {
    sells: await soldKinds(shop.id),
    generatedOn: today(),
    locale: shop.locale ?? "en",
  });

  await replacePageBody(shop.id, renderShopPage(kind, facts));
  revalidateShop(shop.id, shop.handle);

  return { ok: true, message: "Replaced with a fresh copy of the template." };
}

/** Publish or unpublish without opening the editor. */
export async function toggleShopPage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  const kind = String(formData.get("kind") ?? "");
  if (!isShopPageKind(kind)) return { ok: false, error: "That page no longer exists." };

  const page = await shopPageOfKind(shop.id, kind);
  if (!page) return { ok: false, error: "That page no longer exists." };

  /*
   * Refuses to publish an empty document. Everywhere else a blank body is the
   * seller's business; here it would put a page with a title and nothing under
   * it in front of a buyer deciding whether to trust the shop.
   */
  const next = !page.isPublished;
  if (next && !page.bodyMd?.trim()) {
    return { ok: false, error: "Write something on the page before publishing it." };
  }

  await setPagePublished(shop.id, kind, next);
  await unlinkIfUnpublished(shop.id, kind, next);
  revalidateShop(shop.id, shop.handle);

  return { ok: true, message: next ? "Published." : "Taken down." };
}

/**
 * The one click this spec exists for.
 *
 * Points `shops.termsUrl` (or `privacyUrl`) at the page Sailo hosts, and — for
 * terms — turns `requireTerms` on. Both in one write, because a seller who
 * publishes terms and links them and then leaves the switch off has done all the
 * work and none of the good.
 *
 * The URL is built here from the handle rather than taken from the form: it is
 * stored on a column that `isPublicLinkUrl` guards on every other write path,
 * and a value the browser could choose would be the one place that guard does
 * not run.
 */
export async function useAsCheckoutTerms(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  const kind = String(formData.get("kind") ?? "");
  if (kind !== "terms" && kind !== "privacy") {
    return { ok: false, error: "Only your terms or privacy policy can be linked here." };
  }

  const page = await shopPageOfKind(shop.id, kind);
  if (!page) return { ok: false, error: "That page no longer exists." };
  if (!page.isPublished) {
    return { ok: false, error: "Publish the page first — a buyer cannot agree to a draft." };
  }

  const url = absolute(`/${shop.handle}/legal/${page.slug}`);

  await getDb()
    .update(shops)
    .set(
      kind === "terms"
        ? { termsUrl: url, requireTerms: true, updatedAt: new Date() }
        : { privacyUrl: url, updatedAt: new Date() },
    )
    .where(eq(shops.id, shop.id));

  revalidateShop(shop.id, shop.handle);

  return {
    ok: true,
    message:
      kind === "terms"
        ? "Checkout now shows your terms and asks buyers to accept them."
        : "Your privacy policy is linked from your shop.",
  };
}

/**
 * Unlink a page that has just been taken down.
 *
 * The guard against the half-updated pair: publishing writes a URL onto the shop
 * and unpublishing would otherwise leave it there, so `requireTerms` would keep
 * demanding agreement to a link that 404s — a checkout that refuses to complete
 * without consent to a page nobody can read. `requireTerms` itself is left
 * alone: switching it off is the seller's decision, and doing it for them would
 * silently drop the consent record from every subsequent order.
 */
async function unlinkIfUnpublished(
  shopId: string,
  kind: ShopPageKind,
  nowPublished: boolean,
): Promise<void> {
  if (nowPublished) return;
  if (kind !== "terms" && kind !== "privacy") return;

  const row = await getDb().query.shops.findFirst({
    where: eq(shops.id, shopId),
    columns: { handle: true, termsUrl: true, privacyUrl: true },
  });
  if (!row) return;

  const column = kind === "terms" ? row.termsUrl : row.privacyUrl;
  if (!column) return;

  // Only ours. A seller who pointed the column at their own site and separately
  // unpublished a Sailo page has not asked us to clear their link.
  if (!column.includes(`/${row.handle}/legal/`)) return;

  await getDb()
    .update(shops)
    .set(kind === "terms" ? { termsUrl: null } : { privacyUrl: null })
    .where(eq(shops.id, shopId));
}
