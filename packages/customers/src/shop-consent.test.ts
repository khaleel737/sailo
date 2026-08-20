import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorageWindow } from "@sailo/config/testing";
import {
  SHOP_CONSENT_VERSION,
  clearShopConsent,
  hasShopMarketingConsent,
  readShopConsent,
  shopConsentKey,
  writeShopConsent,
} from "./shop-consent";

/**
 * The gate that decides whether a seller's tags load at all. As with
 * `consent.test.ts`, every case is "does this count as consent?" and the
 * answer has to be no unless this buyer said yes — about this shop. The
 * per-shop cases are the ones this file adds: a yes given on one storefront
 * leaking onto another is the platform consenting on a buyer's behalf.
 */

const SHOP_A = "11111111-1111-1111-1111-111111111111";
const SHOP_B = "22222222-2222-2222-2222-222222222222";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  // The module reads `window.localStorage`, so the window is the stand-in.
  stubLocalStorageWindow(store);
});

afterEach(() => vi.unstubAllGlobals());

describe("what does not count as consent", () => {
  it("nothing stored — this buyer has not been asked", () => {
    expect(readShopConsent(SHOP_A)).toBeNull();
    expect(hasShopMarketingConsent(SHOP_A)).toBe(false);
  });

  it("an explicit refusal", () => {
    writeShopConsent(SHOP_A, "denied");
    expect(hasShopMarketingConsent(SHOP_A)).toBe(false);
  });

  it("a yes to a different shop", () => {
    writeShopConsent(SHOP_A, "granted");
    expect(hasShopMarketingConsent(SHOP_B)).toBe(false);
  });

  it("an answer to an older version of the question", () => {
    store.set(
      shopConsentKey(SHOP_A),
      JSON.stringify({ marketing: "granted", version: SHOP_CONSENT_VERSION - 1, at: "x" }),
    );
    expect(hasShopMarketingConsent(SHOP_A)).toBe(false);
  });

  it("a hand-edited or malformed value", () => {
    store.set(shopConsentKey(SHOP_A), JSON.stringify({ marketing: "sure", version: SHOP_CONSENT_VERSION }));
    expect(hasShopMarketingConsent(SHOP_A)).toBe(false);
    store.set(shopConsentKey(SHOP_A), "{not json");
    expect(readShopConsent(SHOP_A)).toBeNull();
  });

  it("storage that throws — private browsing, or a full quota", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
      dispatchEvent: () => true,
    });
    expect(hasShopMarketingConsent(SHOP_A)).toBe(false);
    expect(() => writeShopConsent(SHOP_A, "granted")).not.toThrow();
  });
});

describe("what does count", () => {
  it("an explicit yes, for that shop alone", () => {
    writeShopConsent(SHOP_A, "granted");
    expect(hasShopMarketingConsent(SHOP_A)).toBe(true);
    expect(hasShopMarketingConsent(SHOP_B)).toBe(false);
  });

  it("records when it was given", () => {
    writeShopConsent(SHOP_A, "granted");
    const at = readShopConsent(SHOP_A)?.at ?? "";
    expect(Number.isNaN(Date.parse(at))).toBe(false);
  });

  it("withdrawing forgets that shop's answer and only that shop's", () => {
    writeShopConsent(SHOP_A, "granted");
    writeShopConsent(SHOP_B, "granted");
    clearShopConsent(SHOP_A);
    expect(readShopConsent(SHOP_A)).toBeNull();
    expect(hasShopMarketingConsent(SHOP_B)).toBe(true);
  });
});
