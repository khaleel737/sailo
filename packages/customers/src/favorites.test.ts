import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorageWindow } from "@sailo/config/testing";
import {
  isFavorite,
  readFavorites,
  removeFavorite,
  toggleFavorite,
  writeFavorites,
  type FavoriteItem,
} from "./favorites";

/**
 * The property the hearts exist to hold: what a buyer saved is still saved
 * when they come back. A failure here is a shortlist that forgot itself —
 * the buyer pressed a heart, meant it, and got nothing for it.
 */

const store = new Map<string, string>();

const item = (over: Partial<FavoriteItem> = {}): FavoriteItem => ({
  productId: "p1",
  slug: "mug",
  title: "Mug",
  imageUrl: null,
  priceCents: 1200,
  ...over,
});

beforeEach(() => {
  store.clear();
  // The module reads `window.localStorage`, so the window is what needs
  // standing in — the same stand-in `cart.test.ts` uses, for the same reason.
  stubLocalStorageWindow(store);
});

afterEach(() => vi.unstubAllGlobals());

describe("saved products survive leaving", () => {
  it("what was written is what is read back", () => {
    writeFavorites("shop-a", [item()]);
    expect(readFavorites("shop-a")).toEqual([item()]);
  });

  it("one shop's hearts are not another's", () => {
    writeFavorites("shop-a", [item()]);
    expect(readFavorites("shop-b")).toEqual([]);
  });

  it("a corrupt store reads as nothing saved, not a crash", () => {
    store.set("sailo:favs:shop-a", "{not json");
    expect(readFavorites("shop-a")).toEqual([]);
  });

  it("junk rows are dropped, honest ones kept", () => {
    store.set(
      "sailo:favs:shop-a",
      JSON.stringify([item(), { hello: "there" }, 42, null]),
    );
    expect(readFavorites("shop-a")).toEqual([item()]);
  });
});

describe("the heart toggles", () => {
  it("saving an unsaved product puts it first", () => {
    const items = toggleFavorite([item()], item({ productId: "p2", slug: "hat" }));
    expect(items.map((i) => i.productId)).toEqual(["p2", "p1"]);
  });

  it("saving a saved product unsaves it", () => {
    const items = toggleFavorite([item()], item());
    expect(items).toEqual([]);
  });

  it("membership answers by product, not by snapshot", () => {
    // The cached title may have changed since saving; the heart must still fill.
    expect(isFavorite([item()], "p1")).toBe(true);
    expect(isFavorite([item()], "p2")).toBe(false);
  });

  it("removing removes only its product", () => {
    const items = removeFavorite(
      [item(), item({ productId: "p2", slug: "hat" })],
      "p1",
    );
    expect(items.map((i) => i.productId)).toEqual(["p2"]);
  });
});
