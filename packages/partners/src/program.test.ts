import { describe, expect, it } from "vitest";
import {
  canEarn,
  commissionCents,
  DEFAULT_COMMISSION_BP,
  DEFAULT_HOLD_DAYS,
  DEFAULT_PAYOUT_MINIMUM_CENTS,
  isPartnerStatus,
  isPayableBalance,
  ledgerCurrency,
  maturityDate,
  newReferralCode,
  normalizeReferralCode,
  partnerBalance,
  REFERRAL_CODE_LENGTH,
  referralUrl,
  resolveCommissionBp,
  shareLabel,
  type LedgerRow,
} from "./program";

describe("newReferralCode", () => {
  it("mints codes of the advertised length", () => {
    for (let i = 0; i < 50; i++) {
      expect(newReferralCode()).toHaveLength(REFERRAL_CODE_LENGTH);
    }
  });

  it("never mints a character a reader could transcribe two ways", () => {
    // 0/O and 1/I/L are the pairs that get retyped wrong out of a DM.
    for (let i = 0; i < 200; i++) {
      expect(newReferralCode()).not.toMatch(/[01OIL]/);
    }
  });

  it("mints codes its own normaliser accepts", () => {
    // The round trip is the thing: a mint that produced a code the public
    // route rejects would be a referral link that silently never attributes.
    for (let i = 0; i < 100; i++) {
      const code = newReferralCode();
      expect(normalizeReferralCode(code)).toBe(code);
    }
  });
});

describe("normalizeReferralCode", () => {
  it("folds case and trims, because links get copied with whitespace", () => {
    expect(normalizeReferralCode("  abcdefgh  ")).toBe("ABCDEFGH");
  });

  it("refuses anything that is not eight symbols of the alphabet", () => {
    for (const bad of [
      "",
      "ABC",
      "ABCDEFGHI",
      // Excluded from the alphabet, so no real code contains them.
      "ABCDEFG0",
      "ABCDEFGO",
      "ABCDEFG1",
      "ABCDEFGI",
      "ABCDEFGL",
    ]) {
      expect(normalizeReferralCode(bad)).toBeNull();
    }
  });

  /*
   * The whole reason this returns null instead of a cleaned string: `/r/<code>`
   * is public and unauthenticated, and this is the only thing between the path
   * segment and a database lookup.
   */
  it("refuses injection and traversal shapes outright", () => {
    for (const hostile of [
      "' OR 1=1",
      "../../etc",
      "<script>",
      "%00ABCDEF",
      "ABCDEF%20",
      " ABCDEFG",
    ]) {
      expect(normalizeReferralCode(hostile)).toBeNull();
    }
  });
});

describe("referralUrl", () => {
  it("builds the link from the code and the app origin", () => {
    expect(referralUrl("ABCDEFGH", "https://sailo.store")).toBe(
      "https://sailo.store/r/ABCDEFGH",
    );
  });
});

describe("canEarn", () => {
  /*
   * The case worth pinning: a partner we stopped must stop earning. Their
   * links are already posted and will keep being clicked forever.
   */
  it("lets only approved partners attribute and earn", () => {
    expect(canEarn("approved")).toBe(true);
    for (const status of ["pending", "rejected", "suspended", "nonsense"]) {
      expect(canEarn(status)).toBe(false);
    }
  });

  it("recognises exactly the four real statuses", () => {
    for (const status of ["pending", "approved", "rejected", "suspended"]) {
      expect(isPartnerStatus(status)).toBe(true);
    }
    expect(isPartnerStatus("banned")).toBe(false);
  });
});

describe("resolveCommissionBp", () => {
  it("falls back to the programme default", () => {
    expect(resolveCommissionBp(null, DEFAULT_COMMISSION_BP)).toBe(3000);
    expect(resolveCommissionBp(undefined, 2500)).toBe(2500);
  });

  it("lets a negotiated rate win", () => {
    expect(resolveCommissionBp(4000, DEFAULT_COMMISSION_BP)).toBe(4000);
  });

  /*
   * The reason the override is checked with `??` rather than for truthiness:
   * a deliberate 0% is a real arrangement — a partner kept on the books but
   * earning nothing — and must not silently fall through to 30%.
   */
  it("treats a zero override as a real rate, not a missing one", () => {
    expect(resolveCommissionBp(0, DEFAULT_COMMISSION_BP)).toBe(0);
  });
});

