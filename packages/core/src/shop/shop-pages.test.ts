import { describe, expect, it } from "vitest";
import type { Shop } from "@sailo/db/schema";
import {
  SHOP_PAGE_KINDS,
  analyticsPreanswer,
  parseFaq,
  renderShopPage,
  renderShopPages,
  shopPageFacts,
  toPageSlug,
  validatePageSlug,
  type GeneratorAnswers,
} from "./shop-pages";

/**
 * The seller's hosted documents, as a template.
 *
 * Two properties carry this file, and both are about what happens when the shop
 * row is *empty* — which is the ordinary case, because most sellers here are
 * sole traders who filled in a trading name and nothing else:
 *
 *   1. **A missing fact says it is missing.** Never `undefined`, never a blank.
 *      A published page reading "These terms are between you and undefined" is
 *      the whole reason this module renders rather than interpolating.
 *   2. **A refusal to answer is not an answer.** A blank refund window and a
 *      window of `0` are different policies, and rendering one as the other
 *      publishes terms the seller never chose.
 */

const shop = (over: Partial<Shop> = {}) =>
  ({
    name: "Ada's Ceramics",
    location: "Lisbon, Portugal",
    contactEmail: "hello@adas.example",
    taxId: null,
    locale: "en",
    invoiceLegalName: null,
    invoiceAddressLine1: null,
    invoiceAddressLine2: null,
    invoiceCity: null,
    invoiceRegion: null,
    invoicePostalCode: null,
    invoiceCountry: null,
    invoiceRegistrationNumber: null,
    ga4MeasurementId: null,
    gtmContainerId: null,
    metaPixelId: null,
    tiktokPixelId: null,
    ...over,
  }) as Shop;

const answers = (over: Partial<GeneratorAnswers> = {}): GeneratorAnswers => ({
  refundWindowDays: 14,
  extraDataCollected: null,
  usesAnalytics: false,
  shipsPhysicalGoods: false,
  ...over,
});

const factsFor = (row: Shop, over: Partial<GeneratorAnswers> = {}) =>
  shopPageFacts(row, answers(over), {
    sells: ["digital"],
    generatedOn: "2026-08-19",
  });

/* -------------------------------------------------------------------------- */

describe("rendering from a complete shop", () => {
  const complete = shop({
    invoiceLegalName: "Ada Lovelace Unipessoal Lda",
    invoiceAddressLine1: "Rua do Século 12",
    invoiceCity: "Lisboa",
    invoicePostalCode: "1200-433",
    invoiceCountry: "PT",
    invoiceRegistrationNumber: "PT509876543",
    taxId: "PT123456789",
  });

  it("names the registered entity, not the trading name", () => {
    const page = renderShopPage("terms", factsFor(complete));
    expect(page.bodyMd).toContain("Ada Lovelace Unipessoal Lda");
    expect(page.gaps).toEqual([]);
  });

  it("prints the registration and tax numbers when they exist", () => {
    const page = renderShopPage("terms", factsFor(complete));
    expect(page.bodyMd).toContain("PT509876543");
    expect(page.bodyMd).toContain("PT123456789");
  });

  it("renders every kind without a gap", () => {
    for (const page of renderShopPages(factsFor(complete))) {
      expect(page.gaps, page.kind).toEqual([]);
    }
  });
});

describe("rendering from a sparse shop", () => {
  /*
   * The shop this feature is mostly for: a trading name, an email, and nothing
   * a tax authority would recognise.
   */
  const sparse = shop({ contactEmail: null, location: null });

  it("never emits the string `undefined`", () => {
    for (const page of renderShopPages(factsFor(sparse))) {
      expect(page.bodyMd, page.kind).not.toContain("undefined");
    }
  });

  it("says what is missing instead of leaving a hole", () => {
    const page = renderShopPage("terms", factsFor(sparse));
    expect(page.bodyMd).toContain("add this before publishing");
    expect(page.gaps).toContain("your business address");
    expect(page.gaps).toContain("a contact email address");
  });

  it("falls back to the trading name rather than marking the name missing", () => {
    /*
     * A shop always has a `name` — it is NOT NULL — so the business name is the
     * one fact that is never absent. What may be absent is a *registered* entity
     * distinct from it, and the template must not demand one: a sole trader has
     * no such thing, and asking for it would put a permanent gap marker on the
     * page of every seller who is trading perfectly lawfully.
     */
    const page = renderShopPage("terms", factsFor(sparse));
    expect(page.bodyMd).toContain("Ada's Ceramics");
    expect(page.gaps).not.toContain("your business name");
  });

  it("lists each gap once however many times it is used", () => {
    const page = renderShopPage("privacy", factsFor(sparse));
    const email = page.gaps.filter((gap) => gap === "a contact email address");
    expect(email).toHaveLength(1);
  });
});

describe("the refund window", () => {
  it("states that no window is set rather than inventing one", () => {
    const page = renderShopPage("refunds", factsFor(shop(), { refundWindowDays: null }));
    expect(page.bodyMd).toContain("have not set a standard refund window");
    expect(page.bodyMd).not.toContain("within **14 days**");
  });

  it("treats zero as a policy, not as an absence", () => {
    /*
     * Blank ≠ zero, on a page a buyer reads before paying. A seller who typed
     * `0` has said "no refunds beyond the law"; one who typed nothing has said
     * nothing, and publishing the first sentence for the second would be a
     * policy they never chose.
     */
    const page = renderShopPage("refunds", factsFor(shop(), { refundWindowDays: 0 }));
    expect(page.bodyMd).toContain("do not offer refunds beyond what the law requires");
    expect(page.bodyMd).not.toContain("have not set a standard refund window");
  });

  it("prints the number when there is one", () => {
    const page = renderShopPage("refunds", factsFor(shop(), { refundWindowDays: 30 }));
    expect(page.bodyMd).toContain("**30 days**");
  });
});

