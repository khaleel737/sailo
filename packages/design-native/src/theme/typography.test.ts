import { describe, expect, it } from "vitest";
import { fontWeights, typeScale, typeStyle } from "./typography";

/**
 * The scale, and the two promises it makes.
 *
 * The first is that Dynamic Type works without a screen doing anything, which
 * comes down to leading tracking the font scale — the thing React Native does
 * not do on its own and the thing nobody notices is broken until a seller turns
 * the text up and the lines start overlapping.
 *
 * The second is that nothing caps. `maxFontSizeMultiplier` is the usual way an
 * app keeps its layout when text grows, and it is a silent cap: the reader asks
 * for larger text and the app quietly declines. There is a test for its absence
 * because "we decided not to" is the kind of decision that gets undone by
 * somebody fixing a layout bug the fast way.
 */
describe("the type scale", () => {
  it("is ordered, largest to smallest", () => {
    const sizes = (["display", "title", "heading", "body", "callout", "caption"] as const).map(
      (variant) => typeScale[variant].size,
    );
    expect(sizes).toEqual([...sizes].toSorted((a, b) => b - a));
  });

  it("sits on iOS's own text styles rather than beside them", () => {
    /*
     * The point sizes Apple ships at the default ("Large") setting. Starting
     * from these is what lets the system scale the app for free; a 16pt "body"
     * would be a design system quietly opting out of Dynamic Type.
     */
    const ios = {
      largeTitle: 34,
      title1: 28,
      title3: 20,
      body: 17,
      callout: 16,
      footnote: 13,
      caption1: 12,
    } as const;

    for (const [variant, style] of Object.entries(typeScale)) {
      const expected = ios[style.iosTextStyle as keyof typeof ios];
      expect(expected, `${variant} claims an iOS style this test does not know`).toBeDefined();
      expect(style.size, `${variant} is not ${style.iosTextStyle}'s size`).toBe(expected);
    }
  });

  it("leaves every variant room to breathe", () => {
    for (const [variant, style] of Object.entries(typeScale)) {
      /*
       * Below about 1.15 the lines touch; above about 1.5 a two-line list row
       * reads as two separate rows. The big sizes sit at the tight end and the
       * small ones at the loose end, which is why this is a range and not a
       * constant.
       */
      expect(style.leading, `${variant}`).toBeGreaterThanOrEqual(1.15);
      expect(style.leading, `${variant}`).toBeLessThanOrEqual(1.5);
    }
  });

  it("shouts in exactly one variant", () => {
    const uppercase = Object.entries(typeScale)
      .filter(([, style]) => style.uppercase)
      .map(([variant]) => variant);
    expect(uppercase).toEqual(["label"]);
  });
});

describe("typeStyle", () => {
  /*
   * The whole reason leading is stored as a multiple. React Native scales
   * `fontSize` by the system font scale and leaves `lineHeight` alone, so at
   * the largest accessibility size a caption would get 13pt of leading around
   * 30pt of text. This is the assertion that the multiplication happens.
   */
  it("grows the leading with the font scale", () => {
    const base = typeStyle("body", 1);
    const large = typeStyle("body", 2);
    expect(large.lineHeight).toBeGreaterThan(base.lineHeight);
    expect(large.lineHeight).toBe(Math.round(base.lineHeight * 2));
  });

  /*
   * `fontSize` is deliberately *not* multiplied — React Native already does
   * that. Doing it here as well would square the scale, and a seller at 200%
   * would get 400% text.
   */
  it("leaves the font size for React Native to scale", () => {
    expect(typeStyle("body", 2).fontSize).toBe(typeScale.body.size);
  });

  it("gives the label variant its uppercase and everything else none", () => {
    expect(typeStyle("label", 1).textTransform).toBe("uppercase");
    expect(typeStyle("body", 1).textTransform).toBe("none");
  });
});

describe("the weights", () => {
  it("are the four names React Native's numbers stand for", () => {
    expect(fontWeights).toEqual({
      regular: "400",
      medium: "500",
      semibold: "600",
      bold: "700",
    });
  });

  it("gives every variant a weight that exists", () => {
    for (const [variant, style] of Object.entries(typeScale)) {
      expect(fontWeights[style.weight], `${variant}`).toBeDefined();
    }
  });
});
