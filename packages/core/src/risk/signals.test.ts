import { describe, expect, it } from "vitest";
import {
  assessRisk,
  CHARGEBACK_ACT_BP,
  CHARGEBACK_MIN_ORDERS,
  isLouder,
  RISK_KINDS,
  worstSeverity,
  type RiskInput,
} from "./signals";

/**
 * The ladder, asserted case by case.
 *
 * Two properties matter more than any individual threshold and are tested
 * hardest: that an ordinary shop having an ordinary bad month produces
 * *nothing*, and that no signal reaches `act` on a number that could plausibly
 * belong to an honest business. A risk queue that fires on the healthy majority
 * is a queue nobody reads, and every finding after that one is wasted.
 */

/** A shop with nothing wrong with it. Every case below starts here. */
const CLEAN: RiskInput = {
  chargebackBp: 0,
  settledOrders: 400,
  openDisputes: 0,
  openDisputeCents: 0,
  undeliveredPaidOrders: 0,
  undeliveredPaidCents: 0,
  refundBp: 0,
  recentCents: 200_000,
  priorCents: 180_000,
  ageDays: 400,
  restricted: "clear",
  restrictedTerms: [],
  priorClosures: 0,
  priorClosuresUnderSuspicion: 0,
  twoFactorEnabled: true,
  chargesEnabled: true,
  grossCents: 5_000_000,
  currency: "USD",
  // Healthy mail: real volume, nothing complained, one stray bounce.
  emailSent30d: 800,
  emailComplaints30d: 0,
  emailBounces30d: 1,
  marketingPaused: false,
};

const shop = (overrides: Partial<RiskInput>): RiskInput => ({ ...CLEAN, ...overrides });
const kinds = (input: RiskInput) => assessRisk(input).map((s) => s.kind);

describe("a shop with nothing wrong with it", () => {
  it("produces no signals at all", () => {
    expect(assessRisk(CLEAN)).toEqual([]);
    expect(worstSeverity(assessRisk(CLEAN))).toBeNull();
  });

  it("stays silent through an ordinary bad month", () => {
    /*
     * The single most important case in this file. Every number here is one a
     * real shop has on a bad month: a couple of chargebacks, a tenth of sales
     * refunded, a slow fortnight followed by a good week. None of it is a
     * finding, and a ladder that says otherwise is a ladder that gets ignored.
     */
    const rough = shop({
      chargebackBp: 50,
      refundBp: 1_000,
      recentCents: 400_000,
      priorCents: 150_000,
      undeliveredPaidOrders: 3,
      undeliveredPaidCents: 12_000,
    });
    expect(assessRisk(rough)).toEqual([]);
  });
});

describe("chargebacks", () => {
  it("does not compute a rate from too few orders", () => {
    /*
     * One chargeback in three settled orders is 3,333bp and means nothing. A
     * floor on the denominator is what stops the desk's loudest finding being
     * a shop that has sold four things.
     */
    const tiny = shop({ chargebackBp: 3_333, settledOrders: CHARGEBACK_MIN_ORDERS - 1 });
    expect(kinds(tiny)).not.toContain("chargebacks");
  });

  it("reviews at the network monitoring approach and acts past it", () => {
    expect(assessRisk(shop({ chargebackBp: 80 }))[0]).toMatchObject({
      kind: "chargebacks",
      severity: "review",
    });
    expect(assessRisk(shop({ chargebackBp: CHARGEBACK_ACT_BP }))[0]).toMatchObject({
      kind: "chargebacks",
      severity: "act",
    });
  });

  it("carries the rate as evidence, so a cleared flag knows what worse means", () => {
    const [signal] = assessRisk(shop({ chargebackBp: 120 }));
    expect(signal?.evidence).toBe("120");
  });
});

