import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorageWindow } from "@sailo/config/testing";
import {
  CONSENT_KEY,
  CONSENT_VERSION,
  hasAnalyticsConsent,
  readConsent,
  writeConsent,
} from "./consent";

/**
 * The gate that decides whether Google Analytics loads at all.
 *
 * Every case here is "does this count as consent?", and the answer has to be
 * no unless someone actually said yes. A bug in the permissive direction loads
 * a tag and sets cookies for a visitor who declined, which is the failure that
 * carries a fine.
 */

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  // The module reads `window.localStorage`, so the window is what needs
  // standing in — stubbing a bare `localStorage` global left every write
  // going nowhere and every read returning null, which reads as "declined".
  stubLocalStorageWindow(store);
});

afterEach(() => vi.unstubAllGlobals());

describe("what does not count as consent", () => {
  it("nothing stored — the visitor has not been asked", () => {
    expect(readConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("an explicit refusal", () => {
    writeConsent("denied");
    expect(hasAnalyticsConsent()).toBe(false);
    expect(readConsent()?.analytics).toBe("denied");
  });

  it("an answer to an older version of the question", () => {
    // Categories changed, so the old yes was to something else.
    store.set(
      CONSENT_KEY,
      JSON.stringify({ analytics: "granted", version: CONSENT_VERSION - 1, at: "x" }),
    );
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("a hand-edited value", () => {
    store.set(CONSENT_KEY, JSON.stringify({ analytics: "yes please", version: CONSENT_VERSION }));
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("malformed JSON", () => {
    store.set(CONSENT_KEY, "{not json");
    expect(readConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("a value of the wrong shape entirely", () => {
    store.set(CONSENT_KEY, JSON.stringify(["granted"]));
    expect(hasAnalyticsConsent()).toBe(false);
    store.set(CONSENT_KEY, JSON.stringify(null));
    expect(hasAnalyticsConsent()).toBe(false);
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
    // Not asked, rather than agreed. The banner asks again, which is the safe
    // direction to fail in.
    expect(hasAnalyticsConsent()).toBe(false);
    expect(() => writeConsent("granted")).not.toThrow();
  });
});

describe("what does count", () => {
  it("an explicit yes at the current version", () => {
    writeConsent("granted");
    expect(hasAnalyticsConsent()).toBe(true);
  });

  it("records when it was given, so the date is answerable", () => {
    writeConsent("granted");
    const at = readConsent()?.at ?? "";
    expect(Number.isNaN(Date.parse(at))).toBe(false);
  });

  it("a later answer replaces an earlier one, both ways", () => {
    writeConsent("granted");
    expect(hasAnalyticsConsent()).toBe(true);
    writeConsent("denied");
    expect(hasAnalyticsConsent()).toBe(false);
    writeConsent("granted");
    expect(hasAnalyticsConsent()).toBe(true);
  });
});
