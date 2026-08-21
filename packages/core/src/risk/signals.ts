/**
 * What makes a shop worth a human's attention, and how loudly.
 *
 * ─── WHY THIS IS PURE, AND WHY IT IS NOT A SCORE ─────────────────────────────
 * Every input below is a number the platform already has: a chargeback rate
 * from `disputes`, a refund rate and a fortnight's volume from `orders`, an age
 * from `shops.created_at`, two booleans from the account. Nothing here reads a
 * database, so the whole ladder can be asserted against a table of cases — and
 * the risk desk that renders it can be moved, cached or paginated without any
 * of these thresholds moving with it.
 *
 * The output is deliberately **not** a 0–100 score. A score invites "is 61
 * worse than 59", which has no answer, and it hides the only distinction the
 * desk works from: is this something to keep an eye on, something to read
 * today, or something to act on now. It also invites weighting — 0.3 × refunds
 * plus 0.5 × chargebacks — and a weighted sum is a model nobody can explain to
 * the seller whose shop it closed.
 *
 * So each signal fires independently, says what it saw, and carries its own
 * severity. A shop's standing is the loudest thing true about it, and the
 * reason is a list of sentences rather than a number.
 *
 * ─── WHY THE THRESHOLDS ARE WHERE THEY ARE ───────────────────────────────────
 * The chargeback floors are the card networks', not ours. Visa's VAMP and
 * Mastercard's Excessive Chargeback Program both work in ratios, and a merchant
 * that crosses them is a merchant the acquirer is being asked about — which for
 * an Express connected account means Sailo is being asked about. 100bp (1%) is
 * conservatively inside both, which is the right side to sit on for a signal
 * whose purpose is to be early.
 *
 * The rest are calibrated to be *quiet*. A risk queue's failure mode is not
 * missing a fraudster, it is showing forty rows every morning until the people
 * staffing it stop reading the top of it. Every floor below is set where an
 * ordinary shop having an ordinary bad month does not appear.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * How loud a finding is. Three, for the same reason there are three and not ten
 * order statuses: these are the only distinctions that change what happens next.
 */
export const RISK_SEVERITIES = ["watch", "review", "act"] as const;

export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

/** Loudest wins. Not exported as a number, so nothing can be tempted to sum it. */
const SEVERITY_RANK: Record<RiskSeverity, number> = { watch: 0, review: 1, act: 2 };

export function isRiskSeverity(value: unknown): value is RiskSeverity {
  return typeof value === "string" && (RISK_SEVERITIES as readonly string[]).includes(value);
}

/**
 * The kinds of finding, which double as the `kind` column on `risk_flags`.
 *
 * `manual` is here so that a flag a human raised sorts and renders beside the
 * ones the desk raised. It is never produced by `assessRisk` — nothing about a
 * row can tell you somebody had a bad feeling about it — and that asymmetry is
 * why it is in the vocabulary rather than in the ladder.
 */
export const RISK_KINDS = [
  "chargebacks",
  "undelivered",
  "refunds",
  "velocity",
  "restricted_business",
  "returning_closure",
  "email_reputation",
  "manual",
] as const;

export type RiskKind = (typeof RISK_KINDS)[number];

export function isRiskKind(value: unknown): value is RiskKind {
  return typeof value === "string" && (RISK_KINDS as readonly string[]).includes(value);
}

export type RiskSignal = {
  kind: RiskKind;
  severity: RiskSeverity;
  /** One sentence, present tense, readable by whoever picks it up cold. */
  summary: string;
  /** The number it fired on, so a cleared flag knows what "worse" means later. */
  evidence: string;
};

/**
 * Everything the ladder reads, gathered by the caller.
 *
 * A flat bag of primitives rather than a `Shop` row, so this compiles without
 * `@sailo/db` and so the caller is forced to state where each number came from.
 * The alternative — passing the row — would let a signal quietly start reading
 * a column nobody expected it to.
 */
