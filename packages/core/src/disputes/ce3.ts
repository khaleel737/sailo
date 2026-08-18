/*
 * Visa Compelling Evidence 3.0.
 *
 * Every other file in this folder helps a seller argue a case an issuer will
 * weigh. This one is different in kind: CE3.0 is a Visa *rule*, and when its
 * conditions are met the dispute is resolved in the merchant's favour before
 * anybody weighs anything. It is the only mechanism available against a 10.4
 * fraud chargeback that does not depend on persuading someone, and fraud is the
 * reason code a small shop is least able to answer and most likely to receive.
 *
 * The rule, in one sentence: a merchant who can show that the same cardholder
 * transacted with them twice before, undisputed, between 120 and 365 days
 * earlier, sharing at least two identifying data points with the disputed
 * transaction, wins — on the reasoning that a stranger who stole a card does
 * not shop somewhere three times over four months.
 *
 * Two consequences shape everything here:
 *
 *   1. It is retroactive in the worst way. The two prior transactions must
 *      *already* carry the data points, so a platform that starts capturing IP
 *      addresses today cannot use CE3.0 for another four months. That is the
 *      argument for `orders.buyerIp` being a one-line change made now rather
 *      than a feature scheduled later.
 *   2. It is arithmetic, not judgement. Whether a dispute qualifies is a
 *      function of rows in a table, which means it can be computed, tested, and
 *      shown to a seller as a yes or a no — and it means Sailo can tell a
 *      seller *why* a case is unwinnable, which is worth more than a hopeful
 *      submission.
 *
 * Vendor-free by design: no Stripe types cross this boundary.
 * `@sailo/payments/disputes/ce3.ts` maps the output onto
 * `evidence.enhanced_evidence.visa_compelling_evidence_3`.
 */

/** The data points Visa will match a prior transaction on. */
export const CE3_MATCH_POINTS = [
  "account_id",
  "device_fingerprint",
  "device_id",
  "email",
  "purchase_ip",
  "shipping_address",
] as const;

export type Ce3MatchPoint = (typeof CE3_MATCH_POINTS)[number];

/**
 * The identifying facts about one transaction, as Visa compares them.
 *
 * Deliberately not the order row. Two orders match on "email" when the strings
 * are equal after folding, and on "shipping address" when the delivery point is
 * the same — which is not the same question as whether the rows are identical.
 * Reducing both sides to this shape first is what makes the comparison a
 * comparison rather than a series of ad-hoc string tests.
 */
export type Ce3Identity = {
  accountId: string | null;
  deviceFingerprint: string | null;
  deviceId: string | null;
  email: string | null;
  purchaseIp: string | null;
  shippingAddress: string | null;
};

/** A prior charge, and when it happened. */
export type Ce3Candidate = {
  /** The processor's charge id — what Visa is actually pointed at. */
  chargeId: string;
  at: Date;
  identity: Ce3Identity;
  productDescription: string | null;
  /** True if this one has itself ever been disputed. */
  disputed: boolean;
};

/**
 * Visa's window, and both ends of it bite.
 *
 * The floor is the rule's whole basis: a relationship has to predate the
 * disputed transaction by four months to be evidence of a relationship. The
 * ceiling stops a merchant reaching back years for a single old order.
 *
 * Measured from the *disputed transaction's* date, not from the dispute's —
 * a dispute can be raised 120 days after the sale, and using the dispute date
 * would quietly shift the whole window by up to four months and select priors
 * that do not qualify.
 */
export const CE3_MIN_AGE_DAYS = 120;
export const CE3_MAX_AGE_DAYS = 365;

/** Visa requires two matching data points. Not one, and more does not help. */
export const CE3_REQUIRED_MATCH_POINTS = 2;

/** Stripe's API requires exactly two prior transactions. */
export const CE3_REQUIRED_PRIORS = 2;

const DAY_MS = 86_400_000;

function fold(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed !== "unknown" ? trimmed : null;
}

/**
 * Which data points two transactions genuinely share.
 *
 * A null on either side is not a match. That sounds obvious and is the bug this
 * function exists to prevent: `a.purchaseIp === b.purchaseIp` is `true` when
 * both are null, so a naive comparison of two orders that recorded nothing
 * "matches" on all six points and submits a CE3.0 claim with no basis — which
 * Visa rejects and which, submitted routinely, is the kind of thing an acquirer
 * notices.
 */
