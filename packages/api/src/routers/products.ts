import { z } from "zod";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { productImages, productVariants, products, shops } from "@sailo/db/schema";
import { PRODUCT_KIND_VALUES } from "@sailo/core/variants";
import {
  deleteProduct,
  saveProduct,
  toggleProductPublished,
  type SaveProductRefusal,
} from "@sailo/commerce/products";
import { olderThan, pageOf } from "@sailo/commerce/pagination";
import { sellerCataloguePage, sellerProduct } from "@sailo/commerce/catalog";
import { TRPCError } from "@trpc/server";
import { router, shopProcedure } from "../trpc";
import { byId, found, listInput, cursorFrom } from "../shared";

/** The seller's catalogue, scoped by `ctx.shopId` in every WHERE. */

/**
 * A page of the catalogue, and what a seller may narrow it to.
 *
 * Built on `listInput` rather than beside it, so the page-size ceiling stays
 * the one `shared.ts` states — a caller asking for 1,000 is refused there
 * rather than quietly handed 100, and that answer must not depend on which
 * router they asked.
 *
 * `search` is a filter and never a way out of the shop: it is `and`-ed onto a
 * predicate that already carries `ctx.shopId`, and no shape of input removes
 * that half.
 */
const pageInput = listInput
  .unwrap()
  .extend({
    /** The previous page's `nextCursor`, opaque. Absent starts at the top. */
    cursor: z.string().max(200).optional(),
    search: z.string().trim().max(120).optional(),
    status: z.enum(["all", "published", "draft"]).default("all"),
  })
  .optional();

/**
 * The refusal, as a code the phone can localise.
 *
 * `BAD_REQUEST` rather than a `{ ok: false }` body, because tRPC clients branch
 * on errors and a mutation that "succeeded" with a refusal inside it is the
 * shape every caller forgets to check. `cause` carries the machine-readable
 * kind; the message is a fallback for a log, never something to show a seller
 * — `@sailo/i18n/native` holds the wording the app renders.
 */
function refuse(refusal: SaveProductRefusal): never {
  throw new TRPCError({
    code: refusal.kind === "not_found" ? "NOT_FOUND" : "BAD_REQUEST",
    message: refusal.kind,
    cause: refusal,
  });
}

/** The shop row, which the write needs for its currency and its plan. */
async function shopOf(shopId: string) {
  return found(
    await getDb().query.shops.findFirst({ where: eq(shops.id, shopId) }),
    "shop",
  );
}

/**
 * A variant as the phone sends it: already numbers, never strings.
 *
 * `nullable()` on the money and the count, and the two nulls do not mean the
 * same thing as zero. A blank price is "same as the product" and a blank stock
 * is "nobody is counting" — those rules are `@sailo/core/variants`' and are not
 * restated here, which is why the schema carries `null` through rather than
 * defaulting either to `0`.
 */
const variantInput = z.object({
  options: z.record(z.string(), z.string()),
  sku: z.string().max(60).nullish(),
  priceCents: z.number().int().min(0).nullish(),
  compareAtCents: z.number().int().min(0).nullish(),
  stockQuantity: z.number().int().min(0).nullish(),
  isAvailable: z.boolean().optional(),
  imageUrl: z.string().nullish(),
});

const fileInput = z.object({
  name: z.string().max(200).nullish(),
  url: z.string(),
  sizeBytes: z.number().int().min(0).nullish(),
  contentType: z.string().max(120).nullish(),
});

/**
 * The product a phone posts.
 *
 * Deliberately not a mirror of the row. Every URL here is checked
 * server-side — `isStoredFileUrl` on the files, `isRenderableImageUrl` on the
 * images, `isPublicLinkUrl` on the join link — inside `saveProduct`, because a
 * `z.url()` proves a string parses and proves nothing about whether this
 * server should be fetching it. `slug`, `position` and `stripePriceId` are
 * absent because they are the server's to decide.
 */
