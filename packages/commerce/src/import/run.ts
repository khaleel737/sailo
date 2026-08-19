import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  categories,
  importJobs,
  importLinks,
  products,
  type ImportReportRow,
  type Shop,
} from "@sailo/db/schema";
import { productLimit } from "@sailo/core/plans";
import { slugify } from "@sailo/core/slug";
import { fetchGuarded } from "@sailo/webhooks/fetch";
import { storeUpload } from "@sailo/storage/blob";
import { saveProduct } from "../catalog/products";
import { planImport, type ImportPlan, type RowVerdict } from "./plan";
import type { ImportProduct, ImportSource, SourceBatch } from "./rows";

/**
 * Writing an import — spec 47.
 *
 * The one thing to understand before changing anything here: **this function
 * decides nothing.** `planImport` decides, purely, and the seller approves that
 * plan; this executes it. Any judgement made here instead would be judgement
 * the preview did not show, which is the same as not having a preview.
 *
 * And it writes through `saveProduct`, the same function the admin form and the
 * phone use. Six importers would be six places for the slug rule, the plan
 * ceiling, the variant normalisation and the digital-delivery refusals to
 * drift; there is one, and this is a caller of it.
 */

/** Reported per row, so a seller downloading the CSV sees every one. */
const MAX_REPORT = 500;

/**
 * How many images one product may bring, and how many products may be fetching
 * at once.
 *
 * Sequential per product and small in parallel across them, deliberately. Each
 * image is an outbound request to a host the seller named, and a hundred at
 * once is a burst from our address at somebody else's CDN.
 */
const MAX_IMAGES_PER_PRODUCT = 8;

export type RunOptions = {
  shop: Shop;
  jobId: string;
  batch: SourceBatch;
  /** True runs the plan and writes nothing. */
  dryRun: boolean;
};

export type RunResult = {
  plan: ImportPlan;
  report: ImportReportRow[];
};

/**
 * Plan the batch against what this shop already has.
 *
 * Split from the run so the preview and the write build the plan the same way,
 * from the same three reads. A preview that planned against different inputs
 * from the run is a preview of a different import.
 */
export async function buildPlan(shop: Shop, batch: SourceBatch): Promise<ImportPlan> {
  const db = getDb();

  const [existing, links, [counted]] = await Promise.all([
    db
      .select({ slug: products.slug })
      .from(products)
      .where(eq(products.shopId, shop.id)),
    db
      .select({ externalId: importLinks.externalId, localId: importLinks.localId })
      .from(importLinks)
      .where(
        and(eq(importLinks.shopId, shop.id), eq(importLinks.source, batch.source), eq(importLinks.entity, "product")),
      ),
    db
      .select({ count: sql<string>`count(*)` })
      .from(products)
      .where(eq(products.shopId, shop.id)),
  ]);

  const current = Number(counted?.count ?? 0);
  const limit = productLimit(shop);

  return planImport({
    batch,
    shopCurrency: shop.currency,
    takenSlugs: new Set(existing.map((p) => p.slug.toLowerCase())),
    /*
     * Only links whose target still exists would be ideal, and it is
     * deliberately not checked here: a link pointing at a deleted product
     * reaches `saveProduct` as an id, which answers `not_found`, and the row is
     * reported as failed rather than silently re-created. A seller who deleted
     * a product on purpose and re-imported gets told, which is the honest
     * outcome — re-creating it silently would undo a deliberate deletion.
     */
    links: new Map(links.map((l) => [l.externalId, l.localId])),
    headroom: limit === null ? null : Math.max(0, limit - current),
  });
}

/**
 * Run a plan.
 *
 * **A cancelled or failed run leaves what it wrote.** Rows already created are
 * real products and the report says which. Rolling back a bulk product write is
 * a different and worse feature: it would have to delete rows a seller may
 * already have edited, and an import that half-succeeded and then removed the
 * successful half is the outcome nobody can recover from.
 */
