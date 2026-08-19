import { describe, expect, it } from "vitest";
import { planImport } from "./plan";
import { mapShopifyProduct } from "./sources/shopify";
import { mapStripe } from "./sources/stripe";
import { mapTabular } from "./sources/tabular";
import type { ImportProduct, SourceBatch } from "./rows";

/**
 * Every branch of the importer that can be exercised without a database.
 *
 * The spec's architecture rule is *"one write path, six readers"*, and this is
 * the payoff: each source is a pure mapper and the plan is a pure function, so
 * the mapping decisions that cost real money — how a price is parsed, whether a
 * re-run duplicates, what happens at a plan ceiling — are all testable from
 * object literals.
 */

const product = (over: Partial<ImportProduct> = {}): ImportProduct => ({
  externalId: "ext-1",
  title: "Speckled Mug",
  description: null,
  priceCents: 2000,
  compareAtCents: null,
  kind: "physical",
  categoryName: null,
  tags: [],
  sku: null,
  options: [],
  variants: [],
  imageUrls: [],
  trackInventory: false,
  stockQuantity: null,
  isPublished: true,
  notes: [],
  ...over,
});

const batch = (products: ImportProduct[], over: Partial<SourceBatch> = {}): SourceBatch => ({
  source: "shopify",
  currency: null,
  products,
  notes: [],
  ...over,
});

const plan = (b: SourceBatch, over: Partial<Parameters<typeof planImport>[0]> = {}) =>
  planImport({
    batch: b,
    shopCurrency: "USD",
    takenSlugs: new Set(),
    links: new Map(),
    headroom: null,
    ...over,
  });

describe("re-running an import", () => {
  it("updates rather than duplicates when the link already exists", () => {
    /*
     * The single most important behaviour in this feature. A seller who
     * imports 200 products, fixes three prices and imports again must end with
     * 200 — without this they get 400, and the second run is the one that
     * loses their trust permanently.
     */
    const result = plan(batch([product()]), {
      links: new Map([["ext-1", "local-uuid"]]),
    });

    expect(result.counts.created).toBe(0);
    expect(result.counts.updated).toBe(1);
    expect(result.rows[0]).toMatchObject({ action: "update", localId: "local-uuid" });
  });

  it("keeps an updated product's existing address", () => {
    // Changing the slug of a live product because a newcomer collides with its
    // title breaks every link to it.
    const result = plan(batch([product({ title: "Speckled Mug" })]), {
      takenSlugs: new Set(["speckled-mug"]),
      links: new Map([["ext-1", "local-uuid"]]),
    });
    expect(result.rows[0]?.slug).toBe("speckled-mug");
  });
});

describe("slug collisions", () => {
  it("suffixes and says so", () => {
    // Two Shopify products with the same title are normal, and a seller who is
    // not told spends an afternoon looking for the one that "did not import".
    const result = plan(batch([product()]), { takenSlugs: new Set(["speckled-mug"]) });
    expect(result.rows[0]?.slug).toBe("speckled-mug-2");
    expect(result.rows[0]?.notes).toContain("renamed_slug:speckled-mug-2");
  });

  it("does not collide two rows of the same run with each other", () => {
    const result = plan(
      batch([product({ externalId: "a" }), product({ externalId: "b" })]),
    );
    expect(result.rows.map((r) => r.slug)).toEqual(["speckled-mug", "speckled-mug-2"]);
  });
});

describe("the plan ceiling", () => {
  it("names the number it left out", () => {
    // Rule 8: no silent caps. A truncated import that says nothing is a
    // mystery; one that says "190 left out" is a decision the seller can make.
    const many = Array.from({ length: 5 }, (_, i) =>
      product({ externalId: `e${i}`, title: `Mug ${i}` }),
    );
    const result = plan(batch(many), { headroom: 2 });

    expect(result.counts.created).toBe(2);
    expect(result.counts.skipped).toBe(3);
    expect(result.clamped).toEqual({ headroom: 2, leftOut: 3 });
  });

  it("lets a shop at its ceiling still fix the prices it already has", () => {
    const rows = [
      product({ externalId: "known", title: "Known" }),
      product({ externalId: "new", title: "New" }),
    ];
    const result = plan(batch(rows), {
      headroom: 0,
      links: new Map([["known", "local-uuid"]]),
    });

    expect(result.counts.updated).toBe(1);
    expect(result.counts.created).toBe(0);
    expect(result.clamped).toEqual({ headroom: 0, leftOut: 1 });
  });

  it("says nothing about a ceiling that was never reached", () => {
    expect(plan(batch([product()]), { headroom: 50 }).clamped).toBeNull();
  });
});