export function matchPoints(a: Ce3Identity, b: Ce3Identity): Ce3MatchPoint[] {
  const pairs: readonly [Ce3MatchPoint, string | null, string | null][] = [
    ["account_id", fold(a.accountId), fold(b.accountId)],
    ["device_fingerprint", fold(a.deviceFingerprint), fold(b.deviceFingerprint)],
    ["device_id", fold(a.deviceId), fold(b.deviceId)],
    ["email", fold(a.email), fold(b.email)],
    ["purchase_ip", fold(a.purchaseIp), fold(b.purchaseIp)],
    ["shipping_address", fold(a.shippingAddress), fold(b.shippingAddress)],
  ];
  return pairs
    .filter(([, left, right]) => left !== null && right !== null && left === right)
    .map(([point]) => point);
}

export type Ce3Selection =
  | {
      qualifies: true;
      priors: readonly [Ce3Candidate, Ce3Candidate];
      /** The points each selected prior matched on, for the record. */
      matched: readonly Ce3MatchPoint[][];
    }
  | {
      qualifies: false;
      /** Why not, in a sentence a seller can act on — or cannot. */
      reason: string;
      /** How many candidates cleared each gate, for HQ to show the shortfall. */
      counts: {
        considered: number;
        inWindow: number;
        undisputed: number;
        matching: number;
      };
    };

/**
 * Pick the two priors that qualify, or explain the shortfall.
 *
 * The selection is not "the two most recent". It is the two with the *most*
 * matching data points, because Visa checks the pair it is given rather than
 * looking for a better one, and a submission built from two priors matching on
 * email alone fails a rule that two others in the same list would have passed.
 * Ties break towards the older transaction, since age is the thing the rule is
 * really about.
 */
export function selectPriors(
  disputed: { at: Date; identity: Ce3Identity },
  candidates: readonly Ce3Candidate[],
): Ce3Selection {
  const floor = disputed.at.getTime() - CE3_MAX_AGE_DAYS * DAY_MS;
  const ceiling = disputed.at.getTime() - CE3_MIN_AGE_DAYS * DAY_MS;

  const inWindow = candidates.filter((c) => {
    const t = c.at.getTime();
    return t >= floor && t <= ceiling;
  });
  const undisputed = inWindow.filter((c) => !c.disputed);

  const scored = undisputed
    .map((candidate) => ({
      candidate,
      matched: matchPoints(disputed.identity, candidate.identity),
    }))
    .filter(({ matched }) => matched.length >= CE3_REQUIRED_MATCH_POINTS)
    .sort(
      (a, b) =>
        b.matched.length - a.matched.length ||
        a.candidate.at.getTime() - b.candidate.at.getTime(),
    );

  const counts = {
    considered: candidates.length,
    inWindow: inWindow.length,
    undisputed: undisputed.length,
    matching: scored.length,
  };

  /*
   * Destructured and checked rather than length-checked and asserted.
   *
   * `scored.length >= 2` does not narrow `scored[0]` for TypeScript under
   * `noUncheckedIndexedAccess`, so the obvious version needs two non-null
   * assertions — and an assertion here would be load-bearing on a path that
   * builds a document sent to Visa. Reading the two out and testing them is the
   * same check the length was standing in for, and it survives someone changing
   * `CE3_REQUIRED_PRIORS`.
   */
  const [first, second] = scored;
  if (!first || !second) {
    return { qualifies: false, reason: shortfall(counts, disputed), counts };
  }

  return {
    qualifies: true,
    priors: [first.candidate, second.candidate],
    matched: [first.matched, second.matched],
  };
}

/**
 * The honest explanation, which is usually "this can never qualify".
 *
 * Worth its own function because the four failures mean four completely
 * different things and only one of them is fixable. A seller with no history
 * cannot be helped; a seller whose history exists but was recorded without IP
 * addresses is being told something about Sailo, not about themselves.
 */
