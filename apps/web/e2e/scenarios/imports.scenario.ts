import { beforeAll, describe, expect, it, vi } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  categories,
  clients,
  importJobs,
  importLinks,
  invoices,
  orders,
  productImages,
  productVariants,
  products,
  shops,
  user,
} from "@sailo/db/schema";
import type { SourceBatch } from "@sailo/commerce/import";

/**
 * Moving a catalogue in — spec 47, against a real database.
 *
 * The rules worth a scenario rather than a unit test are the ones about *rows*:
 * that a re-run updates instead of duplicating, that no order and no invoice is
 * ever written, that an unreachable image fails its row and not the job, and
 * that two concurrent jobs cannot both run. Every one of those is a claim about
 * what is in the database afterwards, and none of them can be proved from
 * object literals.
 *
 *   ./e2e/scenarios/up.sh
 *   npx vitest run --config vitest.scenarios.mts e2e/scenarios/imports.scenario.ts
 */

/**
 * The outbound image fetch, and the blob store, both replaced.
 *
 * Not because they are slow, but because what this file is asking about is the
 * *row* — whether a failed image fails one product or the whole import. Reaching
 * a real CDN would make the answer depend on somebody else's uptime, which is
 * the one thing a test about failure handling must not do.
 *
 * `fetchGuarded` itself is not under test here; its job is to refuse a private
 * address, and that is a property of the guard rather than of the importer.
 */
const fetched: string[] = [];
let imageFails = false;

vi.mock("@sailo/webhooks/fetch", () => ({
  fetchGuarded: async (url: string) => {
    fetched.push(url);
    if (imageFails) return { ok: false as const, reason: "answered 404" };
    return {
      ok: true as const,
      // A one-pixel PNG, so `storeUpload`'s type check sees a real image.
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      contentType: "image/png",
    };
  },
  isFetchableUrl: () => true,
}));

vi.mock("@sailo/storage/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sailo/storage/blob")>()),
  storeUpload: async (_shopId: string, _purpose: string, file: unknown) => ({
    ok: true as const,
    url: `https://store1.public.blob.vercel-storage.com/${(file as File).name}`,
    name: (file as File).name,
    sizeBytes: (file as File).size,
    contentType: (file as File).type,
  }),
}));

const { runImport } = await import("@sailo/commerce/import/server");
const { mapShopify } = await import("@sailo/commerce/import");

const db = getDb();
const uid = () => crypto.randomUUID();

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `seller-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `shop-${userId.slice(0, 8)}`,
      name: "Importing Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

/** A Shopify product node, in the shape the Admin API answers with. */
function node(over: Record<string, unknown> = {}) {
  return {
    id: `gid://shopify/Product/${uid().slice(0, 8)}`,
    title: "Speckled Mug",
    status: "ACTIVE",
    descriptionHtml: "<p>A good mug</p>",
    tags: ["kitchen"],
    options: [{ name: "Size", values: ["S", "L"] }],
    images: { nodes: [{ url: "https://cdn.shopify.com/mug.jpg" }] },
    collections: { nodes: [{ title: "Mugs" }] },
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/1",
          sku: "MUG-S",
          price: "19.99",
          requiresShipping: true,
          selectedOptions: [{ name: "Size", value: "S" }],
          inventoryItem: {
            tracked: true,
            inventoryLevels: { nodes: [{ quantities: [{ quantity: 5 }] }] },
          },
        },
        {
          id: "gid://shopify/ProductVariant/2",
          sku: "MUG-L",
          price: "22.50",
          requiresShipping: true,
          selectedOptions: [{ name: "Size", value: "L" }],
          inventoryItem: {
            tracked: true,
            inventoryLevels: { nodes: [{ quantities: [{ quantity: 2 }] }] },
          },
        },
      ],
    },
    ...over,
  };
}

function batchOf(nodes: ReturnType<typeof node>[]): SourceBatch {
  return { source: "shopify", ...mapShopify(nodes, "USD") };
}

async function claimJob(shopId: string) {
  const [job] = await db
    .insert(importJobs)
    .values({ shopId, source: "shopify", status: "running", startedAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: importJobs.id });
  return job;
}

