import { describe, expect, it } from "vitest";
import { LIFECYCLE_STEP_IDS } from "./steps";
import type { LifecycleShop, LifecycleState } from "./state";
import { LEGAL } from "@sailo/core/legal";
import { lifecycleMessage } from "./messages";

/**
 * What every lifecycle email must carry, asserted across all of them at once.
 *
 * Written as a loop over `LIFECYCLE_STEP_IDS` rather than as a test per rung
 * on purpose: the failure this guards against is a *new* rung being added
 * without the footer, the text part or the header that the law and the
 * mailbox providers require. A test that names each rung individually is a
 * test somebody forgets to extend; this one fails the moment the ladder grows
 * and the copy does not keep up.
 */

const ONE_CLICK = "https://sailo.store/api/unsubscribe/marketing/tok";
const PAGE = "https://sailo.store/u/marketing/tok";

const shop = (over: Partial<LifecycleShop> = {}): LifecycleShop => ({
  id: "shop-1",
  handle: "forno",
  name: "Forno Nove",
  createdAt: new Date("2026-05-01T09:00:00.000Z"),
  plan: "free",
  subscriptionStatus: null,
  compPlan: null,
  avatarUrl: null,
  logoUrl: null,
  socials: [],
  stripeChargesEnabled: false,
  ...over,
});

const state = (over: Partial<LifecycleState> = {}): LifecycleState => ({
  userId: "user-1",
  email: "seller@example.com",
  name: "Amira Haddad",
  emailVerified: true,
  signedUpAt: new Date("2026-04-28T09:00:00.000Z"),
  shop: shop(),
  productCount: 3,
  firstProductAt: new Date("2026-05-02T09:00:00.000Z"),
  railCount: 1,
  orderCount: 4,
  firstOrderAt: new Date("2026-05-10T09:00:00.000Z"),
  sent: new Set<string>(),
  lastLifecycleAt: null,
  ...over,
});

const build = (over: Partial<LifecycleState> = {}) =>
  LIFECYCLE_STEP_IDS.map((step) => ({
    step,
    message: lifecycleMessage({
      step,
      state: state(over),
      oneClickUrl: ONE_CLICK,
      pageUrl: PAGE,
    }),
  }));

describe("every lifecycle email", () => {
  it("says something in the subject, the body and the preview line", () => {
    for (const { step, message } of build()) {
      expect(message.subject.trim(), step).not.toBe("");
      expect(message.html.length, step).toBeGreaterThan(400);
      expect(message.text?.trim(), step).not.toBe("");
    }
  });

  it("comes from the marketing address, not the one that carries sign-ins", () => {
    /*
     * The separation is the point. Mailbox providers score reputation per
     * sending address, and marketing is the traffic that earns complaints —
     * keeping it off `accounts@` means a bad campaign cannot land a seller's
     * password reset in spam.
     */
    for (const { step, message } of build()) {
      expect(message.from, step).toContain("marketing@");
      expect(message.from, step).not.toContain("accounts@");
    }
  });

  it("carries a working unsubscribe, in the footer and in the header", () => {
    for (const { step, message } of build()) {
      expect(message.html, step).toContain(PAGE);
      expect(message.text, step).toContain(PAGE);
      expect(message.headers?.["List-Unsubscribe"], step).toBe(`<${ONE_CLICK}>`);
      expect(message.headers?.["List-Unsubscribe-Post"], step).toBe(
        "List-Unsubscribe=One-Click",
      );
    }
  });

  it("carries the postal address CAN-SPAM requires on commercial mail", () => {
    for (const { step, message } of build()) {
      expect(message.html, step).toContain(LEGAL.street);
      expect(message.html, step).toContain(LEGAL.city);
    }
  });

  it("promises that order and account mail keeps arriving", () => {
    // The sentence that decides whether somebody clicks unsubscribe or
    // reaches for "report spam" instead. Both parts must say it.
    for (const { step, message } of build()) {
      expect(message.html.toLowerCase(), step).toContain("keep arriving");
      expect(message.text?.toLowerCase(), step).toContain("keep arriving");
    }
  });
});

describe("what a seller typed cannot become markup", () => {
  const hostile = {
    name: '<script>alert("x")</script>',
    shop: shop({ name: 'Bob & Sons "Bakery" <b>' }),
  };

  it("escapes the name and the shop name in every rung", () => {
    for (const { step, message } of build(hostile)) {
      expect(message.html, step).not.toContain("<script>");
      expect(message.html, step).not.toContain('"Bakery" <b>');
    }
  });

  it("leaves the plain-text part plain", () => {
    // No escaping here, and none wanted — a text part is not markup. This
    // only asserts it is present, so a future refactor cannot quietly drop it
    // and leave the mail scored as bulk by every provider that looks.
    for (const { step, message } of build(hostile)) {
      expect(message.text, step).toBeTruthy();
    }
  });
});

describe("the rungs that name a number", () => {
  it("counts products and orders as they actually stand", () => {
    const many = lifecycleMessage({
      step: "no_rail",
      state: state({ productCount: 4, railCount: 0 }),
      oneClickUrl: ONE_CLICK,
      pageUrl: PAGE,
    });
    expect(many.html).toContain("4 products");

    const one = lifecycleMessage({
      step: "no_rail",
      state: state({ productCount: 1, railCount: 0 }),
      oneClickUrl: ONE_CLICK,
      pageUrl: PAGE,
    });
    expect(one.html).toContain("1 product up");
  });

  it("puts the seller's own link in the mail that exists to carry it", () => {
    const live = lifecycleMessage({
      step: "shop_live",
      state: state({ shop: shop({ handle: "forno" }) }),
      oneClickUrl: ONE_CLICK,
      pageUrl: PAGE,
    });
    expect(live.html).toContain("/forno");
    expect(live.text).toContain("/forno");
  });
});

describe("the catch-up rung", () => {
  const catchUp = (over: Partial<LifecycleState>) =>
    lifecycleMessage({
      step: "catch_up",
      state: state(over),
      oneClickUrl: ONE_CLICK,
      pageUrl: PAGE,
    });

  it("names where the seller actually stopped rather than a generic welcome", () => {
    const noShop = catchUp({ shop: null, productCount: 0, orderCount: 0 });
    expect(noShop.subject.toLowerCase()).toContain("account");

    const noProduct = catchUp({ productCount: 0, orderCount: 0 });
    expect(noProduct.html.toLowerCase()).toContain("nothing");

    const noRail = catchUp({ railCount: 0, orderCount: 0 });
    expect(noRail.subject.toLowerCase()).toContain("pay");

    const noOrders = catchUp({ orderCount: 0 });
    expect(noOrders.subject.toLowerCase()).toContain("ready");
  });

  it("still carries the footer when there is no shop to name", () => {
    const message = catchUp({ shop: null, productCount: 0, orderCount: 0 });
    expect(message.html).toContain(PAGE);
    expect(message.html).toContain(LEGAL.street);
  });
});