describe("commissionCents", () => {
  it("takes 30% of the invoice at the default rate", () => {
    const bp = DEFAULT_COMMISSION_BP;
    expect(commissionCents(999, bp)).toBe(299); // Pro monthly → $3.00-ish
    expect(commissionCents(1999, bp)).toBe(599); // Business monthly
    expect(commissionCents(19190, bp)).toBe(5757); // Business yearly
  });

  it("says the rate in the copy and in the code with one number", () => {
    expect(shareLabel(DEFAULT_COMMISSION_BP)).toBe("30%");
    expect(shareLabel(2000)).toBe("20%");
    expect(shareLabel(1750)).toBe("17.5%");
  });

  /*
   * Floored, not rounded. Rounding up on every invoice would eventually pay
   * out more than the share we actually collected.
   */
  it("floors, so payouts can never exceed the share we took in", () => {
    expect(commissionCents(10, 3000)).toBe(3); // 3.0 exactly
    expect(commissionCents(9, 3000)).toBe(2); // 2.7 → 2, not 3
  });

  it("earns nothing from a trial, a zero invoice or a nonsense amount", () => {
    expect(commissionCents(0, 3000)).toBe(0);
    expect(commissionCents(-1999, 3000)).toBe(0);
    expect(commissionCents(Number.NaN, 3000)).toBe(0);
  });

  it("earns nothing at a zero or nonsense rate", () => {
    expect(commissionCents(1999, 0)).toBe(0);
    expect(commissionCents(1999, Number.NaN)).toBe(0);
  });
});

describe("maturityDate", () => {
  it("pushes the earning out by the hold period", () => {
    const earned = new Date("2026-08-11T12:00:00Z");
    expect(maturityDate(earned, DEFAULT_HOLD_DAYS).toISOString()).toBe(
      "2026-09-10T12:00:00.000Z",
    );
  });

  it("matures immediately with no hold, and never goes backwards", () => {
    const earned = new Date("2026-08-11T12:00:00Z");
    expect(maturityDate(earned, 0).getTime()).toBe(earned.getTime());
    // A negative hold is a corrupt setting, not a licence to backdate.
    expect(maturityDate(earned, -30).getTime()).toBe(earned.getTime());
  });

  it("does not mutate the date it was handed", () => {
    const earned = new Date("2026-08-11T12:00:00Z");
    maturityDate(earned, 30);
    expect(earned.toISOString()).toBe("2026-08-11T12:00:00.000Z");
  });
});

const NOW = new Date("2026-08-11T00:00:00Z");
const MATURE = new Date("2026-07-01T00:00:00Z");
const HELD = new Date("2026-09-01T00:00:00Z");

const row = (
  amountCents: number,
  { matureAt = MATURE, paidOutAt = null as Date | null } = {},
): LedgerRow => ({ amountCents, currency: "USD", matureAt, paidOutAt });

