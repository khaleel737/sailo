import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * That this file stopped writing products, and what it does instead.
 *
 * The claim the extraction has to hold up is "a product created from the phone
 * is row-identical to one created from this form". There is exactly one way to
 * be sure of that and it is not a comparison — it is that only one function
 * writes the row. So what is asserted here is an absence: no INSERT, no UPDATE,
 * no slug, no plan check anywhere in the action. Everything that decides what a
 * product *is* now lives in `@sailo/commerce/products` and is tested there,
 * against the same code `products.save` in `@sailo/api` calls.
 *
 * A source assertion because that is the only kind that can see an absence.
 * `webhooks/emit.test.ts` and `replica.test.ts` established the pattern for the
 * same reason: these are facts about where code sits, and every one of them is
 * silent when it breaks.
 */

const SOURCE = readFileSync("src/lib/actions/products.ts", "utf8");
/** The half above the categories, which were never part of the extraction. */
const PRODUCT_HALF = SOURCE.slice(0, SOURCE.indexOf("/*  Categories"));

describe("the product action", () => {
  it("writes no product row itself", () => {
    /*
     * `categories` still does, below the split — that is a different table and
     * a different work order — so this looks only at the half that moved.
     */
    for (const write of [
      "insert(products)",
      "update(products)",
      "delete(products)",
      "insert(productVariants)",
      "insert(productImages)",
      "insert(productFiles)",
    ]) {
      expect(PRODUCT_HALF, write).not.toContain(write);
    }
  });

  it("decides nothing about what a product may be", () => {
    /*
     * Each of these was a branch in this file and is now a refusal in the
     * package. Left here, each would have been a rule the web form enforced and
     * `products.save` did not — which for the last two is not a difference in
     * validation but a hole: one is a URL this server fetches on a buyer's
     * behalf, and the other is a paid-plan boundary.
     */
    for (const rule of [
      "uniqueSlug",
      "atProductLimit",
      "isStoredFileUrl",
      "isPublicLinkUrl",
      "normalizeTrialDays",
    ]) {
      expect(PRODUCT_HALF, rule).not.toContain(rule);
    }
  });

  it("hands the shared write the whole form", () => {
    // The three things left: read it, call it, drop the caches this app keeps.
    /*
     * Two assertions rather than one string, because the call now wraps: it
     * takes the shop's time zone as well as its currency, since spec 43's sell
     * windows are wall-clock times in the seller's own zone. What is being
     * pinned is that the action hands the *whole form* to the shared write and
     * keeps no rule of its own — not how prettier chose to break the line.
     */
    expect(PRODUCT_HALF).toContain("await saveProductRow(");
    expect(PRODUCT_HALF).toContain("readProduct(formData, shop.currency");
    expect(PRODUCT_HALF).toContain("dropCatalogueCaches");
  });

  it("still has a sentence for every refusal the package can return", () => {
    /*
     * The exhaustive `switch` in `sentenceFor` is what makes this a compile
     * error rather than a blank error toast when a refusal is added — this
     * asserts the switch is still the shape that gets that check, since a
     * `default:` branch would silence it.
     */
    const sentences = PRODUCT_HALF.slice(
      PRODUCT_HALF.indexOf("function sentenceFor"),
      PRODUCT_HALF.indexOf("function readEventStart"),
    );
    expect(sentences).toContain("switch (refusal.kind)");
    expect(sentences).not.toContain("default:");
  });
});