describe("the privacy policy's analytics paragraph", () => {
  it("says analytics run when the seller says so", () => {
    const page = renderShopPage("privacy", factsFor(shop(), { usesAnalytics: true }));
    expect(page.bodyMd).toContain("uses analytics and advertising tools");
  });

  it("says they do not when the seller says so", () => {
    const page = renderShopPage("privacy", factsFor(shop(), { usesAnalytics: false }));
    expect(page.bodyMd).toContain("do not run analytics");
  });

  it("carries anything else the seller says they collect", () => {
    const page = renderShopPage(
      "privacy",
      factsFor(shop(), { extraDataCollected: "Ring size, for engraving." }),
    );
    expect(page.bodyMd).toContain("Ring size, for engraving.");
  });

  it("never promises to delete a suppression record", () => {
    /*
     * The one "deletion" that does the opposite of what was asked. Spec 52
     * turns on it and the privacy policy is where a buyer reads about it first,
     * so the sentence is asserted here rather than left to prose review.
     */
    const page = renderShopPage("privacy", factsFor(shop()));
    expect(page.bodyMd).toContain("permanently and on purpose");
  });
});

describe("analyticsPreanswer", () => {
  it("is false for a shop with no tags at all", () => {
    expect(analyticsPreanswer(shop())).toBe(false);
  });

  it.each([
    ["metaPixelId", "123456789"],
    ["gtmContainerId", "GTM-ABCDEF"],
    ["tiktokPixelId", "C0FFEE"],
    ["ga4MeasurementId", "G-ABCDEF"],
  ] as const)("is true when %s is set", (column, value) => {
    /*
     * GA4 is checked alongside the three the spec names. The question is
     * whether the storefront runs analytics, and a shop configured with only
     * GA4 runs analytics — pre-answering "no" there would put a false statement
     * about personal data on the one page written to be true about it.
     */
    expect(analyticsPreanswer(shop({ [column]: value }))).toBe(true);
  });
});

describe("slugs", () => {
  it.each(["terms", "refund-policy", "faq2"])("accepts %s", (slug) => {
    expect(validatePageSlug(slug)).toBeNull();
  });

  it.each([
    ["", "an empty slug"],
    ["-terms", "a leading hyphen"],
    ["terms-", "a trailing hyphen"],
    ["a--b", "a double hyphen"],
    ["my terms", "a space"],
    ["../secrets", "a traversal"],
    ["new", "a reserved word"],
  ])("refuses %s (%s)", (slug) => {
    expect(validatePageSlug(slug)).not.toBeNull();
  });

  it("accepts a slug the seller typed in capitals, and it is stored lowered", () => {
    /*
     * Lenient on case rather than refusing, because the seller is editing a
     * document and the web address is the field they care about least. The
     * caller lowercases before it validates and again before it writes, so what
     * is checked and what is stored are the same string.
     */
    expect(validatePageSlug("Terms")).toBeNull();
  });

  it("refuses anything past the length cap", () => {
    expect(validatePageSlug("a".repeat(49))).not.toBeNull();
  });

  it("derives a usable slug from a title", () => {
    expect(toPageSlug("Refunds & Returns")).toBe("refunds-returns");
    expect(toPageSlug("  Terms of Sale  ")).toBe("terms-of-sale");
  });

  it("produces something the validator accepts, or nothing at all", () => {
    // The action falls back when this returns empty, so the only unacceptable
    // outcome is a non-empty slug the validator would then refuse.
    for (const title of ["Terms of Sale", "FAQ", "Über uns", "!!!", "a".repeat(80)]) {
      const slug = toPageSlug(title);
      if (slug) expect(validatePageSlug(slug), title).toBeNull();
    }
  });
});

describe("parseFaq", () => {
  it("splits a generated FAQ into rows", () => {
    const page = renderShopPage("faq", factsFor(shop()));
    const entries = parseFaq(page.bodyMd);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(entries[0]?.question).toBe("How long does delivery take?");
    expect(entries[0]?.answer).not.toBe("");
  });

  it("drops a heading with nothing under it", () => {
    // A row with no answer renders as a strip that opens onto nothing.
    expect(parseFaq("### Empty\n\n### Real\n\nYes.")).toEqual([
      { question: "Real", answer: "Yes." },
    ]);
  });

  it("ignores a preamble before the first heading", () => {
    expect(parseFaq("Some intro text.\n\n### Q\n\nA.")).toEqual([
      { question: "Q", answer: "A." },
    ]);
  });

  it("is empty for an empty body", () => {
    expect(parseFaq(null)).toEqual([]);
    expect(parseFaq("")).toEqual([]);
    expect(parseFaq("no headings here")).toEqual([]);
  });
});

describe("determinism", () => {
  it("renders the same bytes twice for the same facts", () => {
    /*
     * What makes "regenerating warns and offers a diff" a real offer: the diff
     * shown is the diff that would be applied. A clock read inside the renderer
     * would make every regeneration look like a change.
     */
    const facts = factsFor(shop());
    for (const kind of SHOP_PAGE_KINDS) {
      expect(renderShopPage(kind, facts).bodyMd).toBe(
        renderShopPage(kind, facts).bodyMd,
      );
    }
  });
});