describe("the currency refusal", () => {
  it("refuses the whole run rather than converting", () => {
    /*
     * A shop trading in EUR importing USD-priced products has every price in
     * the file meaning something other than what it says. Nothing in Sailo
     * converts, and a rate nobody recorded is a price nobody agreed.
     */
    const result = plan(batch([product()], { currency: "USD" }), { shopCurrency: "EUR" });
    expect(result.refusal).toEqual({ reason: "currency_mismatch", detail: "USD → EUR" });
    expect(result.rows).toEqual([]);
  });

  it("does not treat a source with no currency as a mismatch", () => {
    // A CSV of numbers is in whatever the seller sells in, by definition.
    expect(plan(batch([product()], { currency: null })).refusal).toBeNull();
  });
});

describe("rows the mapper will not stand behind", () => {
  it("skips them with the mapper's own reason", () => {
    const result = plan(batch([product({ refusal: "recurring_not_imported" })]));
    expect(result.rows[0]).toMatchObject({
      action: "skip",
      reason: "recurring_not_imported",
    });
    expect(result.counts.skipped).toBe(1);
  });

  it("fails a row with no title at all", () => {
    const result = plan(batch([product({ title: "  " })]));
    expect(result.rows[0]).toMatchObject({ action: "fail", reason: "no_title" });
  });
});

describe("Shopify mapping", () => {
  const node = {
    id: "gid://shopify/Product/1",
    title: "Speckled Mug",
    status: "ACTIVE",
    descriptionHtml: "<div class='theme'><p>A <b>good</b> mug</p></div>",
    tags: ["kitchen"],
    options: [{ name: "Size", values: ["S", "L"] }],
    images: { nodes: [{ url: "https://cdn.shopify.com/a.jpg" }] },
    collections: { nodes: [{ title: "Mugs" }] },
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/1",
          sku: "MUG-S",
          price: "19.99",
          compareAtPrice: "24.99",
          requiresShipping: true,
          selectedOptions: [{ name: "Size", value: "S" }],
          inventoryItem: {
            tracked: true,
            inventoryLevels: {
              nodes: [
                { quantities: [{ quantity: 3 }] },
                { quantities: [{ quantity: 4 }] },
              ],
            },
          },
        },
      ],
    },
  };

  it("parses a decimal price into minor units of the target currency", () => {
    // `PRODUCTION-PLAN.md` §2 item 1: a flat /100 turned ¥1,000 into ¥10. An
    // import is a bulk write, so that bug arrives two hundred times at once.
    expect(mapShopifyProduct(node, "USD").priceCents).toBe(1999);
    /*
     * The same string in a zero-decimal currency is twenty yen, not 1,999.
     * The multiplier is the currency's and the rounding is the currency's, and
     * both come from the one table `moneyToCents` consults.
     */
    expect(mapShopifyProduct(node, "JPY").priceCents).toBe(20);
  });

  it("reads a zero-decimal currency without multiplying by a hundred", () => {
    const yen = { ...node, variants: { nodes: [{ ...node.variants.nodes[0]!, price: "1000" }] } };
    expect(mapShopifyProduct(yen, "JPY").priceCents).toBe(1000);
    expect(mapShopifyProduct(yen, "USD").priceCents).toBe(100000);
  });

  it("sums inventory across locations and says so", () => {
    const mapped = mapShopifyProduct(node, "USD");
    expect(mapped.variants[0]?.stockQuantity).toBe(7);
    expect(mapped.notes).toContain("stock_summed:2");
  });

  it("makes a non-shipping product digital, with the file slot named", () => {
    // This is how Shopify sellers model digital goods, and getting it wrong
    // makes every ebook ask for a shipping address.
    const digital = {
      ...node,
      variants: {
        nodes: [{ ...node.variants.nodes[0]!, requiresShipping: false }],
      },
    };
    const mapped = mapShopifyProduct(digital, "USD");
    expect(mapped.kind).toBe("digital");
    expect(mapped.notes).toContain("digital_needs_file");
  });

  it("strips the theme's markup out of the description", () => {
    expect(mapShopifyProduct(node, "USD").description).not.toContain("<");
  });

  it("refuses a smart collection and says why", () => {
    // A smart collection is a query. Importing its current members freezes a
    // rule into rows, and the category stops being true the next price change.
    const smart = { ...node, collections: { nodes: [{ title: "Under £20", ruleSet: {} }] } };
    const mapped = mapShopifyProduct(smart, "USD");
    expect(mapped.categoryName).toBeNull();
    expect(mapped.notes).toContain("smart_collection_skipped");
  });

  it("drops Shopify's placeholder option for a product sold as one thing", () => {
    const single = {
      ...node,
      options: [{ name: "Title", values: ["Default Title"] }],
      variants: {
        nodes: [
          {
            ...node.variants.nodes[0]!,
            selectedOptions: [{ name: "Title", value: "Default Title" }],
          },
        ],
      },
    };
    const mapped = mapShopifyProduct(single, "USD");
    expect(mapped.options).toEqual([]);
    expect(mapped.variants).toEqual([]);
    expect(mapped.sku).toBe("MUG-S");
  });

  it("does not publish a draft", () => {
    expect(mapShopifyProduct({ ...node, status: "DRAFT" }, "USD").isPublished).toBe(false);
  });
});