beforeAll(async () => {
  assertLocalDatabase();
});

describe("a first import", () => {
  it("writes products, variants, a category and re-hosted images", async () => {
    imageFails = false;
    const shop = await makeShop();
    const job = await claimJob(shop.id);
    if (!job) throw new Error("fixture: job was not claimed");

    const nodes = [node(), node({ title: "Oat Bowl" })];
    const result = await runImport({
      shop,
      jobId: job.id,
      batch: batchOf(nodes),
      dryRun: false,
    });

    expect(result.plan.counts.created).toBe(2);

    const written = await db.query.products.findMany({
      where: eq(products.shopId, shop.id),
    });
    expect(written).toHaveLength(2);

    const mug = written.find((p) => p.title === "Speckled Mug");
    expect(mug?.priceCents).toBe(1999);
    expect(mug?.trackInventory).toBe(true);

    const variants = await db.query.productVariants.findMany({
      where: eq(productVariants.productId, mug?.id ?? ""),
    });
    expect(variants.map((v) => v.stockQuantity).toSorted()).toEqual([2, 5]);

    const cats = await db.query.categories.findMany({
      where: eq(categories.shopId, shop.id),
    });
    expect(cats.map((c) => c.name)).toEqual(["Mugs"]);

    /*
     * Re-hosted, not linked. A `cdn.shopify.com` URL written straight into
     * `product_images` fails the storefront's host allowlist and renders as a
     * broken image on every card.
     */
    const images = await db.query.productImages.findMany({
      where: eq(productImages.productId, mug?.id ?? ""),
    });
    expect(images).toHaveLength(1);
    expect(images[0]?.url).toContain("public.blob.vercel-storage.com");
    expect(images[0]?.url).not.toContain("shopify");
  });

  it("writes no order and no invoice, ever", async () => {
    /*
     * The rule the whole table is shaped around. `invoices` is a numbered
     * sequence a tax authority expects unbroken, and importing history would
     * either claim numbers for sales Sailo did not make or write orders with no
     * invoice at all.
     */
    const shop = await makeShop();
    const job = await claimJob(shop.id);
    if (!job) throw new Error("fixture: job was not claimed");

    await runImport({ shop, jobId: job.id, batch: batchOf([node()]), dryRun: false });

    const written = await db.query.orders.findMany({ where: eq(orders.shopId, shop.id) });
    const billed = await db.query.invoices.findMany({ where: eq(invoices.shopId, shop.id) });
    expect(written).toEqual([]);
    expect(billed).toEqual([]);

    // And no contact either: nothing in an import is a person who has arrived.
    const contacts = await db.query.clients.findMany({ where: eq(clients.shopId, shop.id) });
    expect(contacts).toEqual([]);
  });
});

describe("a dry run", () => {
  it("plans everything and writes nothing", async () => {
    const shop = await makeShop();

    const result = await runImport({
      shop,
      jobId: "",
      batch: batchOf([node(), node({ title: "Oat Bowl" })]),
      dryRun: true,
    });

    expect(result.plan.counts.created).toBe(2);
    expect(result.report).toHaveLength(2);

    const written = await db.query.products.findMany({
      where: eq(products.shopId, shop.id),
    });
    expect(written).toEqual([]);
  });
});