export type RiskInput = {
  /** Chargebacks per 10,000 settled orders. The card networks' unit. */
  chargebackBp: number;
  /** Settled orders behind that rate. A rate over three orders is not a rate. */
  settledOrders: number;
  /** Disputes still awaiting a decision, and what they are worth. */
  openDisputes: number;
  openDisputeCents: number;
  /** Paid orders sitting in `new` or `confirmed`, and what buyers paid for them. */
  undeliveredPaidOrders: number;
  undeliveredPaidCents: number;
  /** Refunded as a share of gross, in basis points. */
  refundBp: number;
  /** Gross in the last 7 days, and in the 7 before that. */
  recentCents: number;
  priorCents: number;
  /** Days since the shop was created. */
  ageDays: number;
  /** Whether the shop's own words tripped the restricted-business screen. */
  restricted: "clear" | "review" | "refuse";
  restrictedTerms: readonly string[];
  /** Closures already recorded against this owner's email fingerprint. */
  priorClosures: number;
  priorClosuresUnderSuspicion: number;
  /**
   * The account's own guards, and whether there is money behind them.
   *
   * Context, not a signal. Nothing in the ladder fires on these alone — see the
   * note where the `unguarded` signal used to be — but a shop taking cards is a
   * shop where every other finding costs somebody real money, and a caller that
   * could not supply them would be hiding that.
   */
  twoFactorEnabled: boolean;
  chargesEnabled: boolean;
  /** Lifetime gross, used only to keep the quiet signals quiet on tiny shops. */
  grossCents: number;
  currency: string;
  /**
   * Marketing mail handed to the provider in the last 30 days, and how it
   * landed. The decision-grade windowing (clearance watermark and all) lives
   * in `@sailo/marketing`'s reputation module — these are the desk's
   * screening numbers, same trade the chargeback columns make.
   */
  emailSent30d: number;
  emailComplaints30d: number;
  emailBounces30d: number;
  /** Whether the automatic reputation pause is standing on the shop. */
  marketingPaused: boolean;
};

/* ── Floors ──────────────────────────────────────────────────────────────── */

/**
 * Inside both Visa's VAMP and Mastercard's ECP thresholds, deliberately. The
 * point of this signal is to be early enough that something can still be done.
 */
export const CHARGEBACK_REVIEW_BP = 75;
export const CHARGEBACK_ACT_BP = 100;
/** Below this, the rate is arithmetic on too few orders to mean anything. */
export const CHARGEBACK_MIN_ORDERS = 20;

/**
 * A quarter of everything sold coming back is not a bad month.
 *
 * Named for what they produce, not for the ladder's top rung, because this
 * signal deliberately has no `act` — see the check itself. A constant called
 * `REFUND_ACT_BP` that produces `review` is the sort of thing somebody later
 * "fixes" by making it produce `act`.
 */
export const REFUND_WATCH_BP = 2_500;
export const REFUND_REVIEW_BP = 4_000;
export const REFUND_MIN_GROSS_CENTS = 50_000;

/**
 * The email screening floors — half the automatic pause thresholds in
 * `@sailo/marketing`'s reputation module (0.1% complaints, 5% bounces over a
 * 100-send floor), so the desk sees a shop *approaching* the pause while
 * there is still something to say to the seller besides "it happened".
 */
export const EMAIL_VOLUME_FLOOR = 100;
export const EMAIL_COMPLAINT_WATCH = 0.0005;
export const EMAIL_BOUNCE_WATCH = 0.025;

/** A week that is five times the one before it, on a shop old enough to have a normal. */
export const VELOCITY_MULTIPLE = 5;
export const VELOCITY_MIN_CENTS = 100_000;
export const VELOCITY_MIN_AGE_DAYS = 21;

/** Buyers who have paid and have nothing. One is a lapse; these are a pattern. */
export const UNDELIVERED_REVIEW = 5;
export const UNDELIVERED_ACT = 15;
/** Or fewer orders than that, but this much of other people's money. */
export const UNDELIVERED_ACT_CENTS = 100_000;

/** A young shop taking real money is where almost all of this actually happens. */
export const YOUNG_SHOP_DAYS = 30;

/**
 * Every signal that fires for this shop, loudest first.
 *
 * Order is by severity and then by the order of the checks below, which is
 * roughly "how much of somebody else's money is involved". A caller rendering
 * only the first one is rendering the thing most worth doing something about.
 */