export async function runImport(opts: RunOptions): Promise<RunResult> {
  const { shop, batch, dryRun } = opts;
  const db = getDb();

  const plan = await buildPlan(shop, batch);
  const report: ImportReportRow[] = [];

  if (plan.refusal) {
    return { plan, report };
  }

  if (!dryRun) {
    await db
      .update(importJobs)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(importJobs.id, opts.jobId));
  }

  const byExternalId = new Map(batch.products.map((p) => [p.externalId, p]));

  /*
   * A dry run reports the plan's own counts, and a real one recounts as it
   * writes.
   *
   * They are not the same number and must not be: the plan says what *would*
   * happen, and a write can still be refused by `saveProduct` for something
   * only it can see. Zeroing the counters for a dry run — which is what the
   * first version of this did — made every preview report "0 to create", so
   * the one screen whose whole job is to say what will happen said nothing
   * would.
   */
  const counts = dryRun
    ? { ...plan.counts }
    : { ...plan.counts, created: 0, updated: 0, failed: plan.counts.failed };

  for (const verdict of plan.rows) {
    if (verdict.action === "skip" || verdict.action === "fail") {
      push(report, {
        action: verdict.action,
        label: verdict.label,
        externalId: verdict.externalId,
        reason: verdict.reason,
      });
      continue;
    }

    const source = byExternalId.get(verdict.externalId);
    if (!source) continue;

    if (dryRun) {
      push(report, {
        action: verdict.action,
        label: verdict.label,
        externalId: verdict.externalId,
        reason: verdict.notes.join(" · ") || undefined,
      });
      continue;
    }

    const written = await writeRow(shop, batch.source, source, verdict);
    if (written.ok) {
      if (verdict.action === "create") counts.created += 1;
      else counts.updated += 1;
    } else {
      counts.failed += 1;
    }

    push(report, {
      action: written.ok ? verdict.action : "fail",
      label: verdict.label,
      externalId: verdict.externalId,
      reason: [...verdict.notes, ...written.notes].join(" · ") || undefined,
    });
  }

  if (!dryRun) {
    await db
      .update(importJobs)
      .set({
        status: "done",
        finishedAt: new Date(),
        counts,
        report,
      })
      .where(eq(importJobs.id, opts.jobId));
  }

  return { plan: { ...plan, counts }, report };
}

/* -------------------------------------------------------------------------- */
/*  One row                                                                    */
/* -------------------------------------------------------------------------- */

async function writeRow(
  shop: Shop,
  source: ImportSource,
  product: ImportProduct,
  verdict: RowVerdict,
): Promise<{ ok: boolean; notes: string[] }> {
  const db = getDb();
  const notes: string[] = [];

  const categoryId = product.categoryName
    ? await categoryFor(shop.id, product.categoryName)
    : null;

  const images = await rehostImages(shop.id, product.imageUrls, notes);

  const saved = await saveProduct(shop, {
    id: verdict.localId ?? null,
    title: product.title,
    description: product.description,
    priceCents: product.priceCents,
    compareAtCents: product.compareAtCents,
    kind: product.kind,
    categoryId,
    tags: product.tags,
    sku: product.sku,
    options: product.options,
    variants: product.variants.map((v) => ({
      options: v.options,
      sku: v.sku,
      priceCents: v.priceCents,
      compareAtCents: v.compareAtCents,
      stockQuantity: v.stockQuantity,
      isAvailable: v.isAvailable,
      /*
       * Not the source's URL. A variant image on `cdn.shopify.com` fails the
       * storefront's `next.config.ts` host allowlist and renders as a broken
       * image — and `isRenderableImageUrl` would drop it anyway. Re-hosting a
       * per-variant image is worth doing and is not done here: it multiplies
       * the outbound requests by the variant count for a picture most
       * catalogues do not set.
       */
      imageUrl: null,
    })),
    imageUrls: images,
    trackInventory: product.trackInventory,
    stockQuantity: product.stockQuantity,
    /*
     * A digital product arrives with its file slot empty and stays that way.
     * The bytes live behind the source's auth and fetching them would mean
     * holding a credential to pull arbitrary content. `digitalDelivery: "file"`
     * with no files is a saveable draft — the refusal is only for `link` and
     * `code`, which are single fields — and the report tells the seller which
     * products need one.
     */
    digitalDelivery: "file",
    isPublished: product.isPublished,
  });

  if (!saved.ok) {
    notes.push(`refused:${saved.refusal.kind}`);
    return { ok: false, notes };
  }

  /*
   * The link, last and unconditional.
   *
   * `onConflictDoUpdate` rather than an insert: a re-run has to move
   * `last_seen_at` and, if a seller deleted and re-imported, point at the new
   * local row. The primary key does the deciding, so two concurrent jobs
   * cannot write two links for one external id.
   */
  await db
    .insert(importLinks)
    .values({
      shopId: shop.id,
      source,
      entity: "product",
      externalId: product.externalId,
      localId: saved.id,
    })
    .onConflictDoUpdate({
      target: [importLinks.shopId, importLinks.source, importLinks.entity, importLinks.externalId],
      set: { localId: saved.id, lastSeenAt: new Date() },
    });

  return { ok: true, notes };
}

