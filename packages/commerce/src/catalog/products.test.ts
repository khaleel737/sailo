import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Shop } from "@sailo/db/schema";

/**
 * What a product has to be, whoever is saving it.
 *
 * These rules were inside a `"use server"` function, which meant they were
 * rules about *the web form* — and when `products.save` arrived in `@sailo/api`
 * every one of them would have had to be written a second time or not at all.
 * Two of them are not conveniences:
 *
 * `isStoredFileUrl` is the guard on a URL this server later fetches itself.
 * `/api/download/[token]/[fileId]` streams the response back to whoever bought
 * the product, and signup is open — so a seller who could store an arbitrary
 * URL here could point it at a cloud metadata endpoint, buy their own product,
 * and read the reply. `isPublicLinkUrl` is the same shape of problem pointed at
 * a buyer's inbox rather than at us.
 *
 * So the guards are exercised here against the real `@sailo/storage/urls` —
 * stubbing them would leave this file asserting that a mock was called, which
 * is exactly the assertion that survives someone deleting the check.
 */

const productsFindFirst = vi.fn();
const categoriesFindFirst = vi.fn();
const variantsFindMany = vi.fn();

/** Every row this save wrote, by table, in the order it wrote them. */
let written: { table: string; values: unknown }[];

function thenable<T>(result: T, extra: Record<string, unknown> = {}) {
  return { ...extra, then: (resolve: (value: T) => unknown) => resolve(result) };
}

/** Table objects are opaque to us; drizzle stamps a name we can read back. */
const nameOf = (table: unknown) =>
  String((table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? "?");

let selectResult: unknown[] = [];
let insertedId = "new-product-id";

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: {
      products: { findFirst: productsFindFirst },
      categories: { findFirst: categoriesFindFirst },
      productVariants: { findMany: variantsFindMany },
    },
    select: () => ({ from: () => ({ where: () => thenable(selectResult) }) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        written.push({ table: nameOf(table), values });
        return thenable(undefined, {
          returning: () => thenable([{ id: insertedId }]),
        });
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          written.push({ table: `${nameOf(table)}:update`, values });
          return thenable(undefined);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        written.push({ table: `${nameOf(table)}:delete`, values: null });
        return thenable(undefined);
      },
    }),
  }),
}));

const { saveProduct } = await import("./products");

/** Business plan, so the product limit is never what refuses a test below. */
const SHOP = {
  id: "shop_A",
  handle: "acme",
  currency: "USD",
  plan: "business",
  subscriptionStatus: "active",
  compPlan: null,
} as Shop;

const BASICS = { id: null, title: "Mug", priceCents: 1200, kind: "physical" };

function rowsFor(table: string) {
  return written.filter((w) => w.table === table).map((w) => w.values);
}

beforeEach(() => {
  written = [];
  selectResult = [{ count: "0", max: "0" }];
  insertedId = "new-product-id";
  productsFindFirst.mockReset().mockResolvedValue(undefined);
  categoriesFindFirst.mockReset().mockResolvedValue({ id: "cat_1" });
  variantsFindMany.mockReset().mockResolvedValue([]);
});

/* -------------------------------------------------------------------------- */
/*  The guards on a URL this server will later fetch                           */
/* -------------------------------------------------------------------------- */