export function assessRisk(input: RiskInput): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const money = (cents: number) =>
    `${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${input.currency}`;

  /* ── Chargebacks ─────────────────────────────────────────────────────── */
  if (
    input.settledOrders >= CHARGEBACK_MIN_ORDERS &&
    input.chargebackBp >= CHARGEBACK_REVIEW_BP
  ) {
    const act = input.chargebackBp >= CHARGEBACK_ACT_BP;
    signals.push({
      kind: "chargebacks",
      severity: act ? "act" : "review",
      summary:
        `Chargebacks are ${(input.chargebackBp / 100).toFixed(2)}% of ${input.settledOrders.toLocaleString()} settled orders` +
        (act
          ? " — past the level the card networks put an acquirer's platform on a monitoring programme for."
          : " — approaching the card networks' monitoring thresholds."),
      evidence: String(input.chargebackBp),
    });
  }

  /* ── Money taken for nothing ─────────────────────────────────────────── */
  if (input.undeliveredPaidOrders >= UNDELIVERED_REVIEW) {
    const act =
      input.undeliveredPaidOrders >= UNDELIVERED_ACT ||
      input.undeliveredPaidCents >= UNDELIVERED_ACT_CENTS;
    signals.push({
      kind: "undelivered",
      severity: act ? "act" : "review",
      summary:
        `${input.undeliveredPaidOrders} paid orders worth ${money(input.undeliveredPaidCents)} have not been delivered` +
        /*
         * "0 days old" is not something a person says, and a shop opened this
         * morning is the single most interesting age this signal can report —
         * so it is the one that must not read like a placeholder.
         */
        (input.ageDays <= YOUNG_SHOP_DAYS
          ? input.ageDays < 1
            ? ", on a shop opened today."
            : `, on a shop that is ${input.ageDays} day${input.ageDays === 1 ? "" : "s"} old.`
          : "."),
      evidence: String(input.undeliveredPaidOrders),
    });
  }

  /* ── Refunds ─────────────────────────────────────────────────────────── */
  if (input.grossCents >= REFUND_MIN_GROSS_CENTS && input.refundBp >= REFUND_WATCH_BP) {
    signals.push({
      kind: "refunds",
      severity: input.refundBp >= REFUND_REVIEW_BP ? "review" : "watch",
      /*
       * Never `act`, however high it goes. A shop refunding half its sales is
       * doing the right thing by its buyers, and the pattern this catches —
       * refunding to stay under a chargeback threshold — is a suspicion that
       * needs a human to read the orders, not a button.
       */
      summary: `${(input.refundBp / 100).toFixed(1)}% of everything this shop has sold has been refunded.`,
      evidence: String(input.refundBp),
    });
  }

  /* ── Email reputation ────────────────────────────────────────────────── */
  if (input.marketingPaused) {
    /*
     * The pause has already been applied by `@sailo/marketing`'s reputation
     * check — this puts it in front of a person, which is the half the
     * automatic side cannot do. `review`, not `act`: the damage is contained
     * by the pause; what is owed now is a conversation about the list.
     */
    signals.push({
      kind: "email_reputation",
      severity: "review",
      summary:
        `Marketing email is paused automatically — ${input.emailComplaints30d} spam ` +
        `complaint${input.emailComplaints30d === 1 ? "" : "s"} and ${input.emailBounces30d} ` +
        `bounce${input.emailBounces30d === 1 ? "" : "s"} across ${input.emailSent30d.toLocaleString()} sends in 30 days.`,
      evidence: String(input.emailComplaints30d + input.emailBounces30d),
    });
  } else if (input.emailSent30d >= EMAIL_VOLUME_FLOOR) {
    const complaintRate = input.emailComplaints30d / input.emailSent30d;
    const bounceRate = input.emailBounces30d / input.emailSent30d;
    if (complaintRate >= EMAIL_COMPLAINT_WATCH || bounceRate >= EMAIL_BOUNCE_WATCH) {
      signals.push({
        kind: "email_reputation",
        severity: "watch",
        summary:
          `Email reputation is slipping — ${input.emailComplaints30d} spam ` +
          `complaint${input.emailComplaints30d === 1 ? "" : "s"} and ${input.emailBounces30d} ` +
          `bounce${input.emailBounces30d === 1 ? "" : "s"} across ${input.emailSent30d.toLocaleString()} ` +
          `sends — halfway to the automatic pause.`,
        evidence: String(input.emailComplaints30d + input.emailBounces30d),
      });
    }
  }

  /* ── Velocity ────────────────────────────────────────────────────────── */
  if (
    input.ageDays >= VELOCITY_MIN_AGE_DAYS &&
    input.recentCents >= VELOCITY_MIN_CENTS &&
    input.priorCents > 0 &&
    input.recentCents >= input.priorCents * VELOCITY_MULTIPLE
  ) {
    const multiple = Math.round(input.recentCents / Math.max(input.priorCents, 1));
    signals.push({
      kind: "velocity",
      /*
       * `watch`, never louder. A shop going viral looks exactly like a shop
       * being used to launder card testing, and the difference is visible in
       * the orders rather than in the multiple — so this exists to put the
       * account on somebody's screen, not to imply a verdict about it.
       */
      severity: "watch",
      summary: `Volume is ${multiple}× last week's: ${money(input.recentCents)} against ${money(input.priorCents)}.`,
      evidence: String(multiple),
    });
  }

  /* ── What the shop says it sells ─────────────────────────────────────── */
  if (input.restricted !== "clear") {
    const terms = input.restrictedTerms.slice(0, 3).join(", ");
    signals.push({
      kind: "restricted_business",
      severity: input.restricted === "refuse" ? "act" : "review",
      summary:
        input.restricted === "refuse"
          ? `The shop's own description matches a business Sailo declines${terms ? ` (${terms})` : ""}.`
          : `The shop's description needs a decision against the restricted-business policy${terms ? ` (${terms})` : ""}.`,
      evidence: input.restricted,
    });
  }

  /* ── Somebody who has done this before ───────────────────────────────── */
  if (input.priorClosures > 0) {
    signals.push({
      kind: "returning_closure",
      severity: input.priorClosuresUnderSuspicion > 0 ? "act" : "watch",
      summary:
        input.priorClosuresUnderSuspicion > 0
          ? `This owner has closed ${input.priorClosures} shop${input.priorClosures === 1 ? "" : "s"} before, ${input.priorClosuresUnderSuspicion} of them with buyers or a bank still owed.`
          : `This owner has closed ${input.priorClosures} shop${input.priorClosures === 1 ? "" : "s"} before, all of them cleanly.`,
      evidence: String(input.priorClosures),
    });
  }

  /* ── The account's own front door — deliberately NOT here ────────────── */
  /*
   * There was an `unguarded` signal at this point: cards enabled, no second
   * factor, some revenue. It was removed after looking at the desk with real
   * data, where it fired on roughly every shop on the platform and produced
   * fifty-nine identical rows saying the same sentence — burying the two
   * findings that actually needed somebody.
   *
   * The mistake was a category error rather than a threshold. Every other
   * signal here is about **what a seller is doing to other people**; that one
   * was about **what might be done to the seller**, which is a different job on
   * a different day and already has a screen: `/security` reports the count and
   * `/accounts?security=cards_no2fa` is the list you work it from. Two-factor
   * adoption is a campaign, not a queue.
   *
   * `twoFactorEnabled` and `chargesEnabled` stay on `RiskInput`. They are still
   * read — a shop taking cards is a shop where the other findings cost real
   * money — and removing them would make the caller lie about what it knows.
   */

  /*
   * `sort`, not `toSorted`: this package's TS lib target predates it, and the
   * array is local to this call so mutating it is not observable.
   */
  return signals.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
}

/**
 * The loudest thing true about a shop, or null when nothing is.
 *
 * What a list column shows. `assessRisk` returns everything so a detail page
 * can print the full picture; this is the one-glance version, and it is a
 * separate function rather than `signals[0]` so that a caller reading it is
 * reading something named for what it means.
 */
export function worstSeverity(signals: readonly RiskSignal[]): RiskSeverity | null {
  return signals.reduce<RiskSeverity | null>(
    (worst, signal) =>
      worst === null || SEVERITY_RANK[signal.severity] > SEVERITY_RANK[worst]
        ? signal.severity
        : worst,
    null,
  );
}

/** Whether `next` is louder than `previous`. Used to decide re-raising a cleared flag. */
export function isLouder(next: RiskSeverity, previous: RiskSeverity): boolean {
  return SEVERITY_RANK[next] > SEVERITY_RANK[previous];
}
