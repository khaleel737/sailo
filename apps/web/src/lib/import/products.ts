import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { categories, productImages, products, productVariants, type ProductOption, type VariantOptions } from "@sailo/db/schema";
import { firstRow, maybeRow } from "@sailo/core/invariant";
import { field, parseBool, parseMoneyField } from "@/lib/csv";
import { slugify } from "@/lib/utils";
import { isRenderableImageUrl } from "@/lib/file-urls";
import { atProductLimit } from "@/lib/plans";
import { MAX_VARIANTS, optionKey } from "@sailo/core/variants";
import { parse, type Row } from "./parse";
import { KINDS, readGroupOptions, readRowOptions, readStock } from "./product-rows";
import type { ImportReport } from "./types";

/** Importing a catalogue, variants and all. */

/**
 * Writes a handle's variant rows, matching on the combination so an import run
 * twice updates prices rather than orphaning the variants past orders point at.
 */
async function importVariants(input: {
  productId: string;
  options: ProductOption[];
  group: Row[];
  productPriceCents: number;
  tracksInventory: boolean;
  /** The shop's, so a price cell becomes the right number of minor units. */
  currency: string;
}): Promise<number> {
  const db = getDb();
  const { productId, options } = input;

  const existing = await db.query.productVariants.findMany({
    where: eq(productVariants.productId, productId),
  });
  const byKey = new Map(existing.map((v) => [optionKey(v.options), v]));

  if (options.length === 0) {
    if (existing.length) {
      await db
        .delete(productVariants)
        .where(eq(productVariants.productId, productId));
    }
    return 0;
  }

  const seen = new Set<string>();
  let position = 0;

  for (const { raw } of input.group) {
    const pairs = readRowOptions(raw);
    if (pairs.length === 0) continue;

    const combination: VariantOptions = {};
    for (const option of options) {
      const match = pairs.find(
        (p) => p.name.toLowerCase() === option.name.toLowerCase(),
      );
      if (match) combination[option.name] = match.value;
    }
    // Every axis has to be answered, or it isn't a real combination.
    if (Object.keys(combination).length !== options.length) continue;

    const key = optionKey(combination);
    if (seen.has(key) || seen.size >= MAX_VARIANTS) continue;
    seen.add(key);

    const price = parseMoneyField(field(raw, "Variant Price", "Price"), input.currency);
    const compareRaw = field(raw, "Variant Compare At Price", "Compare At Price");
    const compare = compareRaw ? parseMoneyField(compareRaw, input.currency) : null;

    const values = {
      options: combination,
      sku: field(raw, "Variant SKU", "SKU").slice(0, 60) || null,
      // Matching the product's own price means "inherit", not "override".
      priceCents: price !== null && price !== input.productPriceCents ? price : null,
      compareAtCents: compare !== null && compare > (price ?? 0) ? compare : null,
      stockQuantity: input.tracksInventory
        ? readStock(field(raw, "Variant Inventory Qty", "Inventory Qty", "Stock"))
        : null,
      isAvailable: parseBool(field(raw, "In Stock", "Available"), true),
      position: position++,
      updatedAt: new Date(),
    };

    const match = byKey.get(key);
    if (match) {
      await db
        .update(productVariants)
        .set(values)
        .where(eq(productVariants.id, match.id));
      byKey.delete(key);
    } else {
      await db.insert(productVariants).values({ ...values, productId });
    }
  }

  for (const stale of byKey.values()) {
    await db.delete(productVariants).where(eq(productVariants.id, stale.id));
  }

  return seen.size;
}

