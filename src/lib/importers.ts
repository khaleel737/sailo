import "server-only";
import Papa from "papaparse";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, clients, productImages, products } from "@/db/schema";
import { field, parseBool, parseMoneyField } from "@/lib/csv";
import { normalizePhone, slugify } from "@/lib/utils";
import { atProductLimit } from "@/lib/plans";

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

  for (const [index, raw] of rows.entries()) {
    const line = index + 2; // +1 for header, +1 for 1-based
    const title = field(raw, "Title", "Name", "Product");

    if (!title) {
      report.errors.push({ row: line, message: "Missing Title" });
      report.skipped += 1;
      continue;
    }

    const handle = slugify(field(raw, "Handle", "Slug") || title);
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
      inStock: parseBool(field(raw, "In Stock", "Available"), true),
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
    const imageSrc = field(raw, "Image Src", "Images", "Image");
    if (imageSrc) {
      const urls = imageSrc
        .split(/[|\n]/)
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u))
        .slice(0, 8);

      await db.delete(productImages).where(eq(productImages.productId, productId));
      if (urls.length) {
        await db.insert(productImages).values(
          urls.map((url, i) => ({ productId, url, position: i })),
        );
      }
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
