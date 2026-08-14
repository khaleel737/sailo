import { describe, expect, it } from "vitest";
import type { PaymentConfig } from "@sailo/db/schema";
import {
  isConfigured,
  isElectronic,
  isPaymentMethodType,
  isRailAvailable,
  isRailUsable,
  PAYMENT_CATEGORIES,
  PAYMENT_METHOD_DEFS,
  PAYMENT_METHOD_LIST,
  PAYMENT_METHOD_TYPES,
  railsForOrder,
} from "./rails";

/**
 * Whether a shop can actually take money through a rail.
 *
 * Both directions cost something real: offering a rail that isn't set up
 * strands a buyer who picks it, and hiding one that is loses the sale.
 */

const NO_STRIPE = { stripeAccountId: null, stripeChargesEnabled: false, currency: "USD" };
const STRIPE_LIVE = { stripeAccountId: "acct_1", stripeChargesEnabled: true, currency: "USD" };
const cfg = (o: Record<string, string> = {}) => o as PaymentConfig;

describe("the rail catalogue", () => {
  it("defines every rail it lists", () => {
    // A listed rail with no definition would crash the picker that renders it.
    for (const type of PAYMENT_METHOD_TYPES) {
      expect(PAYMENT_METHOD_DEFS[type]).toBeTruthy();
      expect(PAYMENT_METHOD_DEFS[type].kind).toBeTruthy();
    }
  });

  it("files every rail under a section the screen renders", () => {
    /*
     * The payments screen draws one section per category and fills it by
     * matching on this field. A rail with a category nothing lists — a typo,
     * or a new category added here and not there — would be configured
     * nowhere: it disappears off the admin while still working at checkout.
     */
    for (const type of PAYMENT_METHOD_TYPES) {
      expect(PAYMENT_CATEGORIES, type).toContain(PAYMENT_METHOD_DEFS[type].category);
    }
    // And the other way: an empty section would draw a heading over nothing.
    for (const category of PAYMENT_CATEGORIES) {
      expect(
        PAYMENT_METHOD_LIST.filter((d) => d.category === category),
        category,
      ).not.toHaveLength(0);
    }
  });

  it("splits the payment apps out of the manual rails", () => {
    // The reason `category` exists beside `kind`: these four settle the same
    // way — the seller confirms them by hand — and a seller reading a list
    // does not think of a PayPal link and a doorstep as one thing.
    for (const type of ["venmo", "paypal"] as const) {
      expect(PAYMENT_METHOD_DEFS[type].kind, type).toBe("manual");
      expect(PAYMENT_METHOD_DEFS[type].category, type).toBe("wallet");
    }
    for (const type of ["bank_transfer", "cod"] as const) {
      expect(PAYMENT_METHOD_DEFS[type].kind, type).toBe("manual");
      expect(PAYMENT_METHOD_DEFS[type].category, type).toBe("manual");
    }
  });

  it("lets the global rails settle any currency", () => {
    // The chat rails, bank transfer and cash carry no amount of their own and
    // name no account we have to be right about, so a currency gate on them
    // would be an invented restriction.
    for (const type of ["whatsapp", "telegram", "instagram", "email", "phone", "bank_transfer", "cod", "card"]) {
      expect(isRailAvailable(type, "JOD")).toBe(true);
      expect(isRailAvailable(type, "USD")).toBe(true);
    }
  });

  it("holds Venmo to dollars", () => {
    // Venmo reads a bare number as USD. A shop pricing in euros would send a
    // buyer to pay 45.50 dollars for a 45.50 euro order.
    expect(isRailAvailable("venmo", "USD")).toBe(true);
    expect(isRailAvailable("venmo", "EUR")).toBe(false);
    expect(isRailAvailable("venmo", "usd")).toBe(true);
  });

  it("holds PayPal to the currencies PayPal actually takes", () => {
    expect(isRailAvailable("paypal", "EUR")).toBe(true);
    expect(isRailAvailable("paypal", "GBP")).toBe(true);
    // Three-decimal Gulf currencies are on none of PayPal's lists.
    expect(isRailAvailable("paypal", "JOD")).toBe(false);
    expect(isRailAvailable("paypal", "KWD")).toBe(false);
    // PayPal takes no decimals on these two and Sailo stores them at two, so
    // the link would name an amount PayPal refuses.
    expect(isRailAvailable("paypal", "HUF")).toBe(false);
    expect(isRailAvailable("paypal", "TWD")).toBe(false);
  });

  it("stops offering a rail when the shop's currency moves out from under it", () => {
    // Nothing re-validates a saved rail when the seller changes currency, so
    // the check has to live where the storefront and the order action both
    // ask — otherwise a fully configured Venmo keeps taking euro orders.
    const config = cfg({ venmoHandle: "clayandco" });
    expect(isRailUsable("venmo", config, { ...STRIPE_LIVE, currency: "USD" })).toBe(true);
    expect(isRailUsable("venmo", config, { ...STRIPE_LIVE, currency: "EUR" })).toBe(false);
  });

  it("recognises only the rails it defines", () => {
    expect(isPaymentMethodType("card")).toBe(true);
    expect(isPaymentMethodType("bitcoin")).toBe(false);
    expect(isPaymentMethodType("")).toBe(false);
  });

  it("treats card as the rail that settles itself", () => {
    // Electronic rails confirm their own payment, so the seller is never asked
    // to mark them paid. Getting this wrong shows a pointless button, or hides
    // a necessary one.
    expect(isElectronic("card")).toBe(true);
    expect(isElectronic("whatsapp")).toBe(false);
    expect(isElectronic("nonsense")).toBe(false);
  });
});

