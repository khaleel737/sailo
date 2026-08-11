import { describe, expect, it } from "vitest";
import type { PaymentConfig } from "@/db/schema";
import {
  isConfigured,
  isElectronic,
  isPaymentMethodType,
  isRailUsable,
  PAYMENT_METHOD_DEFS,
  PAYMENT_METHOD_TYPES,
  railsForOrder,
} from "./rails";

/**
 * Whether a shop can actually take money through a rail.
 *
 * Both directions cost something real: offering a rail that isn't set up
 * strands a buyer who picks it, and hiding one that is loses the sale.
 */

const NO_STRIPE = { stripeAccountId: null, stripeChargesEnabled: false };
const STRIPE_LIVE = { stripeAccountId: "acct_1", stripeChargesEnabled: true };
const cfg = (o: Record<string, string> = {}) => o as PaymentConfig;

describe("the rail catalogue", () => {
  it("defines every rail it lists", () => {
    // A listed rail with no definition would crash the picker that renders it.
    for (const type of PAYMENT_METHOD_TYPES) {
      expect(PAYMENT_METHOD_DEFS[type]).toBeTruthy();
      expect(PAYMENT_METHOD_DEFS[type].kind).toBeTruthy();
    }
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
    const { PLATFORM_FEE_LABEL } = await import("@/lib/plans");
    expect(PAYMENT_METHOD_DEFS.card.description).toContain(PLATFORM_FEE_LABEL);
  });

  it("does not write the fee out by hand", () => {
    const withoutLabel = PAYMENT_METHOD_DEFS.card.description.replace("0.5%", "");
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