/**
 * The seller's own grouping, created on demand.
 *
 * `onConflictDoNothing` on the slug and then a read, because the cache key a
 * caller would use is the *name* and the constraint is on the *slug* — "T
 * Shirts" and "T-Shirts" collide, and the version that threw took the whole
 * import down on a row it was equipped to handle.
 */
async function categoryFor(shopId: string, name: string): Promise<string | null> {
  const db = getDb();
  const slug = slugify(name);
  if (!slug) return null;

  const [created] = await db
    .insert(categories)
    .values({ shopId, name: name.slice(0, 60), slug })
    .onConflictDoNothing({ target: [categories.shopId, categories.slug] })
    .returning({ id: categories.id });

  if (created) return created.id;

  const found = await db.query.categories.findFirst({
    where: and(eq(categories.shopId, shopId), eq(categories.slug, slug)),
    columns: { id: true },
  });
  return found?.id ?? null;
}

/**
 * Remote images, fetched through the SSRF guard and re-hosted.
 *
 * Two reasons, and both have bitten this repo. `PRODUCTION-PLAN.md` §2 item 2:
 * `lib/og.tsx` fetched any URL it was handed and four write paths had to be
 * fixed. And the storefront's `next.config.ts` only allows known image hosts,
 * so a `cdn.shopify.com` URL written straight into `product_images` renders as
 * a broken image on every card.
 *
 * **One image failing fails the row's picture, never the job.** A seller with
 * one unreachable photo out of six hundred should get 199 of 200 products and
 * a line in the report, not a stopped import.
 */
async function rehostImages(
  shopId: string,
  urls: string[],
  notes: string[],
): Promise<string[]> {
  const stored: string[] = [];

  for (const url of urls.slice(0, MAX_IMAGES_PER_PRODUCT)) {
    const fetched = await fetchGuarded(url);
    if (!fetched.ok) {
      notes.push(`image_failed:${fetched.reason}`);
      continue;
    }

    /*
     * The bytes decide the type, not the URL and not the seller. `storeUpload`
     * checks the media type against the allowlist for this purpose and the size
     * against the ceiling — the same two refusals an uploaded file meets, so an
     * imported image cannot be something an uploaded one could not be.
     */
    const contentType = (fetched.contentType ?? "").split(";")[0]?.trim() || "image/jpeg";
    const name = fileNameFor(url, contentType);

    const result = await storeUpload(
      shopId,
      "image",
      new File([new Uint8Array(fetched.body)], name, { type: contentType }),
    );

    if (!result.ok) {
      notes.push(`image_refused:${result.reason}`);
      continue;
    }
    stored.push(result.url);
  }

  return stored;
}

/**
 * A filename for a fetched image.
 *
 * Taken from the URL's last segment when it looks like one, because a seller
 * looking at their media later recognises `speckled-mug.jpg` and does not
 * recognise a uuid. Sanitised hard: the value ends up in a storage path, and
 * `storeUpload` puts a uuid in front of it anyway so a collision is impossible
 * either way.
 */
function fileNameFor(url: string, contentType: string): string {
  const extension = contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "jpg";
  let base = "image";
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    const cleaned = last.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9._-]/g, "");
    if (cleaned) base = cleaned.slice(0, 60);
  } catch {
    // A URL that will not parse never reached `fetchGuarded`, so this is
    // unreachable — kept because a filename must never be the thing that throws.
  }
  return `${base}.${extension}`;
}

function push(report: ImportReportRow[], row: ImportReportRow) {
  // Capped, and the *counts* are not — deriving a total from a truncated list
  // is how a silent cap gets reported as a complete run.
  if (report.length < MAX_REPORT) report.push(row);
}
