import { describe, expect, it } from "vitest";
import {
  canReceiveTransfer,
  crossBorderBlocked,
  partnerConnectState,
  serviceAgreementFor,
} from "./connect";

/**
 * The rules Stripe enforces on partner payout accounts.
 *
 * Every case here is one `npm run check:partners` proved against the live API,
 * pinned so a refactor cannot quietly undo it. The first block especially: the
 * original implementation sent `recipient` unconditionally, which Stripe
 * refuses for a domestic account — it would have broken onboarding for every
 * partner in our own country, which is most of them.
 */

describe("serviceAgreementFor", () => {
  /*
   * The bug, pinned. "The recipient ToS agreement is not supported for
   * platforms in US creating accounts in US" — verified against the live API.
   */
  it("sends NO agreement for a partner in our own country", () => {
    expect(serviceAgreementFor("US", "US")).toBeNull();
    expect(serviceAgreementFor("GB", "GB")).toBeNull();
    // Case is not something a form can be trusted to get right.
    expect(serviceAgreementFor("us", "US")).toBeNull();
    expect(serviceAgreementFor("US", "us")).toBeNull();
  });

  it("sends `recipient` for a partner abroad", () => {
    expect(serviceAgreementFor("GB", "US")).toBe("recipient");
    expect(serviceAgreementFor("DE", "US")).toBe("recipient");
    expect(serviceAgreementFor("US", "GB")).toBe("recipient");
  });

  /*
   * Unknown either side means "let Stripe decide". Guessing `recipient` here
   * would reintroduce exactly the failure above; guessing nothing is the
   * choice that still works for the common case.
   */
  it("sends nothing when either country is unknown", () => {
    expect(serviceAgreementFor(null, "US")).toBeNull();
    expect(serviceAgreementFor("US", null)).toBeNull();
    expect(serviceAgreementFor(null, null)).toBeNull();
  });
});

describe("crossBorderBlocked", () => {
  it("never blocks a partner in our own country", () => {
    expect(crossBorderBlocked("US", "US")).toBe(false);
    expect(crossBorderBlocked("MY", "MY")).toBe(false);
  });

  /*
   * Stripe supports cross-border transfers between the US, Canada, the UK, the
   * EEA and Switzerland. Inside that set we can pay across a border.
   */
  it("allows transfers inside the supported zone", () => {
    expect(crossBorderBlocked("GB", "US")).toBe(false);
    expect(crossBorderBlocked("DE", "US")).toBe(false);
    expect(crossBorderBlocked("CH", "FR")).toBe(false);
    expect(crossBorderBlocked("CA", "GB")).toBe(false);
  });

  /*
   * Outside it, the platform and the account must share a country. Catching
   * this at onboarding is the whole point — the alternative is a partner
   * completing a long form and being told at their first payout that it was
   * never going to work.
   */
  it("blocks a transfer Stripe would refuse", () => {
    expect(crossBorderBlocked("MY", "US")).toBe(true);
    expect(crossBorderBlocked("SG", "US")).toBe(true);
    expect(crossBorderBlocked("AU", "GB")).toBe(true);
    expect(crossBorderBlocked("US", "BR")).toBe(true);
  });

  it("defers to Stripe when either country is unknown", () => {
    expect(crossBorderBlocked(null, "US")).toBe(false);
    expect(crossBorderBlocked("MY", null)).toBe(false);
  });
});

/**
 * The columns both `canReceiveTransfer` and `partnerConnectState` read.
 *
 * Spelled out rather than derived from either signature: the two take
 * overlapping-but-different shapes, and a helper typed from one of them cannot
 * build a fixture for the other.
 */
type PartnerAccount = {
  status: string;
  stripeAccountId: string | null;
  stripeTransfersEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeAccountCountry: string | null;
};

const account = (over: Partial<PartnerAccount> = {}): PartnerAccount => ({
  status: "approved",
  stripeAccountId: "acct_123",
  stripeTransfersEnabled: true,
  stripeDetailsSubmitted: true,
  stripeAccountCountry: "US",
  ...over,
});

describe("canReceiveTransfer", () => {
  it("accepts an approved, verified, in-zone partner", () => {
    expect(canReceiveTransfer(account())).toBe(true);
  });

  /*
   * Each of these is a partner the payouts page must show as owed-but-blocked
   * rather than silently attempt and fail on. The transfer would be refused by
   * Stripe in every case; refusing it here is what turns a failed payout into
   * a support conversation.
   */
  it("refuses every partner Stripe would refuse", () => {
    expect(canReceiveTransfer(account({ status: "suspended" }))).toBe(false);
    expect(canReceiveTransfer(account({ status: "pending" }))).toBe(false);
    expect(canReceiveTransfer(account({ stripeAccountId: null }))).toBe(false);
    expect(canReceiveTransfer(account({ stripeTransfersEnabled: false }))).toBe(
      false,
    );
  });

  /*
   * A suspended partner with a perfectly good Stripe account is the case worth
   * naming: nothing about Stripe stops this transfer, and we must.
   */
  it("refuses a suspended partner whose Stripe account is fine", () => {
    expect(
      canReceiveTransfer(
        account({ status: "suspended", stripeTransfersEnabled: true }),
      ),
    ).toBe(false);
  });
});

describe("partnerConnectState", () => {
  it("reports each stage of onboarding distinctly", () => {
    expect(partnerConnectState(account({ stripeAccountId: null }))).toBe(
      "not_connected",
    );
    expect(partnerConnectState(account({ stripeDetailsSubmitted: false }))).toBe(
      "onboarding",
    );
    expect(partnerConnectState(account({ stripeTransfersEnabled: false }))).toBe(
      "verifying",
    );
    expect(partnerConnectState(account())).toBe("active");
  });

  /*
   * "Verifying" and "not connected" look similar and mean completely different
   * things to somebody sitting on a balance, which is why they are separate
   * states rather than one "not ready".
   */
  it("distinguishes an unfinished form from a pending verification", () => {
    expect(
      partnerConnectState(
        account({ stripeDetailsSubmitted: false, stripeTransfersEnabled: false }),
      ),
    ).toBe("onboarding");
    expect(
      partnerConnectState(
        account({ stripeDetailsSubmitted: true, stripeTransfersEnabled: false }),
      ),
    ).toBe("verifying");
  });
});