describe("partnerBalance", () => {
  it("is zero and unpayable with an empty ledger", () => {
    expect(partnerBalance([], DEFAULT_PAYOUT_MINIMUM_CENTS, NOW)).toEqual({
      lifetimeCents: 0,
      unpaidCents: 0,
      heldCents: 0,
      availableCents: 0,
      paidCents: 0,
      payable: false,
    });
  });

  it("splits paid from unpaid without rewriting either", () => {
    const paidAt = new Date("2026-07-05T00:00:00Z");
    expect(
      partnerBalance(
        [row(1000, { paidOutAt: paidAt }), row(400), row(200)],
        DEFAULT_PAYOUT_MINIMUM_CENTS,
        NOW,
      ),
    ).toMatchObject({
      lifetimeCents: 1600,
      paidCents: 1000,
      unpaidCents: 600,
      availableCents: 600,
      heldCents: 0,
      payable: false,
    });
  });

  /*
   * The hold period, which is the whole point of `matureAt`: money earned
   * this week is owed but not yet sendable, because the invoice behind it can
   * still be refunded.
   */
  it("keeps earnings inside the hold out of the available balance", () => {
    const balance = partnerBalance(
      [row(3000, { matureAt: HELD }), row(1000)],
      DEFAULT_PAYOUT_MINIMUM_CENTS,
      NOW,
    );
    expect(balance).toMatchObject({
      lifetimeCents: 4000,
      unpaidCents: 4000,
      heldCents: 3000,
      availableCents: 1000,
      // $10 available against a $25 minimum, even though $40 is owed.
      payable: false,
    });
  });

  it("releases an earning the moment it matures, not a tick later", () => {
    const exactly = row(DEFAULT_PAYOUT_MINIMUM_CENTS, { matureAt: NOW });
    expect(
      partnerBalance([exactly], DEFAULT_PAYOUT_MINIMUM_CENTS, NOW).payable,
    ).toBe(true);

    const oneMsShort = row(DEFAULT_PAYOUT_MINIMUM_CENTS, {
      matureAt: new Date(NOW.getTime() + 1),
    });
    expect(
      partnerBalance([oneMsShort], DEFAULT_PAYOUT_MINIMUM_CENTS, NOW).payable,
    ).toBe(false);
  });

  /*
   * The boundary, pinned in both directions. The payout run gates on the same
   * predicate the dashboard quotes, so an off-by-one here would show a partner
   * a balance the system refuses to send.
   */
  it("becomes payable exactly at the stated threshold, not above it", () => {
    const min = DEFAULT_PAYOUT_MINIMUM_CENTS;
    expect(partnerBalance([row(min)], min, NOW).payable).toBe(true);
    expect(partnerBalance([row(min - 1)], min, NOW).payable).toBe(false);
    expect(isPayableBalance(min, min)).toBe(true);
    expect(isPayableBalance(min - 1, min)).toBe(false);
    // A balance in the red after a late refund is not payable either.
    expect(isPayableBalance(-1, min)).toBe(false);
  });

  /*
   * A zero minimum is a legal setting, and it must not turn into a monthly
   * run of zero-amount transfers that Stripe rejects one by one.
   */
  it("never calls an empty balance payable, even at a zero minimum", () => {
    expect(isPayableBalance(0, 0)).toBe(false);
    expect(isPayableBalance(1, 0)).toBe(true);
  });

  /*
   * A reversal is a negative row, so a refund takes the money back by being
   * appended — nothing is updated and the earning row stays as evidence.
   */
  it("nets a reversal out of the unpaid balance", () => {
    expect(
      partnerBalance([row(3000), row(-3000)], DEFAULT_PAYOUT_MINIMUM_CENTS, NOW),
    ).toMatchObject({
      lifetimeCents: 0,
      availableCents: 0,
      payable: false,
    });
  });

  /*
   * A reversal must land in the *available* column even when the earning it
   * undoes is still held, or a refund would leave the held balance intact and
   * the available balance untouched — and we would pay out money we had
   * already given back.
   */
  it("nets a matured reversal against a held earning", () => {
    const balance = partnerBalance(
      [row(3000, { matureAt: HELD }), row(-3000)],
      DEFAULT_PAYOUT_MINIMUM_CENTS,
      NOW,
    );
    expect(balance).toMatchObject({
      lifetimeCents: 0,
      unpaidCents: 0,
      heldCents: 3000,
      availableCents: -3000,
      payable: false,
    });
  });

  /*
   * The honest answer when we already paid out and the invoice was then
   * refunded: the partner is overpaid, and the next earning works it off.
   * Clamping to zero here would forgive it silently.
   */
  it("lets the balance go negative when a reversal lands after a payout", () => {
    const paidAt = new Date("2026-07-05T00:00:00Z");
    expect(
      partnerBalance(
        [row(3000, { paidOutAt: paidAt }), row(-3000)],
        DEFAULT_PAYOUT_MINIMUM_CENTS,
        NOW,
      ),
    ).toMatchObject({
      lifetimeCents: 0,
      paidCents: 3000,
      availableCents: -3000,
      payable: false,
    });
  });
});

describe("ledgerCurrency", () => {
  it("reads the currency off the rows rather than assuming one", () => {
    expect(ledgerCurrency([{ currency: "EUR" }])).toBe("EUR");
    expect(ledgerCurrency([])).toBeNull();
  });
});