export async function importProducts(opts: {
  shopId: string;
  csv: string;
  dryRun: boolean;
  /**
   * The shop's currency, which decides how a price cell becomes an integer.
   * "1000" in a JPY shop is ¥1,000 — a thousand minor units — where the same
   * cell in a USD shop is $10.00. Without this every imported price in a
   * zero-decimal currency would be a hundred times too large.
   */
  currency: string;
  /** Only the billing fields are needed to check the product cap. */
  plan: { plan: string; subscriptionStatus: string | null };
}): Promise<ImportReport> {
  const db = getDb();
  const rows = parse(opts.csv);
  const report: ImportReport = {
    type: "products",
    parsed: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    preview: [],
  };

  const { count: existingCount } = firstRow(await db
    .select({ count: sql<string>`count(*)` })
    .from(products)
    .where(eq(products.shopId, opts.shopId)), "count aggregate");
  let liveCount = Number(existingCount);

  // Categories are created on demand and cached so one lookup covers the file.
  const catCache = new Map<string, string>();
  for (const c of await db.query.categories.findMany({
    where: eq(categories.shopId, opts.shopId),
  })) {
    catCache.set(c.name.toLowerCase(), c.id);
  }

  let position = liveCount;

  // A product's variants arrive as separate rows sharing one handle, so the
  // file is grouped before anything is written — otherwise each row would
  // overwrite the last as if it were a different product.
  const groups = new Map<string, Row[]>();
  for (const [index, raw] of rows.entries()) {
    const line = index + 2; // +1 for header, +1 for 1-based
    const title = field(raw, "Title", "Name", "Product");
    const handle = slugify(field(raw, "Handle", "Slug") || title);

    if (!handle) {
      report.errors.push({ row: line, message: "Missing Title" });
      report.skipped += 1;
      continue;
    }

    const group = groups.get(handle) ?? [];
    group.push({ line, raw });
    groups.set(handle, group);
  }

  for (const [handle, group] of groups) {
    // The row carrying the title owns the product's own details; the rest are
    // there for their variant.
    const head =
      group.find(({ raw }) => field(raw, "Title", "Name", "Product")) ??
      group[0];
    // Groups are built from rows, so one always exists.
    if (!head) continue;
    const { line, raw } = head;
    const title = field(raw, "Title", "Name", "Product") || handle;

    const priceCents =
      parseMoneyField(field(raw, "Price", "Variant Price"), opts.currency) ?? 0;
    const compareRaw = field(raw, "Compare At Price", "Variant Compare At Price");
    const compareAtCents = compareRaw ? parseMoneyField(compareRaw, opts.currency) : null;

    if (compareAtCents !== null && compareAtCents < priceCents) {
      report.errors.push({
        row: line,
        message: `"${title}": compare-at price is below the price`,
      });
    }

    const kindRaw = field(raw, "Type", "Kind", "Product Category").toLowerCase();
    const kind = KINDS.has(kindRaw) ? kindRaw : "physical";

    const options = readGroupOptions(group);
    // Stock numbers in the file are a seller asking for stock to be counted.
    const tracksInventory = group.some(
      (r) =>
        field(r.raw, "Variant Inventory Qty", "Inventory Qty", "Stock") !== "",
    );

    const existing = await db.query.products.findFirst({
      where: and(eq(products.shopId, opts.shopId), eq(products.slug, handle)),
    });

    if (!existing && atProductLimit(opts.plan, liveCount)) {
      report.errors.push({
        row: line,
        message: `"${title}": product limit reached on your plan`,
      });
      report.skipped += 1;
      continue;
    }

    if (opts.dryRun) {
      report.preview.push({
        row: line,
        label: title,
        action: existing ? "update" : "create",
      });
      if (existing) report.updated += 1;
      else {
        report.created += 1;
        liveCount += 1;
      }
      continue;
    }

    // Resolve or create the category.
    let categoryId: string | null = null;
    const categoryName = field(raw, "Category", "Collection", "Product Type");
    if (categoryName) {
      const key = categoryName.toLowerCase();
      const cached = catCache.get(key);
      if (cached) {
        categoryId = cached;
      } else {
        /*
         * No row means the slug already existed, which the lookup below is
         * written to recover from — note the `created?.id` it starts with.
         * `firstRow` threw there instead, and it does not take a concurrent
         * import to reach: the cache is keyed by name but the constraint is on
         * the slug, so "T Shirts" and "T-Shirts" in one file collide and the
         * whole import fails on a row it was equipped to handle.
         */
        const created = maybeRow(await db
          .insert(categories)
          .values({
            shopId: opts.shopId,
            name: categoryName.slice(0, 60),
            slug: slugify(categoryName),
            position: catCache.size,
          })
          .onConflictDoNothing({ target: [categories.shopId, categories.slug] })
          .returning({ id: categories.id }));

        categoryId =
          created?.id ??
          (
            await db.query.categories.findFirst({
              where: and(
                eq(categories.shopId, opts.shopId),
                eq(categories.slug, slugify(categoryName)),
              ),
            })
          )?.id ??
          null;
        if (categoryId) catCache.set(key, categoryId);
      }
    }

    const tags = field(raw, "Tags")
      .split(/[,|]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);

    const values = {
      title: title.slice(0, 140),
      description: field(raw, "Body (HTML)", "Description", "Body") || null,
      priceCents,
      compareAtCents:
        compareAtCents !== null && compareAtCents >= priceCents
          ? compareAtCents
          : null,
      kind,
      categoryId,
      tags,
      options,
      trackInventory: tracksInventory,
      stockQuantity:
        tracksInventory && options.length === 0
          ? readStock(field(raw, "Variant Inventory Qty", "Inventory Qty", "Stock"))
          : null,
      // A product is in stock if any of its rows says so.
      inStock: group.some((r) =>
        parseBool(field(r.raw, "In Stock", "Available"), true),
      ),
      isFeatured: parseBool(field(raw, "Featured"), false),
      isPublished: parseBool(field(raw, "Published", "Status"), true),
      updatedAt: new Date(),
    };

    let productId: string;
    if (existing) {
      await db.update(products).set(values).where(eq(products.id, existing.id));
      productId = existing.id;
      report.updated += 1;
    } else {
      const created = firstRow(await db
        .insert(products)
        .values({
          ...values,
          shopId: opts.shopId,
          slug: handle,
          position: position++,
        })
        .returning({ id: products.id }), "created");
      productId = created.id;
      report.created += 1;
      liveCount += 1;
    }

    // Images are replaced wholesale, matching the product form's behaviour.
    const imageSrc = group
      .map((r) => field(r.raw, "Image Src", "Images", "Image"))
      .filter(Boolean)
      .join(" | ");
    if (imageSrc) {
      const urls = [
        ...new Set(
          imageSrc
            .split(/[|\n]/)
            .map((u) => u.trim())
            /*
             * A scheme test is not a host check — it accepts
             * `http://169.254.169.254/` — and these URLs are fetched
             * server-side when the product's social card renders. Same
             * allowlist as the product form, so an import cannot store what
             * the form would refuse.
             */
            .filter(isRenderableImageUrl),
        ),
      ].slice(0, 8);

      await db.delete(productImages).where(eq(productImages.productId, productId));
      if (urls.length) {
        await db.insert(productImages).values(
          urls.map((url, i) => ({ productId, url, position: i })),
        );
      }
    }

    const variantCount = await importVariants({
      productId,
      options,
      group,
      productPriceCents: priceCents,
      tracksInventory,
      currency: opts.currency,
    });

    // Option columns that produced no complete combination would leave a
    // picker the buyer can't satisfy, so the product goes back to being sold
    // as one thing.
    if (options.length > 0 && variantCount === 0) {
      await db
        .update(products)
        .set({ options: [] })
        .where(eq(products.id, productId));
      report.errors.push({
        row: line,
        message: `"${title}": option columns didn't describe a complete variant, so options were skipped`,
      });
    }
  }

  return report;
}

/* -------------------------------------------------------------------------- */
/*  Clients                                                                    */
/* -------------------------------------------------------------------------- */
