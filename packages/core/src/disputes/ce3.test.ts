import { describe, expect, it } from "vitest";
import {
  CE3_MAX_AGE_DAYS,
  CE3_MIN_AGE_DAYS,
  buildCe3Submission,
  ce3Capable,
  matchPoints,
  selectPriors,
  type Ce3Candidate,
  type Ce3Identity,
} from "./ce3";

/**
 * Visa Compelling Evidence 3.0, which is arithmetic rather than persuasion.
 *
 * A merchant who can show the same cardholder transacted with them twice before,
 * undisputed, 120–365 days earlier, sharing two identifying data points, wins a
 * 10.4 fraud pre-arbitration outright. It is the only defence against a fraud
 * chargeback that does not depend on convincing anybody, and it is the reason
 * `orders.buyerIp` exists — a data point that is useless on the order carrying
 * it and decides every fraud dispute four months later.
 */

const DISPUTED_AT = new Date("2026-08-17T00:00:00Z");
const DAY = 86_400_000;
const daysBefore = (n: number) => new Date(DISPUTED_AT.getTime() - n * DAY);

const identity = (over: Partial<Ce3Identity> = {}): Ce3Identity => ({
  accountId: null,
  deviceFingerprint: null,
  deviceId: null,
  email: null,
  purchaseIp: null,
  shippingAddress: null,
  ...over,
});

const FULL = identity({
  accountId: "client_7f3a",
  deviceFingerprint: "fp_c4c9a1e2b7d84f60a3b5",
  email: "ada@example.com",
  purchaseIp: "203.0.113.42",
  shippingAddress: "12 Bridge St, Bristol, BS1 4ND, GB",
});

const prior = (over: Partial<Ce3Candidate> = {}): Ce3Candidate => ({
  chargeId: "ch_prior",
  at: daysBefore(200),
  identity: FULL,
  productDescription: "Speckled Mug",
  disputed: false,
  ...over,
});

describe("matchPoints", () => {
  it("matches on the points that are genuinely equal", () => {
    const points = matchPoints(FULL, FULL);
    expect(points).toContain("purchase_ip");
    expect(points).toContain("email");
    expect(points).toContain("device_fingerprint");
  });

  it("does not match two nulls", () => {
    /*
     * The bug this function exists to prevent. `a.purchaseIp === b.purchaseIp`
     * is true when both are null, so a naive comparison of two orders that
     * recorded nothing "matches" on all six points and submits a CE3.0 claim
     * with no basis — which Visa rejects, and which submitted routinely is the
     * kind of thing an acquirer notices.
     */
    expect(matchPoints(identity(), identity())).toEqual([]);
  });

  it("treats 'unknown' as nothing, because that is what callerIp returns", () => {
    /*
     * `ipFromHeaders` returns the literal string "unknown" when no forwarding
     * header is present. Two orders behind a proxy that stripped the header
     * would otherwise match on it.
     */
    const a = identity({ purchaseIp: "unknown", email: "ada@example.com" });
    const b = identity({ purchaseIp: "unknown", email: "ada@example.com" });
    expect(matchPoints(a, b)).toEqual(["email"]);
  });

  it("folds case and whitespace, so one buyer is one buyer", () => {
    const a = identity({ email: "Ada@Example.com ", purchaseIp: "203.0.113.42" });
    const b = identity({ email: "ada@example.com", purchaseIp: "203.0.113.42" });
    expect(matchPoints(a, b).sort()).toEqual(["email", "purchase_ip"]);
  });
});

