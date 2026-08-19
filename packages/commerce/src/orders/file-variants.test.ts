import { describe, expect, it } from "vitest";
import { filesForVariant } from "./downloads";

/**
 * Which files a combination is entitled to — spec 48.
 *
 * The interesting half of files-per-variant is pure, and this is it. The
 * database half is one `inArray` read; the rule that decides whether a buyer
 * gets the expensive variant's files is entirely here, which is why it is a
 * function rather than a filter inlined at the two call sites that need it.
 *
 * Both directions matter and they fail differently. Falling back when a
 * variant has no files of its own is what keeps every existing catalogue
 * working; *not* widening when it does have some is the security half — the
 * cheap variant's buyer must not be able to fetch the expensive one's file.
 */

type Row = { id: string; productId: string; variantId: string | null };

const P = "product-1";
const OTHER = "product-2";

const file = (id: string, variantId: string | null, productId = P): Row => ({
  id,
  productId,
  variantId,
});

describe("files for a variant", () => {
  it("falls back to the product's defaults when the variant has none", () => {
    const files = [file("default-a", null), file("default-b", null)];
    expect(
      filesForVariant(files, { productId: P, variantId: "v1" }).map((f) => f.id),
    ).toEqual(["default-a", "default-b"]);
  });

  it("gives a variant its own files instead of the defaults", () => {
    const files = [file("default", null), file("v1-only", "v1")];
    expect(
      filesForVariant(files, { productId: P, variantId: "v1" }).map((f) => f.id),
    ).toEqual(["v1-only"]);
  });

  /*
   * The one that is the whole feature inverted if it fails. "PDF only" and
   * "PDF + Figma" are the case the column exists for, and a buyer of the first
   * reaching the second's file is the seller's product given away at the lower
   * price.
   */
  it("never hands one variant's files to another", () => {
    const files = [file("cheap", "v1"), file("expensive", "v2")];
    expect(
      filesForVariant(files, { productId: P, variantId: "v1" }).map((f) => f.id),
    ).toEqual(["cheap"]);
    expect(
      filesForVariant(files, { productId: P, variantId: "v2" }).map((f) => f.id),
    ).toEqual(["expensive"]);
  });

  it("gives a product-level order only the defaults, never a variant's", () => {
    // No variant on the line means the buyer bought the plain product. A
    // variant's files were set aside for buyers of that variant.
    const files = [file("default", null), file("v1-only", "v1")];
    expect(
      filesForVariant(files, { productId: P, variantId: null }).map((f) => f.id),
    ).toEqual(["default"]);
  });

  it("ignores files belonging to another product entirely", () => {
    const files = [file("mine", null), file("theirs", null, OTHER)];
    expect(
      filesForVariant(files, { productId: P, variantId: null }).map((f) => f.id),
    ).toEqual(["mine"]);
  });

  it("answers with nothing when the product has no files at all", () => {
    expect(filesForVariant([], { productId: P, variantId: "v1" })).toEqual([]);
  });

  /*
   * A variant with files of its own does *not* also get the defaults. This is
   * Easytools' rule and the one that makes the feature comprehensible: the
   * override is a replacement, so a seller who assigns one file to "PDF only"
   * knows that is what that buyer receives — rather than that file plus
   * whatever else is lying around at the product level.
   */
  it("replaces the defaults rather than adding to them", () => {
    const files = [file("default", null), file("v1-only", "v1")];
    const got = filesForVariant(files, { productId: P, variantId: "v1" });
    expect(got.map((f) => f.id)).not.toContain("default");
  });
});
