import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorageWindow } from "@sailo/config/testing";
import {
  clearPendingOrder,
  clearStoredCart,
  markPendingOrder,
  readCart,
  readPendingOrder,
  writeCart,
  type CartLine,
} from "./cart";

/**
 * The property the basket exists to hold: what a buyer picked survives them
 * leaving. Every failure here is a basket that emptied itself — which reads to
 * the buyer as the shop forgetting them, and reads to the seller as a sale
 * that walked out the door.
 */

const store = new Map<string, string>();

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  variantId: null,
  quantity: 2,
  title: "Mug",
  label: "",
  kind: "physical",
  unitPriceCents: 1200,
  imageUrl: null,
  ...over,
});

beforeEach(() => {
  store.clear();
  // The module reads `window.localStorage`, so the window is what needs
  // standing in — the same stand-in `consent.test.ts` uses, for the same
  // reason.
  stubLocalStorageWindow(store);
});

afterEach(() => vi.unstubAllGlobals());

describe("the basket survives leaving", () => {
  it("what was written is what is read back", () => {
    writeCart("shop-a", [line()]);
    expect(readCart("shop-a")).toEqual([line()]);
  });

  it("one shop's basket is not another's", () => {
    writeCart("shop-a", [line()]);
    expect(readCart("shop-b")).toEqual([]);
  });

  it("emptying one shop's basket leaves the other's standing", () => {
    writeCart("shop-a", [line()]);
    writeCart("shop-b", [line({ productId: "p2" })]);
    clearStoredCart("shop-a");
    expect(readCart("shop-a")).toEqual([]);
    expect(readCart("shop-b")).toHaveLength(1);
  });

  it("storage that throws costs the basket, never the page", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => writeCart("shop-a", [line()])).not.toThrow();
    expect(readCart("shop-a")).toEqual([]);
    expect(() => clearStoredCart("shop-a")).not.toThrow();
  });
});

describe("the order parked while the buyer is at Stripe", () => {
  it("marked, read back, and forgotten on demand", () => {
    markPendingOrder("shop-a", "order-1");
    expect(readPendingOrder("shop-a")).toBe("order-1");
    clearPendingOrder("shop-a");
    expect(readPendingOrder("shop-a")).toBeNull();
  });

  it("parked per shop, like the basket it stands for", () => {
    markPendingOrder("shop-a", "order-1");
    expect(readPendingOrder("shop-b")).toBeNull();
  });

  it("parking does not touch the basket itself", () => {
    // The whole point of the marker: the basket stays until the money moves.
    writeCart("shop-a", [line()]);
    markPendingOrder("shop-a", "order-1");
    expect(readCart("shop-a")).toHaveLength(1);
  });

  it("storage that throws reads as nothing parked", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => markPendingOrder("shop-a", "order-1")).not.toThrow();
    expect(readPendingOrder("shop-a")).toBeNull();
    expect(() => clearPendingOrder("shop-a")).not.toThrow();
  });
});

/**
 * The regression this whole arrangement exists to prevent.
 *
 * The checkout panel used to call `onPlaced` — the cart's `clear` — the moment
 * a card order intent was created, before the buyer had paid anything. A buyer
 * who abandoned Stripe came back to an empty shop. Nothing breaks if someone
 * restores that line; only this does.
 */
describe("what the checkout panel does before a card redirect", () => {
  const panel = readFileSync(
    "src/app/[handle]/_components/cart/checkout-panel.tsx",
    "utf8",
  );

  it("parks the order for a card instead of emptying the basket", () => {
    expect(panel).toContain('if (method === "card")');
    expect(panel).toContain("markPendingOrder(shopId, res.orderId)");
    // Exactly one call to `onPlaced` — the one on the rails where the order
    // already stands. A second, unconditional one is the old bug returning.
    expect(panel.match(/onPlaced\?\.\(\)/g)).toHaveLength(1);
  });
});