describe("money taken for nothing", () => {
  it("ignores a handful, which is a lapse rather than a pattern", () => {
    expect(kinds(shop({ undeliveredPaidOrders: 4, undeliveredPaidCents: 20_000 }))).not.toContain(
      "undelivered",
    );
  });

  it("acts on a large count", () => {
    const signal = assessRisk(
      shop({ undeliveredPaidOrders: 20, undeliveredPaidCents: 60_000 }),
    )[0];
    expect(signal).toMatchObject({ kind: "undelivered", severity: "act" });
  });

  it("acts on a small count holding a lot of somebody else's money", () => {
    /*
     * Six orders is a shrug and £3,000 of other people's money is not, so the
     * amount has to be able to escalate on its own. This is the shape of the
     * high-value scam — few buyers, large deposits — that a count-only rule
     * would file as `review` and leave for the morning.
     */
    const signal = assessRisk(
      shop({ undeliveredPaidOrders: 6, undeliveredPaidCents: 300_000 }),
    )[0];
    expect(signal).toMatchObject({ kind: "undelivered", severity: "act" });
  });

  it("says so when the shop is also brand new", () => {
    const [signal] = assessRisk(
      shop({ undeliveredPaidOrders: 8, undeliveredPaidCents: 40_000, ageDays: 9 }),
    );
    expect(signal?.summary).toContain("9 days old");
  });
});

describe("refunds", () => {
  it("never reaches act, however high", () => {
    /*
     * A shop refunding everything is doing right by its buyers. The pattern
     * worth catching — refunding to stay under a chargeback threshold — needs
     * somebody to read the orders, and a button that closes a shop for being
     * generous would be the worst false positive this desk could produce.
     */
    const signal = assessRisk(shop({ refundBp: 9_000 }))[0];
    expect(signal?.kind).toBe("refunds");
    expect(signal?.severity).not.toBe("act");
  });

  it("stays quiet on a shop too small for a ratio to mean anything", () => {
    expect(kinds(shop({ refundBp: 9_000, grossCents: 4_000 }))).not.toContain("refunds");
  });

  it("escalates from watch to review as the share climbs", () => {
    // The two rungs it does have, so a rename cannot quietly collapse them.
    expect(assessRisk(shop({ refundBp: 3_000 }))[0]?.severity).toBe("watch");
    expect(assessRisk(shop({ refundBp: 5_000 }))[0]?.severity).toBe("review");
  });
});

describe("velocity", () => {
  it("fires on a step change, and only as a watch", () => {
    const signal = assessRisk(shop({ recentCents: 2_000_000, priorCents: 200_000 }))[0];
    expect(signal).toMatchObject({ kind: "velocity", severity: "watch" });
  });

  it("ignores a shop too young to have a normal week", () => {
    /*
     * Every new shop's first real week is infinitely more than the zero before
     * it. Without an age floor this fires on every successful launch on the
     * platform, which is precisely the population nobody wants to interrupt.
     */
    expect(
      kinds(shop({ ageDays: 5, recentCents: 2_000_000, priorCents: 200_000 })),
    ).not.toContain("velocity");
  });

  it("ignores small absolute numbers however large the multiple", () => {
    expect(
      kinds(shop({ recentCents: 60_000, priorCents: 2_000 })),
    ).not.toContain("velocity");
  });
});

describe("a returning owner", () => {
  it("is only a watch when the previous closures were clean", () => {
    /*
     * People close a shop and start a better one. Treating that as a finding
     * would put the platform's most experienced sellers at the top of the risk
     * queue for the crime of having tried something before.
     */
    const signal = assessRisk(shop({ priorClosures: 2 }))[0];
    expect(signal).toMatchObject({ kind: "returning_closure", severity: "watch" });
  });

  it("acts when a previous shop closed with buyers or a bank still owed", () => {
    const signal = assessRisk(
      shop({ priorClosures: 2, priorClosuresUnderSuspicion: 1 }),
    )[0];
    expect(signal).toMatchObject({ kind: "returning_closure", severity: "act" });
    expect(signal?.summary).toContain("still owed");
  });
});