describe("isConfigured", () => {
  it("is false for a rail nobody has filled in", () => {
    expect(isConfigured("whatsapp", cfg())).toBe(false);
  });

  it("treats a whitespace-only answer as unfilled", () => {
    // " " in a phone field would otherwise offer a rail that reaches no one.
    expect(isConfigured("whatsapp", cfg({ phone: "   " }))).toBe(false);
  });

  it("is true once every required field has a value", () => {
    const required = PAYMENT_METHOD_DEFS.whatsapp.fields.filter((f) => f.required);
    const filled = Object.fromEntries(required.map((f) => [f.key, "+15551234567"]));
    expect(isConfigured("whatsapp", cfg(filled))).toBe(true);
  });

  it("is false for a rail that does not exist", () => {
    expect(isConfigured("bitcoin", cfg({ anything: "x" }))).toBe(false);
  });
});

describe("isRailUsable", () => {
  it("judges card on Stripe, not on the config fields", () => {
    /*
     * Card has no fields for the seller to fill — it is usable exactly when
     * Stripe says the account can take charges. Reading the config here would
     * offer card to a shop that never finished onboarding.
     */
    expect(isRailUsable("card", cfg(), STRIPE_LIVE)).toBe(true);
    expect(isRailUsable("card", cfg(), NO_STRIPE)).toBe(false);
  });

  it("refuses card while the account is still being verified", () => {
    // Connected but not yet enabled: a charge would be rejected at Stripe.
    expect(
      isRailUsable("card", cfg(), {
        stripeAccountId: "acct_1",
        stripeChargesEnabled: false,
        currency: "USD",
      }),
    ).toBe(false);
  });

  it("judges every other rail on whether the seller filled it in", () => {
    expect(isRailUsable("whatsapp", cfg(), STRIPE_LIVE)).toBe(false);
    expect(
      isRailUsable("whatsapp", cfg({ phone: "+15551234567" }), NO_STRIPE),
    ).toBe(true);
  });

  it("refuses a rail that does not exist, whatever the shop's state", () => {
    expect(isRailUsable("bitcoin", cfg({ phone: "x" }), STRIPE_LIVE)).toBe(false);
  });
});

describe("the card rail's description", () => {
  /*
   * This string is shown to sellers on the payments screen, and it once said
   * "1%" while `platformFeeCents` charged half that — so every seller reading
   * it was quoted double what they were billed. It now interpolates
   * `PLATFORM_FEE_LABEL` rather than writing the number out, and these two
   * assertions are what stop it drifting apart again.
   */
  it("quotes the fee the code actually charges", async () => {
    const { PLATFORM_FEE_LABEL } = await import("@sailo/core/plans");
    expect(PAYMENT_METHOD_DEFS.card.description).toContain(PLATFORM_FEE_LABEL);
  });

  it("does not write the fee out by hand", async () => {
    /*
     * The label is imported rather than typed out. Spelling the current rate
     * here made this guard need editing every time the rate moved — and a
     * drift check that has to be hand-edited to stay green is one somebody
     * eventually edits without reading, which is the failure it exists to
     * prevent.
     */
    const { PLATFORM_FEE_LABEL } = await import("@sailo/core/plans");
    const withoutLabel = PAYMENT_METHOD_DEFS.card.description.replace(
      PLATFORM_FEE_LABEL,
      "",
    );
    expect(withoutLabel).not.toMatch(/\d+(\.\d+)?\s?%/);
  });
});

describe("the rails an order can use", () => {
  /*
   * A shop enables cash on delivery once, for the mug. Nothing then took it
   * off the instant download's checkout, so a buyer of a file that unlocks on
   * order was offered a rail whose whole promise is collecting cash in person
   * — after the file was already gone.
   */
  const ALL = [
    { type: "whatsapp" },
    { type: "cod" },
    { type: "bank_transfer" },
  ];

  it("offers every rail when the order can be paid for in person", () => {
    expect(railsForOrder(ALL, true).map((m) => m.type)).toEqual([
      "whatsapp",
      "cod",
      "bank_transfer",
    ]);
  });

  it("withdraws cash on delivery when it can't be collected in person", () => {
    expect(railsForOrder(ALL, false).map((m) => m.type)).toEqual([
      "whatsapp",
      "bank_transfer",
    ]);
  });

  it("leaves a shop with no rails at all rather than a pay-in-person one", () => {
    // A shop whose only rail is cash on delivery genuinely cannot sell an
    // instant download. Saying so is the honest answer; the buy button reads
    // "unavailable" rather than opening a sheet with nothing in it.
    expect(railsForOrder([{ type: "cod" }], false)).toEqual([]);
  });

  it("keeps a rail it doesn't recognise", () => {
    // An unknown type is a row from a newer version of the app, not a
    // pay-in-person rail — dropping it would hide a working payment option.
    expect(railsForOrder([{ type: "bitcoin" }], false)).toHaveLength(1);
  });

  it("copies rather than hands back the caller's array", () => {
    const methods = [{ type: "whatsapp" }];
    expect(railsForOrder(methods, true)).not.toBe(methods);
  });

  it("marks exactly one rail as pay-in-person", () => {
    // If a second rail ever earns the flag this test should be updated
    // deliberately, not discovered by a buyer who can't check out.
    const needy = PAYMENT_METHOD_TYPES.filter(
      (t) => PAYMENT_METHOD_DEFS[t].payInPerson,
    );
    expect(needy).toEqual(["cod"]);
  });
});
