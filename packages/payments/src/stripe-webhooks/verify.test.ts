import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signature boundary.
 *
 * Everything downstream of `verifyEvent` treats the event as trusted, so this
 * is the function that earns that trust — and the one place where getting it
 * wrong means acting on a forged request. It had no test of its own while it
 * lived in apps/web; the cases below are new, not moved.
 */

const { constructEvent, parseEventNotification } = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  parseEventNotification: vi.fn(),
}));

vi.mock("../stripe", () => ({
  stripe: () => ({
    webhooks: { constructEvent },
    parseEventNotification,
  }),
}));

const { HANDLED, signingSecrets, verifyEvent } = await import("./verify");

beforeEach(() => {
  constructEvent.mockReset();
  parseEventNotification.mockReset();
});

describe("signingSecrets", () => {
  it("reads a single secret", () => {
    expect(signingSecrets("whsec_a")).toEqual(["whsec_a"]);
  });

  it("splits a comma-separated list, so a rotation has no dead window", () => {
    // Both secrets live at once is the whole point: Stripe is re-signing with
    // the new one while deliveries signed by the old one are still in flight.
    expect(signingSecrets("whsec_old,whsec_new")).toEqual(["whsec_old", "whsec_new"]);
  });

  it("trims the spaces a human leaves after a comma", () => {
    expect(signingSecrets(" whsec_a , whsec_b ")).toEqual(["whsec_a", "whsec_b"]);
  });

  it("drops empty entries rather than trying to verify against them", () => {
    // A trailing comma would otherwise become an empty secret, and an empty
    // secret is a verification attempt that can only fail confusingly.
    expect(signingSecrets("whsec_a,,whsec_b,")).toEqual(["whsec_a", "whsec_b"]);
  });

  it.each([undefined, "", ",", "  "])("has no secrets for %j", (value) => {
    expect(signingSecrets(value)).toEqual([]);
  });
});

describe("verifyEvent", () => {
  const payload = '{"id":"evt_1"}';
  const signature = "t=1,v1=deadbeef";

  it("returns the event when a secret verifies it", () => {
    const event = { id: "evt_1", type: "checkout.session.completed" };
    constructEvent.mockReturnValue(event);

    expect(verifyEvent(payload, signature, ["whsec_a"])).toEqual({ event });
    expect(constructEvent).toHaveBeenCalledWith(payload, signature, "whsec_a");
  });

  it("tries each secret in turn, so the old one still works mid-rotation", () => {
    const event = { id: "evt_1", type: "charge.refunded" };
    constructEvent
      .mockImplementationOnce(() => {
        throw new Error("no match for whsec_old");
      })
      .mockReturnValueOnce(event);

    expect(verifyEvent(payload, signature, ["whsec_old", "whsec_new"])).toEqual({ event });
    expect(constructEvent).toHaveBeenCalledTimes(2);
  });

  it("acknowledges a thin v2 payload instead of rejecting it", () => {
    /*
     * The failure this prevents is not a dropped event but a disabled
     * endpoint: `constructEvent` refuses a notification with no `data.object`,
     * and answering Stripe with a 400 makes it retry for three days and then
     * turn the destination off — taking the working payments down with it.
     */
    constructEvent.mockImplementation(() => {
      throw new Error("No webhook payload was provided");
    });
    parseEventNotification.mockReturnValue({ type: "v1.billing.meter.error" });

    expect(verifyEvent(payload, signature, ["whsec_a"])).toEqual({
      thin: true,
      type: "v1.billing.meter.error",
    });
  });

  it("only reaches for the v2 parser once every secret has failed the v1 one", () => {
    // Order matters: a payload that both parsers accept must come back as a
    // real event, not as a thin notification we would acknowledge and ignore.
    const event = { id: "evt_1", type: "invoice.paid" };
    constructEvent.mockReturnValue(event);
    parseEventNotification.mockReturnValue({ type: "should.not.be.used" });

    expect(verifyEvent(payload, signature, ["whsec_a"])).toEqual({ event });
    expect(parseEventNotification).not.toHaveBeenCalled();
  });

  it("reports the signature failure when nothing verifies", () => {
    constructEvent.mockImplementation(() => {
      throw new Error("signature mismatch");
    });
    parseEventNotification.mockImplementation(() => {
      throw new Error("not thin either");
    });

    expect(verifyEvent(payload, signature, ["whsec_a"])).toEqual({
      error: "signature mismatch",
    });
  });

  it("refuses when no secret is configured, without calling Stripe", () => {
    // An unconfigured endpoint must not fall through to "verified".
    expect(verifyEvent(payload, signature, [])).toEqual({
      error: "no signing secret matched",
    });
    expect(constructEvent).not.toHaveBeenCalled();
    expect(parseEventNotification).not.toHaveBeenCalled();
  });
});

describe("HANDLED", () => {
  it("covers the delayed-notification methods", () => {
    /*
     * Their session completes `unpaid` and the money is confirmed minutes to
     * days later by one of these. Dropping them means every iDEAL, SEPA,
     * Bancontact and Boleto order sticks at "unpaid" forever.
     */
    expect(HANDLED.has("checkout.session.async_payment_succeeded")).toBe(true);
    expect(HANDLED.has("checkout.session.async_payment_failed")).toBe(true);
  });

  it("covers chargebacks, which nothing else reports", () => {
    expect(HANDLED.has("charge.dispute.created")).toBe(true);
    expect(HANDLED.has("charge.dispute.closed")).toBe(true);
  });

  it("covers the invoice that says money actually arrived", () => {
    // `customer.subscription.*` says a plan exists; only this says it was paid,
    // which is what the refer-a-creator ledger accrues on.
    expect(HANDLED.has("invoice.paid")).toBe(true);
  });

  it("ignores an event nobody wired up", () => {
    expect(HANDLED.has("payment_intent.created")).toBe(false);
  });
});
