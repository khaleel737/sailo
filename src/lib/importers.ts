import "server-only";
import Papa from "papaparse";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  categories,
  clients,
  productImages,
  products,
  productVariants,
  type ProductOption,
  type VariantOptions,
} from "@/db/schema";
import { field, parseBool, parseMoneyField } from "@/lib/csv";
import { normalizePhone, slugify } from "@/lib/utils";
import { atProductLimit } from "@/lib/plans";
import { MAX_OPTIONS, MAX_VARIANTS, normalizeOptions, optionKey } from "@/lib/variants";

export const IMPORT_TYPES = ["products", "clients"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export function isImportType(value: string): value is ImportType {
  return (IMPORT_TYPES as readonly string[]).includes(value);
}

export type RowIssue = { row: number; message: string };

export type ImportReport = {
  type: ImportType;
  parsed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: RowIssue[];
  /** Set on a dry run so the UI can show what would happen. */
  preview?: { row: number; label: string; action: "create" | "update" }[];
};

const MAX_ROWS = 5000;
const KINDS = new Set(["physical", "digital", "service"]);

function parse(csv: string) {
  const result = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return result.data.slice(0, MAX_ROWS);
}

/* -------------------------------------------------------------------------- */
/*  Products                                                                   */
/* -------------------------------------------------------------------------- */

type Row = { line: number; raw: Record<string, string> };

/**
 * Reads the positional option columns Shopify writes: `Option1 Name` with
 * `Option1 Value`, and so on. A row with no values isn't a variant.
 */
function readRowOptions(raw: Record<string, string>) {
  const pairs: { name: string; value: string }[] = [];
  for (let i = 1; i <= MAX_OPTIONS; i++) {
    const name = field(raw, `Option${i} Name`);
    const value = field(raw, `Option${i} Value`);
    if (value) pairs.push({ name: name || `Option ${i}`, value });
  }
  return pairs;
}

/**
 * Collapses a handle's rows into one product plus its variants, preserving the
 * order values were first seen so "Small, Medium, Large" doesn't come back
 * alphabetised.
 */
function readGroupOptions(rows: Row[]): ProductOption[] {
  const byName = new Map<string, { name: string; values: string[] }>();

  for (const { raw } of rows) {
    for (const { name, value } of readRowOptions(raw)) {
      const key = name.toLowerCase();
      const entry = byName.get(key) ?? { name, values: [] };
      if (!entry.values.some((v) => v.toLowerCase() === value.toLowerCase())) {
        entry.values.push(value);
      }
      byName.set(key, entry);
    }
  }

  return normalizeOptions([...byName.values()]);
}

function readStock(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(/[^0-9-]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

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

    const price = parseMoneyField(field(raw, "Variant Price", "Price"));
    const compareRaw = field(raw, "Variant Compare At Price", "Compare At Price");
    const compare = compareRaw ? parseMoneyField(compareRaw) : null;

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
    preview: opts.dryRun ? [] : undefined,
  };

  const [{ count: existingCount }] = await db
    .select({ count: sql<string>`count(*)` })
    .from(products)
    .where(eq(products.shopId, opts.shopId));
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
    const { line, raw } = head;
    const title = field(raw, "Title", "Name", "Product") || handle;

    const priceCents =
      parseMoneyField(field(raw, "Price", "Variant Price")) ?? 0;
    const compareRaw = field(raw, "Compare At Price", "Variant Compare At Price");
    const compareAtCents = compareRaw ? parseMoneyField(compareRaw) : null;

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
      report.preview!.push({
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
      if (catCache.has(key)) {
        categoryId = catCache.get(key)!;
      } else {
        const [created] = await db
          .insert(categories)
          .values({
            shopId: opts.shopId,
            name: categoryName.slice(0, 60),
            slug: slugify(categoryName),
            position: catCache.size,
          })
          .onConflictDoNothing({ target: [categories.shopId, categories.slug] })
          .returning({ id: categories.id });

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
      const [created] = await db
        .insert(products)
        .values({
          ...values,
          shopId: opts.shopId,
          slug: handle,
          position: position++,
        })
        .returning({ id: products.id });
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
            .filter((u) => /^https?:\/\//i.test(u)),
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

export async function importClients(opts: {
  shopId: string;
  csv: string;
  dryRun: boolean;
}): Promise<ImportReport> {
  const db = getDb();
  const rows = parse(opts.csv);
  const report: ImportReport = {
    type: "clients",
    parsed: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    preview: opts.dryRun ? [] : undefined,
  };

  // Within one file, the same person must not create two rows.
  const seen = new Set<string>();

  for (const [index, raw] of rows.entries()) {
    const line = index + 2;

    const first = field(raw, "First Name", "Firstname");
    const last = field(raw, "Last Name", "Lastname");
    const name =
      field(raw, "Name", "Customer Name") || [first, last].filter(Boolean).join(" ");

    const email = field(raw, "Email", "Email Address").toLowerCase() || null;
    const phoneRaw = field(raw, "Phone", "Phone Number");
    const phone = phoneRaw ? normalizePhone(phoneRaw) || null : null;

    if (!email && !phone) {
      report.errors.push({
        row: line,
        message: "Needs an email or a phone number to identify the customer",
      });
      report.skipped += 1;
      continue;
    }
    if (email && !email.includes("@")) {
      report.errors.push({ row: line, message: `"${email}" is not a valid email` });
      report.skipped += 1;
      continue;
    }

    const key = email ?? `phone:${phone}`;
    if (seen.has(key)) {
      report.errors.push({
        row: line,
        message: `Duplicate of an earlier row (${key})`,
      });
      report.skipped += 1;
      continue;
    }
    seen.add(key);

    const existing = await db.query.clients.findFirst({
      where: and(
        eq(clients.shopId, opts.shopId),
        email ? eq(clients.email, email) : eq(clients.phone, phone!),
      ),
    });

    if (opts.dryRun) {
      report.preview!.push({
        row: line,
        label: name || email || phone || "Unnamed",
        action: existing ? "update" : "create",
      });
      if (existing) report.updated += 1;
      else report.created += 1;
      continue;
    }

    const address = {
      addressLine1: field(raw, "Address1", "Address", "Street") || null,
      addressLine2: field(raw, "Address2", "Apartment") || null,
      city: field(raw, "City") || null,
      region: field(raw, "Province", "State", "Region") || null,
      postalCode: field(raw, "Zip", "Postal Code", "Postcode") || null,
      country: field(raw, "Country") || null,
    };
    // Never blank a stored value because this file didn't carry it.
    const addressUpdate = Object.fromEntries(
      Object.entries(address).filter(([, v]) => v !== null),
    );

    const notes = field(raw, "Note", "Notes") || null;

    if (existing) {
      await db
        .update(clients)
        .set({
          name: name || existing.name,
          email: email ?? existing.email,
          phone: phone ?? existing.phone,
          ...addressUpdate,
          notes: notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, existing.id));
      report.updated += 1;
    } else {
      await db.insert(clients).values({
        shopId: opts.shopId,
        name: (name || email || phone || "Customer").slice(0, 120),
        email,
        phone,
        ...address,
        notes,
      });
      report.created += 1;
    }
  }

  return report;
}
