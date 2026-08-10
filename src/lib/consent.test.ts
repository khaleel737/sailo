import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  });
  // A stand-in for the DOM constructor the module dispatches through. It is
  // never read, only constructed, so it needs no members — a function is a
  // lighter way to say that than an empty class.
  vi.stubGlobal("CustomEvent", function CustomEventStub() {});
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

/**
 * The banner has to describe the storage this file actually uses.
 *
 * A consent notice is a factual claim about the site, and this one listed
 * `sailo_consent` among the cookies while `writeConsent` was putting it in
 * `localStorage` — a notice about cookies getting its own storage wrong, and
 * disagreeing with the inventory in `legal.ts`, which never listed it.
 *
 * Nothing enforces the agreement between the two files, and neither of them
 * breaks when it lapses. So this reads the banner and checks that whatever it
 * says about `sailo_consent` is qualified rather than filed as a cookie.
 */
describe("what the banner claims is stored", () => {
  const banner = readFileSync(
    "src/components/shared/cookie-consent.tsx",
    "utf8",
  );

  it("does not list the consent key as a plain cookie", () => {
    // The declaration, not the prose: the comments discuss it by name.
    const list = /stored: \[(.*?)\]/s.exec(banner)?.[1] ?? "";
    expect(list).toContain("sailo_consent");
    expect(list).not.toContain('"sailo_consent"');
    expect(list).toContain("sailo_consent (localStorage)");
  });

  it("still keeps the answer out of a cookie", () => {
    // The premise of the label above. If this ever moves to a cookie, the
    // label becomes the wrong one and this is what says so.
    const consent = readFileSync("src/lib/consent.ts", "utf8");
    expect(consent).toContain("localStorage.setItem(CONSENT_KEY");
    expect(consent).not.toContain("document.cookie");
  });
});
