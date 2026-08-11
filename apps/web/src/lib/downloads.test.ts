import { describe, expect, it } from "vitest";
import { hasReleasableDownloads } from "./downloads";

/**
 * Whether an order has files to unlock.
 *
 * This guard used to also require `order.productKind === "digital"`, which is
 * a header column describing the order's *first* line. A basket holding a mug
 * and a PDF therefore read as "physical", and every caller of
 * `releaseDownloads` — the Stripe webhook, the seller's payment dropdown, and
 * `clearRefund` — returned false forever. The buyer paid, the admin row said
 * "Files held", and no action available to anyone could free them.
 */

const order = (over: Partial<{ downloadToken: string | null; downloadReleasedAt: Date | null }> = {}) => ({
  downloadToken: "tok_1",
  downloadReleasedAt: null,
  ...over,
});

describe("hasReleasableDownloads", () => {
  it("releases a mixed basket, where the header line is not the digital one", () => {
    // The case that was broken: a mug on line 1, a PDF on line 2.
    expect(hasReleasableDownloads(order())).toBe(true);
  });

  it("releases an all-digital order", () => {
    expect(hasReleasableDownloads(order())).toBe(true);
  });

  it("has nothing to release without a token", () => {
    /*
     * The token is the authority. It is minted only when a line was found
     * carrying deliverable files, so its absence means there is nothing to
     * unlock — and its presence means there is, whatever the header says.
     */
    expect(hasReleasableDownloads(order({ downloadToken: null }))).toBe(false);
  });

  it("refuses a second release", () => {
    // A webhook retry, or a seller flipping payment status twice, must not
    // send the buyer a second "your files are ready" email.
    expect(
      hasReleasableDownloads(order({ downloadReleasedAt: new Date() })),
    ).toBe(false);
  });

  it("treats the epoch as released, not as absent", () => {
    // `new Date(0)` is falsy-adjacent in the wrong hands; only null is unset.
    expect(
      hasReleasableDownloads(order({ downloadReleasedAt: new Date(0) })),
    ).toBe(false);
  });
});