describe("the account's own front door", () => {
  /*
   * There was an `unguarded` signal — cards enabled, no second factor — and it
   * was removed after seeing the desk with real data: it fired on nearly every
   * shop and produced fifty-nine identical rows that buried the two findings
   * needing a human. This test is what stops it coming back by reflex.
   *
   * The distinction is the point. Every signal on this desk is about what a
   * seller is doing to other people; a seller with no 2FA is somebody at risk
   * of being robbed, which is `/security`'s job and a mail-merge rather than a
   * queue.
   */
  it("says nothing about a shop with no second factor", () => {
    expect(assessRisk(shop({ twoFactorEnabled: false }))).toEqual([]);
  });

  it("still reads the guards as context for the findings that do fire", () => {
    // Removing the signal must not have removed the inputs: a shop taking
    // cards is one where the other findings cost real money.
    const taking = assessRisk(
      shop({ twoFactorEnabled: false, chargesEnabled: true, chargebackBp: 150 }),
    );
    expect(taking.map((s) => s.kind)).toEqual(["chargebacks"]);
  });
});

describe("ordering and summary", () => {
  it("puts the loudest finding first", () => {
    const signals = assessRisk(
      shop({
        priorClosures: 2, // watch
        refundBp: 5_000, // review
        chargebackBp: 150, // act
      }),
    );
    expect(signals.map((s) => s.severity)).toEqual(["act", "review", "watch"]);
    expect(worstSeverity(signals)).toBe("act");
  });

  it("only ever emits kinds the vocabulary declares", () => {
    // The `kind` goes straight into a text column that the desk filters on.
    const everything = assessRisk(
      shop({
        chargebackBp: 200,
        undeliveredPaidOrders: 30,
        undeliveredPaidCents: 900_000,
        refundBp: 5_000,
        recentCents: 5_000_000,
        priorCents: 100_000,
        restricted: "refuse",
        restrictedTerms: ["casino"],
        priorClosures: 1,
        priorClosuresUnderSuspicion: 1,
        twoFactorEnabled: false,
      }),
    );
    expect(everything.length).toBeGreaterThan(4);
    for (const signal of everything) {
      expect(RISK_KINDS).toContain(signal.kind);
    }
  });

  it("never produces `manual`, which only a human can raise", () => {
    const everything = assessRisk(
      shop({ chargebackBp: 500, undeliveredPaidOrders: 40, undeliveredPaidCents: 900_000 }),
    );
    expect(everything.map((s) => s.kind)).not.toContain("manual");
  });
});

describe("isLouder", () => {
  it("orders the three severities", () => {
    expect(isLouder("act", "review")).toBe(true);
    expect(isLouder("review", "watch")).toBe(true);
    expect(isLouder("watch", "act")).toBe(false);
    // Equal is not louder: re-raising a cleared flag at the same level is what
    // makes a dismissed finding come back every morning.
    expect(isLouder("review", "review")).toBe(false);
  });
});

describe("email reputation", () => {
  it("says nothing about healthy mail", () => {
    // CLEAN sends 800 with one bounce — an ordinary shop's ordinary month.
    expect(kinds(CLEAN)).not.toContain("email_reputation");
  });

  it("puts an automatic pause in front of a person, as review", () => {
    const signals = assessRisk(
      shop({ marketingPaused: true, emailSent30d: 500, emailComplaints30d: 3 }),
    );
    const signal = signals.find((s) => s.kind === "email_reputation");
    expect(signal?.severity).toBe("review");
    expect(signal?.summary).toContain("paused automatically");
  });

  it("warns at half the pause threshold, with the volume floor honoured", () => {
    // 1 complaint over 1,000 sends is 0.1% — the pause line; half is 0.05%.
    expect(
      kinds(shop({ emailSent30d: 1_000, emailComplaints30d: 1 })),
    ).toContain("email_reputation");
    // The same complaint over 99 sends is an accident, not a rate.
    expect(
      kinds(shop({ emailSent30d: 99, emailComplaints30d: 1 })),
    ).not.toContain("email_reputation");
  });

  it("never reaches act on its own — the pause already contains the damage", () => {
    const signals = assessRisk(
      shop({ marketingPaused: true, emailSent30d: 5_000, emailComplaints30d: 50 }),
    );
    const signal = signals.find((s) => s.kind === "email_reputation");
    expect(signal?.severity).toBe("review");
  });
});
