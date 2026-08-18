import { describe, expect, it } from "vitest";
import {
  slugifyHeading,
  splitAtMidHeading,
  withHeadingAnchors,
} from "./blog-toc";

/**
 * The sidebar is only as good as these three functions, and each of them has a
 * failure mode that is invisible in English.
 */

describe("slugifyHeading", () => {
  it("makes an ordinary heading into an ordinary anchor", () => {
    expect(slugifyHeading("What it costs")).toBe("what-it-costs");
  });

  it("folds punctuation and collapses runs", () => {
    expect(slugifyHeading("Pricing — what, exactly?")).toBe(
      "pricing-what-exactly",
    );
  });

  it("keeps the letters of every script this blog publishes in", () => {
    /*
     * The bug this exists for: a naive `[^a-z0-9]` slug turns every Arabic,
     * Greek, Thai and Chinese heading into the empty string, so all of them
     * collide and the sidebar becomes one anchor pointing at the top.
     */
    expect(slugifyHeading("كيف تسعّر عملك")).not.toBe("section");
    expect(slugifyHeading("価格の付け方")).not.toBe("section");
    expect(slugifyHeading("Πώς να τιμολογήσετε")).not.toBe("section");
    for (const heading of ["كيف تسعّر", "価格", "Τιμές", "ราคา"]) {
      expect(slugifyHeading(heading), heading).not.toBe("");
    }
  });

  it("strips combining marks so two headings that look alike are one anchor", () => {
    expect(slugifyHeading("Café")).toBe(slugifyHeading("Cafe"));
  });

  it("never returns an empty string", () => {
    // An emoji-only heading is legal Markdown and would otherwise slug to "".
    expect(slugifyHeading("🎉")).toBe("section");
    expect(slugifyHeading("   ")).toBe("section");
  });
});

describe("withHeadingAnchors", () => {
  it("adds an id to every h2 and h3, in document order", () => {
    const { html, headings } = withHeadingAnchors(
      "<h2>First</h2><p>x</p><h3>Second</h3>",
    );

    expect(headings).toEqual([
      { id: "first", text: "First", level: 2 },
      { id: "second", text: "Second", level: 3 },
    ]);
    expect(html).toContain('<h2 id="first">First</h2>');
    expect(html).toContain('<h3 id="second">Second</h3>');
  });

  it("leaves h1 and h4 alone", () => {
    const { headings } = withHeadingAnchors("<h1>Title</h1><h4>Aside</h4>");
    expect(headings).toEqual([]);
  });

  it("reads through markup inside a heading", () => {
    const { headings } = withHeadingAnchors(
      "<h2>The <strong>real</strong> cost</h2>",
    );
    expect(headings[0]?.text).toBe("The real cost");
    expect(headings[0]?.id).toBe("the-real-cost");
  });

  it("decodes entities so an ampersand is not `amp`", () => {
    const { headings } = withHeadingAnchors("<h2>Stock &amp; variants</h2>");
    expect(headings[0]?.text).toBe("Stock & variants");
  });

  it("suffixes a repeated heading rather than pointing two entries at one", () => {
    const { headings } = withHeadingAnchors(
      "<h2>What it costs</h2><h2>What it costs</h2>",
    );
    expect(headings.map((h) => h.id)).toEqual([
      "what-it-costs",
      "what-it-costs-2",
    ]);
  });

  it("keeps an id the author wrote, because something may link to it", () => {
    const { html, headings } = withHeadingAnchors(
      '<h2 id="pricing">What it costs</h2>',
    );
    expect(headings[0]?.id).toBe("pricing");
    expect(html).toContain('id="pricing"');
    expect(html).not.toContain("what-it-costs");
  });

  it("leaves an empty heading out of the map entirely", () => {
    const { headings } = withHeadingAnchors("<h2></h2><h2>Real</h2>");
    expect(headings).toHaveLength(1);
  });
});

describe("splitAtMidHeading", () => {
  /** A body long enough to earn an interruption, with `n` sections. */
  const body = (sections: number) =>
    Array.from(
      { length: sections },
      (_, i) => `<h2 id="s${i}">Section ${i}</h2><p>${"word ".repeat(400)}</p>`,
    ).join("");

  it("does not interrupt a short article", () => {
    const html = "<h2>a</h2><p>short</p><h2>b</h2><p>short</p><h2>c</h2>";
    expect(splitAtMidHeading(html)).toEqual([html, ""]);
  });

  it("does not interrupt a long article with too few sections", () => {
    const html = `<p>${"word ".repeat(3000)}</p><h2>only one</h2>`;
    expect(splitAtMidHeading(html)).toEqual([html, ""]);
  });

  it("splits on a heading, never mid-paragraph", () => {
    const [before, after] = splitAtMidHeading(body(6));
    expect(after.startsWith("<h2")).toBe(true);
    // Nothing is lost or duplicated by the cut.
    expect(before + after).toBe(body(6));
  });

  it("never breaks at the first or last section", () => {
    const html = body(4);
    const [before, after] = splitAtMidHeading(html);
    // The first section is entirely above the break…
    expect(before).toContain('id="s0"');
    // …and the last is entirely below it.
    expect(after).toContain('id="s3"');
    expect(before).not.toContain('id="s3"');
  });
});
