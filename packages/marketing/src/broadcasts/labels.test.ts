import { describe, expect, it } from "vitest";
import { shopDictionary, broadcastLabels } from "./labels";
import type { Shop } from "@sailo/db/schema";

/**
 * The words around a broadcast that are ours rather than the seller's.
 *
 * The body of a broadcast is the seller's own writing. The chrome — the unsubscribe line,
 * the footer — is ours, and it is rendered in the *shop's* language rather than the
 * recipient's, because the shop's is the only language we actually know. A buyer on an
 * English phone receiving a French shop's newsletter gets French chrome, which reads as
 * intentional; guessing from a header we do not have does not.
 */

const shop = (locale: string | null) => ({ locale } as Shop);

describe("shopDictionary", () => {
  it("uses the shop's language", () => {
    const { t } = shopDictionary(shop("fr"));
    const english = shopDictionary(shop("en")).t;

    expect(t).not.toBe(english);
  });

  it("falls back to English for a shop that never set one", () => {
    // `locale` is nullable on `shops`, and a shop created before the column existed has
    // no value — that must not produce an empty unsubscribe line.
    expect(shopDictionary(shop(null)).t).toBe(shopDictionary(shop("en")).t);
  });

  it("falls back to English for a language we do not carry", () => {
    expect(shopDictionary(shop("klingon")).t).toBe(shopDictionary(shop("en")).t);
  });
});

describe("broadcastLabels", () => {
  it("gives every label a non-empty string", () => {
    const labels = broadcastLabels(shopDictionary(shop("en")).t);

    for (const [key, value] of Object.entries(labels)) {
      // A blank label in an email's chrome is a footer that looks broken to a buyer who
      // has no idea what a broadcast is.
      expect(typeof value, key).toBe("string");
      expect(String(value).trim(), key).not.toBe("");
    }
  });

  it("produces different words for a different language", () => {
    const en = broadcastLabels(shopDictionary(shop("en")).t);
    const fr = broadcastLabels(shopDictionary(shop("fr")).t);

    expect(JSON.stringify(fr)).not.toBe(JSON.stringify(en));
  });

  it("gives every label for every locale we ship", () => {
    for (const locale of ["ar", "de", "es", "ja", "pt", "tr", "zh"]) {
      const labels = broadcastLabels(shopDictionary(shop(locale)).t);
      for (const [key, value] of Object.entries(labels)) {
        expect(String(value).trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });
});
