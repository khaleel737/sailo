import { describe, expect, it } from "vitest";
import {
  checkoutLabels,
  checkoutLineDescription,
  checkoutLineName,
  toCheckoutLine,
  type CheckoutLineLabels,
  type CheckoutLineSource,
} from "./checkout-lines";

/**
 * What the buyer reads on Stripe's page, per kind of thing they bought.
 *
 * The bug this covers was an absence rather than a wrong value — the session
 * carried a name and a price and nothing else — so most of these assert that
 * something is *there*, and the rest assert that the things which must never
 * be there still aren't. A test that only checked the happy string would have
 * passed against the version that shipped no description at all.
 */

const LABELS: CheckoutLineLabels = {
  digital: "Instant download",
  event: "Event ticket",
  online: "Online",
  inPerson: "In person",
  duration: (m) => `Takes ${m} min`,
  dateTime: (d) => `on ${d.toISOString().slice(0, 10)}`,
};

function line(over: Partial<CheckoutLineSource> = {}): CheckoutLineSource {
  return {
    title: "Speckled mug",
    variantLabel: null,
    kind: "physical",
    sku: null,
    imageUrl: null,
    ...over,
  };
}

describe("checkoutLineName", () => {
  it("names the variant the buyer actually picked", () => {
    expect(checkoutLineName({ title: "Apron", variantLabel: "Charcoal" })).toBe(
      "Apron — Charcoal",
    );
  });

  it("leaves a product sold as one thing alone", () => {
    expect(checkoutLineName({ title: "Apron", variantLabel: null })).toBe("Apron");
  });
});

describe("physical", () => {
  it("carries the seller's own copy and no kind badge", () => {
    // "Ships to you" beside a mug tells nobody anything, and a description
    // that is only a badge is worse than none.
    const description = checkoutLineDescription(
      line({ description: "Hand-thrown stoneware." }),
      LABELS,
    );
    expect(description).toBe("Hand-thrown stoneware.");
  });

  it("has no description at all when the seller wrote none", () => {
    expect(checkoutLineDescription(line(), LABELS)).toBeUndefined();
  });

  it("falls back to the SKU only when nothing else identifies the line", () => {
    expect(checkoutLineDescription(line({ sku: "MUG-01" }), LABELS)).toBe("MUG-01");
  });

  it("drops the SKU once the name already carries a variant", () => {
    // The name reads "Apron — Charcoal"; a code after that is clutter on the
    // one screen that has to be legible at a glance.
    expect(
      checkoutLineDescription(line({ sku: "AP-CH", variantLabel: "Charcoal" }), LABELS),
    ).toBeUndefined();
  });
});

describe("digital", () => {
  it("says the file arrives immediately", () => {
    expect(checkoutLineDescription(line({ kind: "digital" }), LABELS)).toBe(
      "Instant download",
    );
  });

  it("keeps the badge in front of the seller's copy", () => {
    expect(
      checkoutLineDescription(
        line({ kind: "digital", description: "A 40-page PDF." }),
        LABELS,
      ),
    ).toBe("Instant download · A 40-page PDF.");
  });
});

describe("service", () => {
  it("carries duration, mode, place and the booked time", () => {
    const description = checkoutLineDescription(
      line({
        kind: "service",
        durationMinutes: 45,
        serviceMode: "in_person",
        serviceLocation: "12 Baker St",
        scheduledFor: new Date("2026-03-03T14:00:00Z"),
      }),
      LABELS,
    );
    expect(description).toBe("Takes 45 min · In person · 12 Baker St · on 2026-03-03");
  });

  it("omits the address for an online session", () => {
    // The join link is the good itself and is emailed after payment. This
    // string reaches Stripe before anybody has paid for it.
    const description = checkoutLineDescription(
      line({
        kind: "service",
        serviceMode: "online",
        serviceLocation: "https://meet.example/abc",
        durationMinutes: 30,
      }),
      LABELS,
    );
    expect(description).toBe("Takes 30 min · Online");
    expect(description).not.toContain("meet.example");
  });

  it("says the mode even with no duration set", () => {
    expect(
      checkoutLineDescription(line({ kind: "service", serviceMode: "in_person" }), LABELS),
    ).toBe("In person");
  });
});

describe("event", () => {
  it("carries the ticket badge, when it starts and where", () => {
    expect(
      checkoutLineDescription(
        line({
          kind: "event",
          eventStartsAt: new Date("2026-06-01T18:30:00Z"),
          serviceMode: "in_person",
          serviceLocation: "The Old Dairy",
        }),
        LABELS,
      ),
    ).toBe("Event ticket · on 2026-06-01 · The Old Dairy");
  });

  it("never prints the join URL of an online event", () => {
    const description = checkoutLineDescription(
      line({
        kind: "event",
        serviceMode: "online",
        serviceLocation: "https://zoom.example/xyz",
        eventStartsAt: new Date("2026-06-01T18:30:00Z"),
      }),
      LABELS,
    );
    expect(description).toContain("Online");
    expect(description).not.toContain("zoom.example");
  });
});

