import { describe, expect, it } from "vitest";
import { newTicketCode, normalizeTicketCode, ticketValues } from "./tickets";

/**
 * The two pure things in the door: what a code is, and what an order's event
 * lines earn. Neither needs a database to be wrong, so neither needs one to
 * be tested.
 */

describe("newTicketCode", () => {
  it("has no letters that can be misread aloud or off a photo", () => {
    // Crockford's alphabet drops I, L, O and U on purpose. A door reads these
    // out and types them in, and "1" against "I" is the whole reason.
    for (let n = 0; n < 200; n++) {
      expect(newTicketCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 500 }, newTicketCode));
    expect(seen.size).toBe(500);
  });
});

describe("normalizeTicketCode", () => {
  it("accepts what was printed", () => {
    expect(normalizeTicketCode("ABC12-DE345")).toBe("ABC12-DE345");
  });

  it("accepts it typed badly", () => {
    // Lowercase, no dash, stray spaces — all of which happen at a door.
    expect(normalizeTicketCode("abc12de345")).toBe("ABC12-DE345");
    expect(normalizeTicketCode(" ABC12 DE345 ")).toBe("ABC12-DE345");
    expect(normalizeTicketCode("ABC12–DE345")).toBe("ABC12-DE345");
  });

  it("folds the four lookalikes back to what was printed", () => {
    // A code can never contain I, L, O or U, so anyone who typed one meant
    // the character that looks like it.
    expect(normalizeTicketCode("ABC1I-DE345")).toBe("ABC11-DE345");
    expect(normalizeTicketCode("ABClI-DE345")).toBe("ABC11-DE345");
    expect(normalizeTicketCode("ABCO2-DE345")).toBe("ABC02-DE345");
    expect(normalizeTicketCode("ABCU2-DE345")).toBe("ABCV2-DE345");
  });

  it("reads a code out of the URL an old QR encodes", () => {
    /*
     * Every ticket issued before the in-app scanner carries a QR holding a
     * link, not a code, and those sit in buyers' inboxes for months. The
     * scanner hands whatever it decoded straight to this function, so if this
     * regresses, every ticket already sold stops scanning.
     */
    expect(
      normalizeTicketCode("https://shop.example.com/admin/checkin?code=ABC12-DE345"),
    ).toBe("ABC12-DE345");
    expect(
      normalizeTicketCode("http://localhost:3000/admin/checkin?code=abc12de345"),
    ).toBe("ABC12-DE345");
  });

  it("does not turn a URL without a code into one", () => {
    // The host and path are full of letters; folding them into a code would
    // produce a plausible-looking string that matches nothing.
    expect(normalizeTicketCode("https://shop.example.com/admin/checkin")).toBe("");
  });

  it("answers empty for junk rather than guessing", () => {
    expect(normalizeTicketCode("")).toBe("");
    expect(normalizeTicketCode("   ")).toBe("");
    // Too short to be a code: returned as-is, unpadded, so it matches no row.
    expect(normalizeTicketCode("ABC")).toBe("ABC");
  });
});

describe("ticketValues", () => {
  const ids = { orderId: "order-1", shopId: "shop-1" };

  it("fans quantity out to one row per admission", () => {
    const rows = ticketValues(
      [
        {
          kind: "event",
          productId: "ev-1",
          quantity: 3,
          variantOptions: null,
          options: [],
        },
      ],
      ids,
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.code)).size).toBe(3);
  });

  it("reads the lines, never the header", () => {
    // A basket holding a mug and two tickets must earn two admissions, not
    // the header quantity's worth and not none.
    const rows = ticketValues(
      [
        {
          kind: "physical",
          productId: "mug",
          quantity: 5,
          variantOptions: null,
          options: [],
        },
        {
          kind: "event",
          productId: "ev-1",
          quantity: 2,
          variantOptions: null,
          options: [],
        },
      ],
      ids,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.productId === "ev-1")).toBe(true);
  });

  it("snapshots the tier rather than pointing at the variant", () => {
    /*
     * A variant renamed between the on-sale and the night — or deleted after
     * it — must not change what prints beside a name on the door list.
     */
    const rows = ticketValues(
      [
        {
          kind: "event",
          productId: "ev-1",
          quantity: 1,
          variantOptions: { Tier: "VIP" },
          options: [{ name: "Tier", values: ["Standard", "VIP"] }],
        },
      ],
      ids,
    );
    expect(rows[0]?.tier).toBe("VIP");
    expect(rows[0]?.source).toBe("order");
  });

  it("earns nothing from a zero or negative quantity", () => {
    expect(
      ticketValues(
        [
          {
            kind: "event",
            productId: "ev-1",
            quantity: 0,
            variantOptions: null,
            options: [],
          },
          {
            kind: "event",
            productId: "ev-2",
            quantity: -4,
            variantOptions: null,
            options: [],
          },
        ],
        ids,
      ),
    ).toEqual([]);
  });
});