describe("file URLs", () => {
  /*
   * THIS BLOCK USED TO DEPEND ON A VARIABLE BEING ABSENT, AND THAT IS WHY IT
   * BROKE THE DEPLOYMENT.
   *
   * `isStoredFileUrl` pins the host to *our* blob store when
   * `BLOB_READ_WRITE_TOKEN` is set, and falls back to "any Vercel blob host"
   * when it is not. `abc123...` below is a made-up store, so it only passes on
   * the fallback — which is to say the test passed on a laptop because the
   * variable was missing there, and failed on Vercel because Vercel is the one
   * environment that actually has it. `turbo run build` depends on `test`, so
   * a green suite locally still took production down.
   *
   * Cleared and restored per test, the way `@sailo/storage/urls.test.ts`
   * already does it, so both branches are chosen here rather than inherited
   * from whatever machine is running.
   */
  const original = process.env.BLOB_READ_WRITE_TOKEN;
  beforeEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = original;
  });

  it("stores a file on a host the app already serves from", async () => {
    const result = await saveProduct(SHOP, {
      ...BASICS,
      files: [{ url: "https://abc123.public.blob.vercel-storage.com/a.pdf" }],
    });

    expect(result.ok).toBe(true);
    expect(rowsFor("product_files")).toHaveLength(1);
  });

  /*
   * The branch every deployed environment takes, and the one nothing covered.
   *
   * With a token present the host must be the store that token belongs to.
   * Another account's Vercel blob store is still a Vercel blob host, so the
   * suffix check waves it through — and that is the open-proxy hole the
   * pinning exists to close. Worth a test of its own precisely because the
   * only environment that exercised it was production.
   */
  it("keeps a file on our own store when the store is pinned", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_OurStore1_secret";

    const result = await saveProduct(SHOP, {
      ...BASICS,
      files: [{ url: "https://ourstore1.public.blob.vercel-storage.com/a.pdf" }],
    });

    expect(result.ok).toBe(true);
    expect(rowsFor("product_files")).toHaveLength(1);
  });

  it("drops a file on somebody else's blob store", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_OurStore1_secret";

    const result = await saveProduct(SHOP, {
      ...BASICS,
      files: [{ url: "https://someoneelse.public.blob.vercel-storage.com/a.pdf" }],
    });

    expect(result.ok).toBe(true);
    expect(rowsFor("product_files")).toHaveLength(0);
  });

  it("drops a file pointed anywhere else, including at ourselves", async () => {
    /*
     * The four shapes that matter, and none of them is a typo a seller makes:
     * a cloud metadata endpoint, a loopback address, a private range, and a
     * scheme that is not a fetch at all.
     */
    const result = await saveProduct(SHOP, {
      ...BASICS,
      files: [
        { url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" },
        { url: "http://127.0.0.1:3000/api/internal" },
        { url: "http://10.0.0.5/secrets" },
        { url: "file:///etc/passwd" },
      ],
    });

    expect(result.ok).toBe(true);
    // Nothing was stored, so nothing can be fetched on the buyer's behalf.
    expect(rowsFor("product_files")).toHaveLength(0);
  });

  it("refuses a join link rather than saving the event without one", async () => {
    /*
     * Refused, not dropped. A dropped link saves the rest and leaves the seller
     * believing their webinar has a way in; they find out an hour before it
     * starts, from a buyer with nothing to click.
     */
    const result = await saveProduct(SHOP, {
      ...BASICS,
      kind: "event",
      eventStartsAt: new Date("2026-09-01T18:00:00Z"),
      serviceMode: "online",
      eventJoinUrl: "javascript:alert(1)",
    });

    expect(result).toEqual({ ok: false, refusal: { kind: "join_url_not_public" } });
    expect(written).toHaveLength(0);
  });

  it("keeps only images from a host the gallery can already render", async () => {
    const result = await saveProduct(SHOP, {
      ...BASICS,
      imageUrls: [
        "https://abc123.public.blob.vercel-storage.com/one.jpg",
        "http://169.254.169.254/latest/meta-data/",
      ],
    });

    expect(result.ok).toBe(true);
    expect(rowsFor("product_images")).toEqual([
      [expect.objectContaining({ position: 0 })],
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Refusals                                                                   */
/* -------------------------------------------------------------------------- */

describe("what it will not save", () => {
  it("needs a title that is more than whitespace", async () => {
    const result = await saveProduct(SHOP, { ...BASICS, title: "   " });
    expect(result).toEqual({ ok: false, refusal: { kind: "no_title" } });
  });

  it("refuses a category belonging to another shop", async () => {
    // The lookup carries the shop id, so another shop's category simply does
    // not match and arrives here as undefined.
    categoriesFindFirst.mockResolvedValue(undefined);
    const result = await saveProduct(SHOP, { ...BASICS, categoryId: "cat_other" });
    expect(result).toEqual({ ok: false, refusal: { kind: "unknown_category" } });
    expect(written).toHaveLength(0);
  });

  it("will not save an event with no time", async () => {
    const result = await saveProduct(SHOP, { ...BASICS, kind: "event" });
    expect(result).toEqual({ ok: false, refusal: { kind: "event_needs_start" } });
  });

  it("will not save a membership nobody could be charged for", async () => {
    // Both turn a Stripe error the *buyer* would have met at checkout into
    // something the seller can act on while they are looking at the product.
    expect(
      await saveProduct(SHOP, { ...BASICS, kind: "membership", priceCents: 500 }),
    ).toEqual({ ok: false, refusal: { kind: "membership_needs_interval" } });

    expect(
      await saveProduct(SHOP, {
        ...BASICS,
        kind: "membership",
        priceCents: 0,
        billingInterval: "month",
      }),
    ).toEqual({ ok: false, refusal: { kind: "membership_needs_price" } });
  });

  it("holds a free shop to its product limit, and says what the limit is", async () => {
    /*
     * The gate a client must never be trusted with. It is checked here rather
     * than in either caller precisely because there are two callers now, and a
     * phone that skipped it would be a paid boundary with a hole in it.
     */
    selectResult = [{ count: "500" }];
    const free = { ...SHOP, plan: "free", subscriptionStatus: null } as Shop;
    const result = await saveProduct(free, BASICS);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.refusal.kind).toBe("product_limit");
    // The number is the whole reason the sentence lands, so it comes back
    // rather than being re-derived by whoever renders it.
    expect(result.ok === false && result.refusal).toMatchObject({
      planName: "Free",
    });
    expect(written).toHaveLength(0);
  });

  it("does not apply the limit to an edit, so a downgrade never deletes work", async () => {
    selectResult = [{ count: "500" }];
    productsFindFirst.mockResolvedValue({ id: "p_1", slug: "mug" });
    const free = { ...SHOP, plan: "free", subscriptionStatus: null } as Shop;

    const result = await saveProduct(free, { ...BASICS, id: "p_1" });
    expect(result.ok).toBe(true);
  });

  it("answers not-found for an id that is not this shop's", async () => {
    productsFindFirst.mockResolvedValue(undefined);
    const result = await saveProduct(SHOP, { ...BASICS, id: "p_other" });
    expect(result).toEqual({ ok: false, refusal: { kind: "not_found" } });
  });
});

/* -------------------------------------------------------------------------- */
/*  Blank is not zero                                                          */
/* -------------------------------------------------------------------------- */

describe("what it writes", () => {
  it("keeps a variant's blank price and blank stock as nulls", async () => {
    /*
     * Null price is "same as the product" and null stock is "nobody is
     * counting" — neither is zero, and folding either to zero would make a
     * variant free or make a stocked one read as sold out.
     */
    await saveProduct(SHOP, {
      ...BASICS,
      trackInventory: true,
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        { options: { Size: "S" }, priceCents: null, stockQuantity: null },
        { options: { Size: "M" }, priceCents: 1500, stockQuantity: 0 },
      ],
    });

    expect(rowsFor("product_variants")).toEqual([
      expect.objectContaining({ priceCents: null, stockQuantity: null }),
      expect.objectContaining({ priceCents: 1500, stockQuantity: 0 }),
    ]);
  });

  it("drops a variant for a combination the options no longer describe", async () => {
    // An orphan left by an option rename is a row no buyer can ever select.
    await saveProduct(SHOP, {
      ...BASICS,
      options: [{ name: "Size", values: ["S"] }],
      variants: [
        { options: { Size: "S" } },
        { options: { Size: "XXL" } },
        { options: { Colour: "Red" } },
      ],
    });

    expect(rowsFor("product_variants")).toHaveLength(1);
  });

  it("moves stock off the product when variants carry it", async () => {
    await saveProduct(SHOP, {
      ...BASICS,
      trackInventory: true,
      stockQuantity: 7,
      options: [{ name: "Size", values: ["S"] }],
      variants: [{ options: { Size: "S" }, stockQuantity: 3 }],
    });

    // Otherwise the product-level count lingers and contradicts the variants.
    expect(rowsFor("products")[0]).toMatchObject({ stockQuantity: null });
  });

  it("clears a stale event date when the product stops being an event", async () => {
    productsFindFirst.mockResolvedValue({ id: "p_1", slug: "mug" });
    await saveProduct(SHOP, {
      ...BASICS,
      id: "p_1",
      kind: "physical",
      eventStartsAt: new Date("2026-01-01T00:00:00Z"),
    });

    // A product switched away from being an event must not keep silently
    // closing its own sales at a date nothing shows.
    expect(rowsFor("products:update")[0]).toMatchObject({
      eventStartsAt: null,
      eventJoinUrl: null,
    });
  });
});
