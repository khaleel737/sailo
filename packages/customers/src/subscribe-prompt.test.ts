import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorageWindow } from "@sailo/config/testing";
import {
  SUBSCRIBE_PROMPT_VERSION,
  SUBSCRIBE_SNOOZE_DAYS,
  dismissSubscribePrompt,
  markSubscribed,
  readSubscribePrompt,
  shouldAskToSubscribe,
  subscribePromptKey,
} from "./subscribe-prompt";

/**
 * Whether a storefront may put a signup card in somebody's way.
 *
 * The mirror image of `shop-consent.test.ts`: there, an unreadable store must
 * never be read as a yes, because guessing wrong loads trackers nobody agreed
 * to. Here, guessing wrong shows a card to somebody who closed one, so the
 * cases below check that it fails towards asking — while the two answers that
 * *are* on file are honoured exactly.
 */

const SHOP_A = "11111111-1111-1111-1111-111111111111";
const SHOP_B = "22222222-2222-2222-2222-222222222222";

const DAY = 86_400_000;
const NOW = new Date("2026-06-01T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  stubLocalStorageWindow(store);
});

afterEach(() => vi.unstubAllGlobals());

describe("when the popup may ask", () => {
  it("nobody has answered — ask", () => {
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(true);
  });

  it("closed just now — stay quiet", () => {
    dismissSubscribePrompt(SHOP_A);
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(false);
  });

  it("closed the day before the snooze runs out — still quiet", () => {
    store.set(
      subscribePromptKey(SHOP_A),
      JSON.stringify({
        state: "dismissed",
        version: SUBSCRIBE_PROMPT_VERSION,
        at: ago(SUBSCRIBE_SNOOZE_DAYS - 1),
      }),
    );
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(false);
  });

  it("closed long enough ago — ask again", () => {
    store.set(
      subscribePromptKey(SHOP_A),
      JSON.stringify({
        state: "dismissed",
        version: SUBSCRIBE_PROMPT_VERSION,
        at: ago(SUBSCRIBE_SNOOZE_DAYS + 1),
      }),
    );
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(true);
  });

  it("subscribed — never again, however long it has been", () => {
    store.set(
      subscribePromptKey(SHOP_A),
      JSON.stringify({
        state: "subscribed",
        version: SUBSCRIBE_PROMPT_VERSION,
        at: ago(SUBSCRIBE_SNOOZE_DAYS * 10),
      }),
    );
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(false);
  });

  it("an answer about one shop says nothing about the next", () => {
    markSubscribed(SHOP_A);
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(false);
    expect(shouldAskToSubscribe(SHOP_B, NOW)).toBe(true);
  });
});

describe("what a broken record does", () => {
  /*
   * All three fail towards asking. The alternative — treating anything
   * unreadable as a permanent no — turns one corrupt value into a storefront
   * that can never grow a list again, and there is no way for a visitor to
   * discover that or fix it.
   */
  it("not JSON at all", () => {
    store.set(subscribePromptKey(SHOP_A), "{{");
    expect(readSubscribePrompt(SHOP_A)).toBeNull();
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(true);
  });

  it("an answer to an older version of the question", () => {
    store.set(
      subscribePromptKey(SHOP_A),
      JSON.stringify({
        state: "subscribed",
        version: SUBSCRIBE_PROMPT_VERSION - 1,
        at: ago(1),
      }),
    );
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(true);
  });

  it("a state nothing writes", () => {
    store.set(
      subscribePromptKey(SHOP_A),
      JSON.stringify({ state: "maybe", version: SUBSCRIBE_PROMPT_VERSION, at: ago(1) }),
    );
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(true);
  });

  it("a dismissal with a timestamp nobody can age", () => {
    store.set(
      subscribePromptKey(SHOP_A),
      JSON.stringify({
        state: "dismissed",
        version: SUBSCRIBE_PROMPT_VERSION,
        at: "not a date",
      }),
    );
    expect(shouldAskToSubscribe(SHOP_A, NOW)).toBe(true);
  });
});

describe("writing", () => {
  it("subscribing replaces a dismissal, and outlasts it", () => {
    dismissSubscribePrompt(SHOP_A);
    markSubscribed(SHOP_A);
    expect(readSubscribePrompt(SHOP_A)?.state).toBe("subscribed");
  });

  it("storage that refuses the write does not throw at the caller", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => undefined,
      },
      dispatchEvent: () => true,
    });
    expect(() => dismissSubscribePrompt(SHOP_A)).not.toThrow();
  });
});
