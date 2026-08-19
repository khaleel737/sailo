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
/**
 * The files a product already has — spec 48.
 *
 * `syncFiles` stopped deleting and re-inserting the table on every save (that
 * minted a new id per file, which broke the buyer's own download link after any
 * product edit); it now matches on URL, so it reads the existing rows first.
 */
const filesFindMany = vi.fn();

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
      productFiles: { findMany: filesFindMany },
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
  // No files yet, which is what every one of these saves starts from.
  filesFindMany.mockResolvedValue([]);
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

  it("will not save an event that ends before it starts", async () => {
    // Almost always a date the seller forgot to move after picking the start,
    // and the buyer's page would render a span that reads as a bug.
    const result = await saveProduct(SHOP, {
      ...BASICS,
      kind: "event",
      eventStartsAt: new Date("2026-09-01T19:00:00Z"),
      eventEndsAt: new Date("2026-09-01T18:00:00Z"),
    });
    expect(result).toEqual({
      ok: false,
      refusal: { kind: "event_ends_before_start" },
    });
    expect(written).toHaveLength(0);
  });

  it("will not save a digital product whose link or code is blank", async () => {
    /*
     * Refused where a fileless download is not, and the asymmetry is the
     * point: files are managed by an uploader the phone's editor does not
     * have, so blocking those would block a legitimate draft. A link and a
     * code are single text fields wherever the kind is offered at all, so a
     * blank one is a buy button that leads nowhere.
     */
    expect(
      await saveProduct(SHOP, {
        ...BASICS,
        kind: "digital",
        digitalDelivery: "link",
        digitalLinkUrl: "   ",
      }),
    ).toEqual({
      ok: false,
      refusal: { kind: "digital_needs_delivery", delivery: "link" },
    });

    expect(
      await saveProduct(SHOP, {
        ...BASICS,
        kind: "digital",
        digitalDelivery: "code",
        digitalAccessDetails: "",
      }),
    ).toEqual({
      ok: false,
      refusal: { kind: "digital_needs_delivery", delivery: "code" },
    });

    expect(written).toHaveLength(0);
  });

  it("refuses a download link this server would not put in front of a buyer", async () => {
    // The same guard the event's join link gets: it is rendered as an anchor
    // in an email and on the buyer's page.
    const result = await saveProduct(SHOP, {
      ...BASICS,
      kind: "digital",
      digitalDelivery: "link",
      digitalLinkUrl: "http://169.254.169.254/latest/meta-data/",
    });
    expect(result).toEqual({
      ok: false,
      refusal: { kind: "digital_link_not_public" },
    });
    expect(written).toHaveLength(0);
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

  it("keeps only the shape the digital product actually sells", async () => {
    /*
     * The two fields that are not the chosen shape are cleared, and the files
     * with them. A product moved from a file to a link must not leave a
     * download behind: the streaming route keys off the order's token rather
     * than the product's kind, so the leftover would go on being handed over
     * as though it were the good.
     */
    await saveProduct(SHOP, {
      ...BASICS,
      kind: "digital",
      digitalDelivery: "link",
      digitalLinkUrl: "https://school.example.com/p/ceramics",
      digitalAccessDetails: "leftover code",
      files: [{ url: "https://abc123.public.blob.vercel-storage.com/a.pdf" }],
    });

    expect(rowsFor("products")).toEqual([
      expect.objectContaining({
        digitalDelivery: "link",
        digitalLinkUrl: "https://school.example.com/p/ceramics",
        digitalAccessDetails: null,
      }),
    ]);
    expect(rowsFor("product_files")).toHaveLength(0);
  });

  it("clears a digital shape off a product that is not digital", async () => {
    // A stale link on a mug would be one the download page is still entitled
    // to render, which is the whole reason these are cleared rather than left.
    await saveProduct(SHOP, {
      ...BASICS,
      kind: "physical",
      digitalDelivery: "link",
      digitalLinkUrl: "https://school.example.com/p/ceramics",
    });

    expect(rowsFor("products")).toEqual([
      expect.objectContaining({
        digitalDelivery: "file",
        digitalLinkUrl: null,
        digitalAccessDetails: null,
      }),
    ]);
  });

  it("clamps a membership's cycle to what Stripe will bill", async () => {
    await saveProduct(SHOP, {
      ...BASICS,
      kind: "membership",
      priceCents: 3_000,
      billingInterval: "month",
      billingIntervalCount: 18,
    });

    // Eighteen months is longer than Stripe's one-year period, and the nearest
    // legal cycle beats a product whose checkout fails at the buyer.
    expect(rowsFor("products")).toEqual([
      expect.objectContaining({ billingInterval: "month", billingIntervalCount: 12 }),
    ]);
  });

  it("keeps the product's own code only while it is sold as one thing", async () => {
    // With options the codes live on the variants, and the order line
    // snapshots whichever applies — a second code up here would be one no
    // order can quote and one more thing to keep in step.
    await saveProduct(SHOP, { ...BASICS, sku: "MUG-OAT-350" });
    expect(rowsFor("products")).toEqual([
      expect.objectContaining({ sku: "MUG-OAT-350" }),
    ]);

    written.length = 0;
    await saveProduct(SHOP, {
      ...BASICS,
      sku: "MUG-OAT-350",
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [{ options: { Size: "S" } }, { options: { Size: "M" } }],
    });
    expect(rowsFor("products")).toEqual([expect.objectContaining({ sku: null })]);
  });

  it("reads a per-order cap of zero as no cap at all", async () => {
    // A seller who wants to stop selling has `inStock`; a zero here is a
    // cleared field, and honouring it would offer a picker with no legal value.
    await saveProduct(SHOP, { ...BASICS, maxPerOrder: 0 });
    expect(rowsFor("products")).toEqual([
      expect.objectContaining({ maxPerOrder: null }),
    ]);

    written.length = 0;
    await saveProduct(SHOP, { ...BASICS, maxPerOrder: 4 });
    expect(rowsFor("products")).toEqual([
      expect.objectContaining({ maxPerOrder: 4 }),
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
