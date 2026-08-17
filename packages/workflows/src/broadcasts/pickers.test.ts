import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Everything the broadcast composer's dropdowns need, in one round trip.
 *
 * Three routes render the composer — new, edit, and the list's audience summary — so
 * this is assembled once rather than per page: a picker populated on two of the three
 * is a condition a seller can create in one place and cannot read back in another.
 *
 * The rule most worth a test is the truncation, because it is the one that lies
 * quietly. A seller scrolling for a product that is not in the list has no way to tell
 * "you have no such product" from "the list stopped". So the query asks for one past
 * the ceiling and the flag is a fact rather than a guess made by comparing lengths.
 */

const getShopClients = vi.fn();
const tagVocabulary = vi.fn();

/** Each `select()` chain resolves to the next entry, in query order. */
let selects: unknown[][];

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: function () {
          return this;
        },
        orderBy: function () {
          return this;
        },
        limit: () => Promise.resolve(selects.shift() ?? []),
      }),
    }),
  }),
}));
vi.mock("@sailo/customers/roster", () => ({ getShopClients }));
vi.mock("@sailo/core/tags", () => ({ tagVocabulary }));

const { segmentPickers } = await import("./pickers");

const product = (id: string, kind = "physical") => ({ id, title: `Product ${id}`, kind });

beforeEach(() => {
  vi.clearAllMocks();
  getShopClients.mockResolvedValue([{ id: "client-1", tags: ["vip"] }]);
  tagVocabulary.mockReturnValue(["vip"]);
  selects = [[], [], []];
});

describe("what the composer gets", () => {
  it("labels products by title and categories by name", async () => {
    selects = [
      [product("p1")],
      [{ id: "c1", name: "Ceramics" }],
      [{ id: "k1", code: "SUMMER" }],
    ];

    const result = await segmentPickers("shop-1");

    expect(result.products).toEqual([{ id: "p1", label: "Product p1" }]);
    expect(result.categories).toEqual([{ id: "c1", label: "Ceramics" }]);
    expect(result.coupons).toEqual([{ id: "k1", label: "SUMMER" }]);
  });

  it("takes its tag vocabulary from the roster rather than inventing one", async () => {
    await segmentPickers("shop-1");

    expect(getShopClients).toHaveBeenCalledWith("shop-1");
    expect(tagVocabulary).toHaveBeenCalledWith([{ id: "client-1", tags: ["vip"] }]);
  });

  /*
   * "Turned up to" only means anything for a thing with a door, so events are the
   * subset of products that have one — not a second query that could disagree with
   * the first about which products exist.
   */
  it("offers events as the subset of products that have a door", async () => {
    selects = [[product("p1"), product("p2", "event"), product("p3", "event")], [], []];

    const result = await segmentPickers("shop-1");

    expect(result.events.map((e) => e.id)).toEqual(["p2", "p3"]);
    expect(result.products).toHaveLength(3);
  });

  it("returns empty pickers for a shop with nothing in it", async () => {
    getShopClients.mockResolvedValue([]);
    tagVocabulary.mockReturnValue([]);

    const result = await segmentPickers("shop-1");

    expect(result).toMatchObject({
      tags: [],
      products: [],
      categories: [],
      coupons: [],
      events: [],
      productsTruncated: false,
    });
  });
});

describe("the ceiling on a dropdown", () => {
  it("reports the limit it applied, so the screen can say so", async () => {
    const result = await segmentPickers("shop-1");

    expect(result.productLimit).toBe(200);
  });

  it("is not truncated when the catalogue fits exactly", async () => {
    selects = [Array.from({ length: 200 }, (_, i) => product(`p${i}`)), [], []];

    const result = await segmentPickers("shop-1");

    expect(result.productsTruncated).toBe(false);
    expect(result.products).toHaveLength(200);
  });

  /*
   * The reason the query asks for 201. At exactly 200 rows, "did we run out or did the
   * catalogue?" is unanswerable — so one extra row is fetched, the flag is set from its
   * presence, and it is dropped from what the seller sees.
   */
  it("is truncated at one past the ceiling, and does not show the extra row", async () => {
    selects = [Array.from({ length: 201 }, (_, i) => product(`p${i}`)), [], []];

    const result = await segmentPickers("shop-1");

    expect(result.productsTruncated).toBe(true);
    expect(result.products).toHaveLength(200);
    expect(result.products.at(-1)?.id).toBe("p199");
  });

  /*
   * And the truncation applies to events too, because they are derived from the same
   * clamped list. An event sitting at position 250 of a long catalogue is not offered,
   * which is the honest consequence of the flag being raised.
   */
  it("derives events from the clamped list, not the full one", async () => {
    selects = [
      [
        ...Array.from({ length: 200 }, (_, i) => product(`p${i}`)),
        product("late-event", "event"),
      ],
      [],
      [],
    ];

    const result = await segmentPickers("shop-1");

    expect(result.events).toHaveLength(0);
    expect(result.productsTruncated).toBe(true);
  });
});
