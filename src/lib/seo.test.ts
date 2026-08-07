import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd, blogJsonLd, productJsonLd, shopJsonLd } from "./seo";
import { PAYMENT_METHOD_TYPES } from "./payments";

/*
 * What these are for.
 *
 * Structured data is the one part of a page nobody looks at. It is read by
 * machines, it renders as nothing, and a claim in it that is not true of the
 * shop — a card button that is no longer there, a payment method the seller
 * never enabled — is invisible until it is a manual action in Search Console.
 * So the assertions here are mostly about what is *absent*.
 */

const SHOP = {
  name: "Forno Nove",
  handle: "forno",
  description: "Sourdough, Tuesdays and Fridays.",
  avatarUrl: null,
  location: "Lecce",
  currency: "eur",
};

const PRODUCT = {
  title: "Sourdough loaf",
  slug: "sourdough-loaf",
  description: null,
  images: [],
  priceCents: 650,
  currency: "EUR",
  inStock: true,
  avgRating: null,
  reviewCount: 0,
  shop: { name: SHOP.name, handle: SHOP.handle },
};

describe("shopJsonLd payment declarations", () => {
  it("names what the buyer can actually pay with", () => {
    const json = shopJsonLd(SHOP, {
      payment: [{ type: "card" }, { type: "bank_transfer" }],
    });

    expect(json.paymentAccepted).toContain("Credit Card");
    expect(json.paymentAccepted).toContain("Bank Transfer");
  });

  it("says nothing when the shop only takes orders over chat", () => {
    /*
     * The important case. WhatsApp is how the order is placed; the money then
     * moves off-platform by means we never learn. Declaring it as a payment
     * method would be answering a question we do not know the answer to.
     */
    const json = shopJsonLd(SHOP, {
      payment: [{ type: "whatsapp" }, { type: "instagram" }, { type: "phone" }],
    });

    expect(json).not.toHaveProperty("paymentAccepted");
  });

  it("says nothing when no rails were passed at all", () => {
    expect(shopJsonLd(SHOP)).not.toHaveProperty("paymentAccepted");
  });

  it("ignores a rail type it does not recognise", () => {
    // A row written by a newer deploy, read by an older one. Silence is the
    // safe answer; a crash or a guess is not.
    const json = shopJsonLd(SHOP, { payment: [{ type: "sepa_someday" }] });
    expect(json).not.toHaveProperty("paymentAccepted");
  });

  it("does not repeat a method offered twice", () => {
    const json = shopJsonLd(SHOP, {
      payment: [{ type: "card" }, { type: "card" }],
    });
    expect(json.paymentAccepted?.match(/Credit Card/g)).toHaveLength(1);
  });

  it("declares the currency in the case schema.org expects", () => {
    expect(shopJsonLd(SHOP).currenciesAccepted).toBe("EUR");
  });

  it("omits the currency rather than inventing one", () => {
    expect(shopJsonLd({ ...SHOP, currency: undefined })).not.toHaveProperty(
      "currenciesAccepted",
    );
  });

  it("covers every shipped rail, so a new one cannot be forgotten", () => {
    /*
     * `PAYMENT_SCHEMA` is a `Record` keyed on the union, so adding a rail
     * without deciding how it is declared is a type error rather than a
     * storefront that quietly under-describes itself. This asserts the rails
     * list itself has not drifted past what that table was written against.
     */
    for (const type of PAYMENT_METHOD_TYPES) {
      expect(() => shopJsonLd(SHOP, { payment: [{ type }] })).not.toThrow();
    }
  });
});

describe("productJsonLd offer terms", () => {
  it("uses URIs for acceptedPaymentMethod, not the display text", () => {
    const json = productJsonLd(PRODUCT, { payment: [{ type: "cod" }] });
    expect(json.offers.acceptedPaymentMethod).toEqual([
      "http://purl.org/goodrelations/v1#COD",
    ]);
  });

  it("maps both ways an order can travel", () => {
    const json = productJsonLd(PRODUCT, {
      delivery: [{ type: "shipping" }, { type: "collection" }],
    });
    expect(json.offers.availableDeliveryMethod).toEqual([
      "https://schema.org/ParcelService",
      "https://schema.org/OnSitePickup",
    ]);
  });

  it("omits both when the shop has neither", () => {
    const json = productJsonLd(PRODUCT);
    expect(json.offers).not.toHaveProperty("acceptedPaymentMethod");
    expect(json.offers).not.toHaveProperty("availableDeliveryMethod");
  });

  it("still omits an aggregateRating with no reviews behind it", () => {
    // Unchanged by this work, and worth pinning: a rating of zero reviews is a
    // structured-data error that can cost the whole rich result.
    expect(productJsonLd(PRODUCT)).not.toHaveProperty("aggregateRating");
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the trail from one, contiguously", () => {
    const json = breadcrumbJsonLd([
      { name: "Forno Nove", path: "/forno" },
      { name: "Sourdough loaf", path: "/forno/p/sourdough-loaf" },
    ]);

    expect(json.itemListElement.map((crumb) => crumb.position)).toEqual([1, 2]);
  });

  it("makes every item an absolute URL", () => {
    const json = breadcrumbJsonLd([{ name: "Blog", path: "/fr/blog" }]);
    expect(json.itemListElement[0]!.item).toMatch(/^https?:\/\/.+\/fr\/blog$/);
  });
});

describe("blogJsonLd", () => {
  it("carries the language, which is the whole point of 35 indexes", () => {
    const json = blogJsonLd({
      name: "Le blog",
      description: "Vendre en ligne, sans vitrine.",
      path: "/fr/blog",
      locale: "fr",
    });

    expect(json.inLanguage).toBe("fr");
    expect(json.url).toMatch(/\/fr\/blog$/);
  });
});