function shortfall(
  counts: { considered: number; inWindow: number; undisputed: number; matching: number },
  disputed: { identity: Ce3Identity },
): string {
  if (counts.considered === 0) {
    return "No earlier orders from this buyer at all, so Visa's prior-transaction rule cannot apply.";
  }
  if (counts.inWindow === 0) {
    return (
      `This buyer's other orders all fall outside Visa's window of ${CE3_MIN_AGE_DAYS}–` +
      `${CE3_MAX_AGE_DAYS} days before the disputed sale. A relationship younger than four ` +
      "months does not count towards this rule."
    );
  }
  /*
   * The capture gap, checked before the counting gates below.
   *
   * When the disputed order itself carries nothing to match on, no number of
   * priors can help — so reporting "only one earlier order matched" would send a
   * seller looking for more history to fix a problem that is not theirs. The
   * first version of this function checked the counts first and told a seller
   * with one clean prior that their priors had been disputed, which was simply
   * untrue; `ce3.test.ts` caught it on the first run.
   */
  const disputedPoints = [
    disputed.identity.purchaseIp,
    disputed.identity.deviceFingerprint,
    disputed.identity.deviceId,
    disputed.identity.accountId,
  ].filter((v) => fold(v) !== null).length;

  if (disputedPoints === 0) {
    return (
      "The disputed order carries no IP address, device fingerprint or account id, so nothing " +
      "can be matched against. Orders placed before Sailo began recording these cannot use " +
      "Compelling Evidence 3.0 — this is a gap in what was captured, not in the seller's history."
    );
  }

  /*
   * Only reachable when priors were genuinely removed by the disputed filter.
   * `undisputed < CE3_REQUIRED_PRIORS` alone cannot tell "one of the two was
   * disputed" from "there was only ever one".
   */
  if (counts.undisputed < counts.inWindow && counts.undisputed < CE3_REQUIRED_PRIORS) {
    return (
      `${counts.inWindow - counts.undisputed} of this buyer's earlier orders in the window have ` +
      "themselves been disputed, so they cannot be cited."
    );
  }

  if (counts.inWindow < CE3_REQUIRED_PRIORS) {
    return (
      `Only ${counts.inWindow} earlier order from this buyer falls in Visa's ` +
      `${CE3_MIN_AGE_DAYS}–${CE3_MAX_AGE_DAYS} day window; two are needed.`
    );
  }

  return (
    `Only ${counts.matching} earlier order(s) share the ${CE3_REQUIRED_MATCH_POINTS} data points ` +
    `Visa requires; two are needed. Matching is on IP address, device, account, email or ` +
    "shipping address."
  );
}

/** What the disputed transaction has to state alongside the priors. */
export type Ce3Submission = {
  disputed: {
    identity: Ce3Identity;
    /** Visa's own categorisation. Physical goods or a service. */
    merchandiseOrServices: "merchandise" | "services";
    productDescription: string | null;
  };
  priors: readonly {
    chargeId: string;
    identity: Ce3Identity;
    productDescription: string | null;
  }[];
};

export function buildCe3Submission(
  disputed: {
    identity: Ce3Identity;
    soldKind: "physical" | "digital" | "service";
    productDescription: string | null;
  },
  priors: readonly [Ce3Candidate, Ce3Candidate],
): Ce3Submission {
  return {
    disputed: {
      identity: disputed.identity,
      /*
       * Visa has two buckets and Sailo has three kinds. A download is
       * merchandise — it is a thing sold, not labour performed — and only a
       * booked appointment is a service. Getting this wrong is not fatal to the
       * claim but it does put it in front of the wrong rule set.
       */
      merchandiseOrServices:
        disputed.soldKind === "service" ? "services" : "merchandise",
      productDescription: disputed.productDescription,
    },
    priors: priors.map((p) => ({
      chargeId: p.chargeId,
      identity: p.identity,
      productDescription: p.productDescription,
    })),
  };
}

/**
 * Whether an order is capable of *ever* supporting a CE3.0 claim.
 *
 * Run at checkout rather than at dispute time, and this is the honest reason
 * `orders.buyerIp` and `orders.buyerDeviceFingerprint` were added: they are
 * useless on the order that carries them and decide every fraud dispute four
 * months later. A shop whose orders all return false here has no fraud defence
 * and will not know it until a chargeback arrives.
 */
export function ce3Capable(identity: Ce3Identity): boolean {
  return (
    [
      identity.purchaseIp,
      identity.deviceFingerprint,
      identity.deviceId,
      identity.accountId,
      identity.email,
      identity.shippingAddress,
    ].filter((v) => fold(v) !== null).length >= CE3_REQUIRED_MATCH_POINTS
  );
}