describe("membership", () => {
  /*
   * A membership never reaches `toCheckoutLine` — it is sold through
   * `createSubscriptionSession`, whose line is a Stripe Price rather than
   * `price_data`. This asserts the shared builder does nothing surprising if
   * one ever arrives here, which is the behaviour a mixed basket would need.
   */
  it("falls through to the seller's own copy", () => {
    expect(
      checkoutLineDescription(
        line({ kind: "membership", description: "Studio access, cancel any time." }),
        LABELS,
      ),
    ).toBe("Studio access, cancel any time.");
  });
});

describe("images", () => {
  it("sends the cover when there is one", () => {
    const built = toCheckoutLine(
      { ...line({ imageUrl: "https://blob.example/mug.jpg" }), unitPriceCents: 2400, quantity: 1 },
      LABELS,
    );
    expect(built.images).toEqual(["https://blob.example/mug.jpg"]);
  });

  it("drops anything Stripe could not fetch", () => {
    // Stripe fetches these from its own servers, so a relative path resolves
    // against nothing. A rejected image would fail the whole session, and
    // losing a sale over a thumbnail is not a trade worth making.
    for (const url of ["/uploads/mug.jpg", "http://insecure.example/m.jpg", "", null]) {
      const built = toCheckoutLine(
        { ...line({ imageUrl: url }), unitPriceCents: 2400, quantity: 1 },
        LABELS,
      );
      expect(built.images).toBeUndefined();
    }
  });
});

describe("the whole line", () => {
  it("keeps the price and quantity it was given", () => {
    const built = toCheckoutLine(
      { ...line({ kind: "digital" }), unitPriceCents: 999, quantity: 3 },
      LABELS,
    );
    expect(built).toMatchObject({
      name: "Speckled mug",
      description: "Instant download",
      unitPriceCents: 999,
      quantity: 3,
    });
  });

  it("truncates a description rather than letting it run down the page", () => {
    const built = toCheckoutLine(
      { ...line({ description: "x".repeat(500) }), unitPriceCents: 1, quantity: 1 },
      LABELS,
    );
    expect(built.description?.length).toBeLessThanOrEqual(300);
    expect(built.description?.endsWith("…")).toBe(true);
  });

  it("omits both optional fields rather than sending empty ones", () => {
    // `product_data: { description: "" }` is a validation error at Stripe, not
    // a blank line — the keys have to be absent, not falsy.
    const built = toCheckoutLine({ ...line(), unitPriceCents: 1, quantity: 1 }, LABELS);
    expect(built).not.toHaveProperty("description");
    expect(built).not.toHaveProperty("images");
  });
});

describe("checkoutLabels", () => {
  const dictionary = {
    shop: { kindDigital: "Sofort-Download", kindEvent: "Ticket" },
    checkout: { online: "Online", inPerson: "Vor Ort", duration: "Dauert {duration}" },
  };

  it("renders the booked time in the shop's zone, not the reader's", () => {
    /*
     * The hour on a booking is the hour the seller will be standing there.
     * Rendering it in the buyer's zone shows a Spanish customer 15:00 for an
     * appointment in London and is wrong by exactly the amount that makes
     * someone miss it.
     */
    // en-GB rather than en, only so the assertion can read the clock: `en` is
    // 12-hour, and "2:00 pm" makes the point less obvious than "14:00" does.
    const london = checkoutLabels(dictionary, "en-GB", "Europe/London");
    const tokyo = checkoutLabels(dictionary, "en-GB", "Asia/Tokyo");
    const at = new Date("2026-06-03T13:00:00Z");

    expect(london.dateTime(at)).toContain("14:00");
    expect(tokyo.dateTime(at)).toContain("22:00");
  });

  it("interpolates the duration into the shop's own language", () => {
    const de = checkoutLabels(dictionary, "de", "Europe/Berlin");
    expect(de.duration(45)).toContain("Dauert");
    expect(de.duration(45)).not.toContain("{duration}");
  });

  it("splits an hour and a half into both units", () => {
    const en = checkoutLabels(dictionary, "en", "UTC");
    const ninety = en.duration(90);
    expect(ninety).toMatch(/1\s*hr/);
    expect(ninety).toMatch(/30\s*min/);
  });
});