const productInput = z.object({
  id: z.uuid().nullish(),
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).nullish(),
  priceCents: z.number().int().min(0),
  compareAtCents: z.number().int().min(0).nullish(),
  kind: z.enum(PRODUCT_KIND_VALUES),
  categoryId: z.uuid().nullish(),
  tags: z.array(z.string().max(40)).max(24).optional(),
  options: z
    .array(z.object({ name: z.string(), values: z.array(z.string()) }))
    .optional(),
  variants: z.array(variantInput).max(200).optional(),
  files: z.array(fileInput).max(20).optional(),
  imageUrls: z.array(z.string()).max(16).optional(),

  trackInventory: z.boolean().optional(),
  stockQuantity: z.number().int().min(0).nullish(),

  releaseOnPayment: z.boolean().optional(),
  downloadLimit: z.number().int().min(0).max(1000).nullish(),
  downloadExpiryDays: z.number().int().min(0).max(3650).nullish(),

  durationMinutes: z.number().int().min(0).max(60 * 24 * 30).nullish(),
  serviceMode: z.enum(["in_person", "online"]).optional(),
  serviceLocation: z.string().max(500).nullish(),
  bookingEnabled: z.boolean().optional(),
  bookingLeadHours: z.number().int().min(0).max(24 * 365).optional(),

  eventStartsAt: z.coerce.date().nullish(),
  eventJoinUrl: z.string().max(500).nullish(),

  billingInterval: z.string().max(20).nullish(),
  trialDays: z.number().int().min(0).nullish(),

  inStock: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isPublished: z.boolean().optional(),
});

export const productsRouter = router({
  /**
   * A page of the catalogue, newest first, keyset-paged.
   *
   * `cursor` is the last row of the previous page rather than a count of rows
   * skipped — see `@sailo/commerce/pagination` for why offset paging drops
   * rows here. `nextCursor` is null exactly when the list is exhausted, so a
   * short page never has to be guessed at.
   */
  list: shopProcedure.input(pageInput).query(async ({ ctx, input }) => {
    const limit = input?.limit ?? 50;

    /*
     * The predicate, the ordering and the relation set are
     * `@sailo/commerce/catalog` — the same ones the admin list reads. The shop
     * scope is not a parameter this passes, which is what makes it impossible
     * for a filter to widen it.
     */
    const rows = await sellerCataloguePage({
      shopId: ctx.shopId,
      filter: { status: input?.status === "all" ? undefined : input?.status, search: input?.search },
      after: olderThan(products, cursorFrom(input?.cursor)),
      limit,
    });

    return pageOf(rows, limit);
  }),

  /**
   * One product, with everything a detail screen renders in the same round
   * trip — images to show it, variants to price it.
   *
   * The variants come back raw rather than resolved: a blank variant price
   * means "same as the product" and a blank stock means "nobody is
   * counting", and those rules already exist once, in `@sailo/core/variants`.
   * Resolving them here would be a second copy that can disagree with the
   * storefront's.
   *
   * `sellerProduct` is the admin form's read too, and it brings `files` — which
   * this router's own query used to omit. A digital product opened here and
   * saved would have gone back with no downloads attached, had the editor not
   * been writing them on a separate path.
   */
  get: shopProcedure
    .input(byId)
    .query(async ({ ctx, input }) => found(await sellerProduct(ctx.shopId, input.id), "product")),

  /**
   * Create or update, in the same call the admin form makes.
   *
   * Everything that decides whether this is a legal product — the category's
   * ownership, the membership's billing terms, the file URLs, the plan's
   * product limit — is `@sailo/commerce/products`', not this file's. That is
   * the point of the extraction: a rule enforced only in the web form is a
   * rule a phone does not have, and the product limit in particular is a
   * paid-plan boundary that a client must never be trusted to respect.
   */
  save: shopProcedure.input(productInput).mutation(async ({ ctx, input }) => {
    const shop = await shopOf(ctx.shopId);
    const result = await saveProduct(shop, { ...input, id: input.id ?? null });
    if (!result.ok) refuse(result.refusal);
    return { id: result.id, slug: result.slug, created: result.created };
  }),

  /**
   * `NOT_FOUND` on a row that was not this shop's, exactly as a read of it
   * would answer — the delete's own WHERE carries the scope, so "not yours"
   * arrives here as "nothing was deleted" and must not be told apart.
   */
  delete: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const gone = await deleteProduct(ctx.shopId, input.id);
    if (!gone) throw new TRPCError({ code: "NOT_FOUND", message: "No such product." });
    return { id: input.id };
  }),

  /**
   * Flips published and answers with the value it flipped to.
   *
   * Returned rather than assumed, because the write is `not is_published` in
   * SQL: the seller's phone and an open admin tab tapping at once cannot both
   * read `false` and both write `true`, and the caller that lost has to be
   * told which way the switch actually ended up.
   */
  togglePublished: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const isPublished = await toggleProductPublished(ctx.shopId, input.id);
    if (isPublished === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No such product." });
    }
    return { id: input.id, isPublished };
  }),
});