describe("selectPriors", () => {
  const disputed = { at: DISPUTED_AT, identity: FULL };

  it("qualifies on two matching priors inside the window", () => {
    const result = selectPriors(disputed, [
      prior({ chargeId: "ch_a", at: daysBefore(200) }),
      prior({ chargeId: "ch_b", at: daysBefore(150) }),
    ]);
    expect(result.qualifies).toBe(true);
    if (result.qualifies) {
      expect(result.priors.map((p) => p.chargeId)).toEqual(["ch_a", "ch_b"]);
      expect(result.matched[0]!.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("rejects a prior younger than 120 days, which is the whole basis of the rule", () => {
    /*
     * A relationship has to predate the disputed transaction by four months to
     * be evidence of a relationship.
     */
    const result = selectPriors(disputed, [
      prior({ at: daysBefore(CE3_MIN_AGE_DAYS - 1) }),
      prior({ at: daysBefore(CE3_MIN_AGE_DAYS - 2) }),
    ]);
    expect(result.qualifies).toBe(false);
    if (!result.qualifies) {
      expect(result.counts.inWindow).toBe(0);
      expect(result.reason).toContain("four months");
    }
  });

  it("rejects a prior older than a year", () => {
    const result = selectPriors(disputed, [
      prior({ at: daysBefore(CE3_MAX_AGE_DAYS + 1) }),
      prior({ at: daysBefore(200) }),
    ]);
    expect(result.qualifies).toBe(false);
    if (!result.qualifies) expect(result.counts.inWindow).toBe(1);
  });

  it("measures the window from the sale, not from the dispute", () => {
    /*
     * A dispute can be raised 120 days after the sale. Measuring from the
     * dispute date would shift the whole window by up to four months and select
     * priors that do not qualify — a submission Visa rejects for a reason the
     * seller could never diagnose.
     *
     * Here the sale was 100 days ago; a prior 130 days before *the sale* is 230
     * days before today and inside the window either way, but a prior 30 days
     * before the sale is not — and would be "130 days ago" if measured wrongly.
     */
    const saleAt = daysBefore(100);
    const result = selectPriors(
      { at: saleAt, identity: FULL },
      [
        prior({ at: new Date(saleAt.getTime() - 30 * DAY) }),
        prior({ at: new Date(saleAt.getTime() - 40 * DAY) }),
      ],
    );
    expect(result.qualifies).toBe(false);
  });

  it("excludes a prior that has itself been disputed", () => {
    const result = selectPriors(disputed, [
      prior({ at: daysBefore(200), disputed: true }),
      prior({ at: daysBefore(190) }),
    ]);
    expect(result.qualifies).toBe(false);
    if (!result.qualifies) {
      expect(result.counts.undisputed).toBe(1);
      expect(result.reason).toContain("themselves been disputed");
    }
  });

  it("requires two matching data points, not one", () => {
    const emailOnly = identity({ email: "ada@example.com" });
    const result = selectPriors(disputed, [
      prior({ identity: emailOnly }),
      prior({ identity: emailOnly }),
    ]);
    expect(result.qualifies).toBe(false);
    if (!result.qualifies) expect(result.counts.matching).toBe(0);
  });

  it("picks the strongest pair rather than the most recent", () => {
    /*
     * Visa checks the pair it is given rather than looking for a better one, so
     * a submission built from two priors matching on email alone fails a rule
     * that two others in the same list would have passed.
     */
    const weak = identity({ email: "ada@example.com", purchaseIp: "203.0.113.42" });
    const result = selectPriors(disputed, [
      prior({ chargeId: "ch_weak_recent", at: daysBefore(121), identity: weak }),
      prior({ chargeId: "ch_strong_old_a", at: daysBefore(300), identity: FULL }),
      prior({ chargeId: "ch_strong_old_b", at: daysBefore(290), identity: FULL }),
    ]);
    expect(result.qualifies).toBe(true);
    if (result.qualifies) {
      expect(result.priors.map((p) => p.chargeId)).toEqual([
        "ch_strong_old_a",
        "ch_strong_old_b",
      ]);
    }
  });

  it("breaks ties towards the older transaction", () => {
    const result = selectPriors(disputed, [
      prior({ chargeId: "ch_newer", at: daysBefore(130) }),
      prior({ chargeId: "ch_older", at: daysBefore(300) }),
      prior({ chargeId: "ch_middle", at: daysBefore(200) }),
    ]);
    expect(result.qualifies).toBe(true);
    if (result.qualifies) {
      expect(result.priors[0].chargeId).toBe("ch_older");
    }
  });

  it("distinguishes one clean prior from a prior that was disputed", () => {
    /*
     * The bug the gate ordering fixed. With one clean candidate, the old
     * `undisputed < 2` test reported that the buyer's earlier orders had
     * themselves been disputed — which was simply untrue, and sent a seller
     * looking for a problem that did not exist.
     */
    const one = selectPriors(disputed, [prior({ chargeId: "ch_only" })]);
    expect(one.qualifies).toBe(false);
    if (!one.qualifies) {
      expect(one.reason).toContain("Only 1 earlier order");
      expect(one.reason).not.toContain("themselves been disputed");
    }
  });

  it("counts how many priors were lost to their own disputes", () => {
    const result = selectPriors(disputed, [
      prior({ at: daysBefore(200), disputed: true }),
      prior({ at: daysBefore(210), disputed: true }),
      prior({ at: daysBefore(220) }),
    ]);
    expect(result.qualifies).toBe(false);
    if (!result.qualifies) {
      expect(result.reason).toContain("2 of this buyer's earlier orders");
    }
  });

  it("says so plainly when the buyer has no history at all", () => {
    const result = selectPriors(disputed, []);
    expect(result.qualifies).toBe(false);
    if (!result.qualifies) expect(result.reason).toContain("No earlier orders");
  });

  it("blames the capture, not the seller, when the disputed order holds nothing", () => {
    /*
     * The most important message in this file. A seller whose history exists but
     * was recorded before Sailo captured IP addresses is being told something
     * about Sailo, and a readiness panel that says "gather more evidence" is
     * lying to them.
     */
    const result = selectPriors(
      { at: DISPUTED_AT, identity: identity({ email: "ada@example.com" }) },
      [prior({ identity: identity({ email: "ada@example.com" }) })],
    );
    expect(result.qualifies).toBe(false);
    if (!result.qualifies) {
      expect(result.reason).toContain("gap in what was captured");
    }
  });
});

describe("buildCe3Submission", () => {
  it("puts a download in Visa's merchandise bucket, not services", () => {
    /*
     * Visa has two buckets and Sailo has three kinds. A download is a thing
     * sold, not labour performed; only a booked appointment is a service.
     */
    const built = buildCe3Submission(
      { identity: FULL, soldKind: "digital", productDescription: "Preset pack" },
      [prior(), prior()],
    );
    expect(built.disputed.merchandiseOrServices).toBe("merchandise");
  });

  it("calls a booked appointment a service", () => {
    const built = buildCe3Submission(
      { identity: FULL, soldKind: "service", productDescription: "Haircut" },
      [prior(), prior()],
    );
    expect(built.disputed.merchandiseOrServices).toBe("services");
  });

  it("carries exactly two priors, which is what Stripe's API requires", () => {
    const built = buildCe3Submission(
      { identity: FULL, soldKind: "physical", productDescription: "Mug" },
      [prior({ chargeId: "ch_a" }), prior({ chargeId: "ch_b" })],
    );
    expect(built.priors).toHaveLength(2);
    expect(built.priors.map((p) => p.chargeId)).toEqual(["ch_a", "ch_b"]);
  });
});

describe("ce3Capable", () => {
  it("is true for an order carrying two data points", () => {
    expect(ce3Capable(identity({ purchaseIp: "203.0.113.42", email: "a@b.com" }))).toBe(true);
  });

  it("is false for an order carrying one", () => {
    expect(ce3Capable(identity({ email: "a@b.com" }))).toBe(false);
  });

  it("is false when the IP was never resolved", () => {
    expect(ce3Capable(identity({ purchaseIp: "unknown", email: "a@b.com" }))).toBe(false);
  });
});