describe("running it again", () => {
  it("updates rather than duplicating", async () => {
    /*
     * The behaviour the `import_links` table exists for, and the one that loses
     * a seller's trust permanently if it is wrong: 200 products imported twice
     * must be 200 products, not 400.
     */
    imageFails = false;
    const shop = await makeShop();
    const nodes = [node(), node({ title: "Oat Bowl" })];

    const first = await claimJob(shop.id);
    if (!first) throw new Error("fixture: job was not claimed");
    await runImport({ shop, jobId: first.id, batch: batchOf(nodes), dryRun: false });
    await db.update(importJobs).set({ status: "done" }).where(eq(importJobs.id, first.id));

    // The seller fixed a price in Shopify and imported again.
    const repriced = nodes.map((n, i) =>
      i === 0
        ? {
            ...n,
            variants: {
              nodes: n.variants.nodes.map((v) => ({ ...v, price: "24.00" })),
            },
          }
        : n,
    );

    const second = await claimJob(shop.id);
    if (!second) throw new Error("fixture: second job was not claimed");
    const result = await runImport({
      shop,
      jobId: second.id,
      batch: batchOf(repriced),
      dryRun: false,
    });

    expect(result.plan.counts.created).toBe(0);
    expect(result.plan.counts.updated).toBe(2);

    const written = await db.query.products.findMany({
      where: eq(products.shopId, shop.id),
    });
    expect(written).toHaveLength(2);
    expect(written.find((p) => p.title === "Speckled Mug")?.priceCents).toBe(2400);

    const links = await db.query.importLinks.findMany({
      where: and(eq(importLinks.shopId, shop.id), eq(importLinks.entity, "product")),
    });
    expect(links).toHaveLength(2);
  });
});

describe("an image that will not load", () => {
  it("fails the picture and completes the job", async () => {
    /*
     * "Fail the row rather than the job when one image is unreachable." A
     * seller with one dead photo out of six hundred should get their catalogue
     * and a line in the report, not a stopped import.
     */
    imageFails = true;
    const shop = await makeShop();
    const job = await claimJob(shop.id);
    if (!job) throw new Error("fixture: job was not claimed");

    const result = await runImport({
      shop,
      jobId: job.id,
      batch: batchOf([node()]),
      dryRun: false,
    });
    imageFails = false;

    expect(result.plan.counts.created).toBe(1);

    const [written] = await db.query.products.findMany({
      where: eq(products.shopId, shop.id),
    });
    expect(written).toBeTruthy();

    const images = await db.query.productImages.findMany({
      where: eq(productImages.productId, written?.id ?? ""),
    });
    expect(images).toEqual([]);

    // And the seller is told, rather than left to notice a missing photo.
    expect(result.report[0]?.reason).toContain("image_failed");

    const [finished] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, job.id));
    expect(finished?.status).toBe("done");
  });
});

describe("two jobs at once", () => {
  it("lets exactly one run", async () => {
    // Both would plan against a shop with no links, both would decide every row
    // is a create, and the seller would end with two of everything.
    const shop = await makeShop();

    const first = await claimJob(shop.id);
    const second = await claimJob(shop.id);

    expect(first).toBeTruthy();
    expect(second).toBeUndefined();
  });

  it("lets the next one start once the first has finished", async () => {
    const shop = await makeShop();
    const first = await claimJob(shop.id);
    if (!first) throw new Error("fixture: job was not claimed");
    await db.update(importJobs).set({ status: "done" }).where(eq(importJobs.id, first.id));

    expect(await claimJob(shop.id)).toBeTruthy();
  });
});

describe("the plan ceiling", () => {
  it("imports what fits and names what it left out", async () => {
    // Rule 8: no silent caps. Free allows ten products.
    const shop = await makeShop({ plan: "free", subscriptionStatus: null });
    const job = await claimJob(shop.id);
    if (!job) throw new Error("fixture: job was not claimed");

    const many = Array.from({ length: 12 }, (_, i) => node({ title: `Mug ${i}` }));
    const result = await runImport({
      shop,
      jobId: job.id,
      batch: batchOf(many),
      dryRun: false,
    });

    expect(result.plan.counts.created).toBe(10);
    expect(result.plan.clamped).toEqual({ headroom: 10, leftOut: 2 });

    const written = await db.query.products.findMany({
      where: eq(products.shopId, shop.id),
    });
    expect(written).toHaveLength(10);
  });
});

describe("a catalogue priced in another currency", () => {
  it("refuses the whole run rather than converting", async () => {
    const shop = await makeShop({ currency: "EUR" });

    const result = await runImport({
      shop,
      jobId: "",
      batch: { source: "shopify", ...mapShopify([node()], "USD") },
      dryRun: true,
    });

    expect(result.plan.refusal).toMatchObject({ reason: "currency_mismatch" });
    expect(result.plan.rows).toEqual([]);
  });
});