describe("Stripe mapping", () => {
  it("takes minor units as they are", () => {
    const { products } = mapStripe(
      [{ id: "prod_1", name: "Guide", active: true }],
      [{ id: "price_1", product: "prod_1", unit_amount: 1999, currency: "usd" }],
    );
    expect(products[0]?.priceCents).toBe(1999);
  });

  it("refuses a recurring price rather than minting a membership", () => {
    const { products } = mapStripe(
      [{ id: "prod_1", name: "Club" }],
      [
        {
          id: "price_1",
          product: "prod_1",
          unit_amount: 1000,
          recurring: { interval: "month" },
        },
      ],
    );
    expect(products[0]?.refusal).toBe("recurring_not_imported");
  });

  it("refuses a product with no active price rather than importing it free", () => {
    const { products } = mapStripe([{ id: "prod_1", name: "Ghost" }], []);
    expect(products[0]?.refusal).toBe("no_active_price");
  });

  it("reports the source's currency, for the mismatch refusal", () => {
    const { currency } = mapStripe(
      [{ id: "prod_1", name: "Guide" }],
      [{ id: "price_1", product: "prod_1", unit_amount: 1, currency: "eur" }],
    );
    expect(currency).toBe("EUR");
  });
});

describe("spreadsheet mapping", () => {
  it("groups a Shopify-shaped export by handle", () => {
    // One row per variant, repeating the product on each. Read singly, each row
    // overwrites the last as if it were a different product.
    const rows = [
      {
        Handle: "mug",
        Title: "Mug",
        Price: "20.00",
        "Option1 Name": "Size",
        "Option1 Value": "S",
        Quantity: "3",
      },
      { Handle: "mug", Title: "", Price: "22.00", "Option1 Name": "Size", "Option1 Value": "L", Quantity: "4" },
    ];
    const { products } = mapTabular(rows, "csv", "USD");

    expect(products).toHaveLength(1);
    expect(products[0]?.options).toEqual([{ name: "Size", values: ["S", "L"] }]);
    expect(products[0]?.variants.map((v) => v.priceCents)).toEqual([2000, 2200]);
  });

  it("refuses a row with a blank price rather than selling it free", () => {
    const { products } = mapTabular([{ Title: "Mug", Price: "" }], "csv", "USD");
    expect(products[0]?.refusal).toBe("no_price");
  });

  it("keeps a missing quantity apart from a zero one", () => {
    // Null is "nobody is counting"; zero is "sold out".
    const none = mapTabular([{ Title: "A", Price: "5" }], "csv", "USD").products[0];
    const zero = mapTabular([{ Title: "B", Price: "5", Quantity: "0" }], "csv", "USD").products[0];
    expect(none?.trackInventory).toBe(false);
    expect(zero?.trackInventory).toBe(true);
    expect(zero?.stockQuantity).toBe(0);
  });

  it("reads a European decimal the way it was written", () => {
    // "12,5" is an ordinary way to write €12.50, and stripping every comma
    // made it €125.
    expect(mapTabular([{ Title: "A", Price: "12,5" }], "csv", "EUR").products[0]?.priceCents).toBe(1250);
  });

  it("merges Etsy's materials into the tags", () => {
    const { products } = mapTabular(
      [{ Title: "Bowl", Price: "9", Tags: "kitchen, gift", Materials: "stoneware" }],
      "etsy",
      "USD",
    );
    expect(products[0]?.tags).toEqual(["kitchen", "gift", "stoneware"]);
  });

  it("treats a Gumroad row as digital and names the missing file", () => {
    const { products } = mapTabular([{ Title: "Guide", Price: "9" }], "gumroad", "USD");
    expect(products[0]?.kind).toBe("digital");
    expect(products[0]?.notes).toContain("digital_needs_file");
  });

  it("says which columns it did not understand", () => {
    /*
     * The honest half of shipping before a real Etsy fixture exists: the reader
     * cannot guess, so it reports. A seller and whoever reads the report can
     * both see exactly what was ignored.
     */
    const { notes } = mapTabular(
      [{ Title: "A", Price: "5", "Etsy Something": "x" }],
      "etsy",
      "USD",
    );
    expect(notes.some((n) => n.startsWith("ignored_columns:"))).toBe(true);
  });

  it("says when the file has no price column at all", () => {
    const { notes } = mapTabular([{ Title: "A", Nonsense: "x" }], "etsy", "USD");
    expect(notes).toContain("no_price_column");
  });
});
