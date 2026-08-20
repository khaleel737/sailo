/*
 * Answering a chargeback against Sailo's own subscription revenue. Spec 46.
 *
 * `assemble.ts` is the connected side: every field resolver in it reads an
 * order, a shipment, a download log or a duplicate candidate, and a subscription
 * dispute has none of those. So this is a **platform variant** — same shape,
 * different holdings type — rather than a branch inside those resolvers. The
 * reason is the one that governs the whole subsystem: `assemble.ts` stays pure,
 * every branch stays reachable from a test with no fixtures, and neither side
 * grows a `if (scope === "platform")` that the other side's tests never enter.
 *
 * ─── THE ARGUMENT THIS EXISTS TO MAKE ───────────────────────────────────────
 *
 * A SaaS subscription is among the most defensible things there is. The case is
 * not about a parcel arriving, it is:
 *
 *   *this account signed up on this date from this address, accepted these
 *   terms, signed in 47 times since, published a storefront, and processed 340
 *   orders in the month they say they never authorised.*
 *
 * That is a stronger record than most physical sellers can produce and it is all
 * in our database. Sailo was submitting none of it: a seller charged back $49,
 * we lost $49 plus a $15 fee, downgraded them, and said nothing.
 *
 * ─── AND THE RULE THAT MATTERS MOST ─────────────────────────────────────────
 *
 * **If the seller is right, refund.** A subscription dispute is often a
 * cancellation that did not work, a card that kept being charged after a
 * downgrade, or a trial that converted without notice. Those are our bugs.
 * Contesting one is dishonest *and* a loss — we would spend the fee, lose
 * anyway, and add a loss to the platform account's own rate. `contestDecision`
 * below is a first-class outcome, not the absence of one.
 */

import { EVIDENCE_TEXT_BUDGET } from "./assemble";
import { clampEvidence, evidenceDate, evidenceMoney } from "./text";
import type { EvidenceField, EvidenceTextField } from "./reasons";

/* -------------------------------------------------------------------------- */
/*  Holdings                                                                  */
/* -------------------------------------------------------------------------- */

/** One day of the aggregate, as the evidence prints it. */
export type UsageDay = {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  signins: number;
  ordersProcessed: number;
  storefrontViews: number;
  adminActions: number;
};

/** One sign-in, as `account_events` recorded it. */
export type SigninEvent = {
  at: Date;
  ip: string | null;
  country: string | null;
  city: string | null;
};

/**
 * Everything Sailo holds about the seller behind a platform charge.
 *
 * Nullable throughout, for the reason `EvidenceHoldings` is: the question this
 * module answers is *what is missing*, and a shape that required its fields
 * could not represent the account that predates `account_events`.
 */
export type PlatformHoldings = {
  /* Who they are */
  accountEmail: string | null;
  accountName: string | null;
  shopHandle: string | null;
  shopName: string | null;

  /* How they arrived */
  signupAt: Date | null;
  signupIp: string | null;
  signupUserAgent: string | null;
  signupCountry: string | null;

  /* What they agreed to */
  termsAcceptedAt: Date | null;
  /** Sailo's own terms, as they stood — `policy_snapshots` with a null shop. */
  termsText: string | null;
  termsCapturedAt: Date | null;

  /* The subscription */
  plan: string | null;
  subscriptionStatus: string | null;
  subscriptionInterval: string | null;
  currentPeriodEnd: Date | null;
  /** Whether the seller ever asked for it to stop. The first decision question. */
  cancelAtPeriodEndSetAt: Date | null;
  /** Plan changes, from `account_events` kind `plan_change`. */
  planChanges: readonly { at: Date; detail: string }[];

  /* What was charged, and what they were told */
  chargedAt: Date | null;
  amountCents: number;
  currency: string;
  /** What appeared on their statement. */
  statementDescriptor: string | null;
  /** Whether the receipt for this charge was sent, and whether it bounced. */
  receiptSentTo: string | null;
  receiptBounced: boolean;

  /* Whether they used it */
  signins: readonly SigninEvent[];
  usage: readonly UsageDay[];
  /**
   * Days inside the window the rollup never wrote.
   *
   * Carried separately and printed as gaps rather than folded into `usage` as
   * zeroes. A false zero reads as "did not use the service" and argues our own
   * case against us.
   */
  usageGaps: readonly string[];

  /* The claim */
  /** When the cardholder says they cancelled, where the reason gives a date. */
  claimedCancelledAt: Date | null;
  /** A duplicate invoice, if Stripe's sequence shows one. */
  duplicateInvoiceId: string | null;
  /** Whether a refund was owed and not processed. Our bug if true. */
  refundOwedUnprocessed: boolean;
};

/* -------------------------------------------------------------------------- */
/*  The three questions that decide whether to fight                          */
/* -------------------------------------------------------------------------- */

export type ContestVerdict = "refund" | "contest" | "inquiry_only";

export type ContestDecision = {
  verdict: ContestVerdict;
  /** The sentence shown beside the evidence on the desk. */
  headline: string;
  /** The three questions, answered, in the order spec 46 asks them. */
  questions: readonly { question: string; answer: string; favours: "us" | "them" | "unknown" }[];
};

/**
 * Whether to contest, refund, or merely answer.
 *
 * Three questions, and the combination is the decision rather than a score:
 *
 *   1. Did the seller ever set `cancelAtPeriodEnd`, and did we bill after it?
 *   2. Was there usage in the disputed period?
 *   3. Did we send a receipt to a working address, and did it bounce?
 *
 * **A "no" on 2 with a "yes" on 1 is a refund**, and the desk says so rather
 * than offering a submit button. That combination is our own bug wearing a
 * chargeback's clothes: they asked it to stop, we billed anyway, and they did
 * not use what we billed for.
 */
export function contestDecision(
  h: PlatformHoldings,
  opts: { isInquiry?: boolean } = {},
): ContestDecision {
  const usedInPeriod = h.usage.some(
    (day) => day.signins > 0 || day.ordersProcessed > 0 || day.adminActions > 0,
  );
  const cancelledThenBilled =
    h.cancelAtPeriodEndSetAt !== null &&
    h.chargedAt !== null &&
    h.chargedAt > h.cancelAtPeriodEndSetAt;

  const questions = [
    {
      question: "Did they ask us to stop, and did we bill after that?",
      answer: cancelledThenBilled
        ? `They set cancellation on ${date(h.cancelAtPeriodEndSetAt)} and we charged them on ${date(h.chargedAt)}.`
        : h.cancelAtPeriodEndSetAt
          ? `They set cancellation on ${date(h.cancelAtPeriodEndSetAt)}, after this charge.`
          : "Cancellation was never set on this subscription.",
      favours: cancelledThenBilled ? ("them" as const) : ("us" as const),
    },
    {
      question: "Did they use the service in the period they are disputing?",
      answer: usedInPeriod
        ? `${usageSummary(h)} across ${h.usage.length} day(s) on record.`
        : h.usage.length === 0
          ? "No usage rows for this period — the rollup has nothing, which is not the same as no use."
          : "No sign-ins, orders or admin activity in the period.",
      /*
       * Absence of rows is `unknown`, not `them`. There is a real difference
       * between "they did not use it" and "we did not measure", and treating
       * the second as the first is how a desk talks itself out of a case it
       * should have made.
       */
      favours: usedInPeriod ? ("us" as const) : h.usage.length === 0 ? ("unknown" as const) : ("them" as const),
    },
    {
      question: "Did the receipt reach them?",
      answer: !h.receiptSentTo
        ? "No receipt is on record for this charge."
        : h.receiptBounced
          ? `The receipt to ${h.receiptSentTo} bounced.`
          : `A receipt was sent to ${h.receiptSentTo} and did not bounce.`,
      favours: !h.receiptSentTo || h.receiptBounced ? ("them" as const) : ("us" as const),
    },
  ];

  if (h.refundOwedUnprocessed) {
    return {
      verdict: "refund",
      headline:
        "We owed a refund on this and did not process it. Refund and stop — contesting would cost the fee and lose.",
      questions,
    };
  }

  if (cancelledThenBilled && !usedInPeriod) {
    return {
      verdict: "refund",
      headline:
        "They asked us to stop, we billed them anyway, and they did not use what we billed for. This is our bug. Refund rather than contest.",
      questions,
    };
  }

  if (opts.isInquiry) {
    return {
      verdict: "inquiry_only",
      headline:
        "An inquiry, not a chargeback: no money has moved. Answer it well and it usually does not become one — and the plan downgrade must not fire.",
      questions,
    };
  }

  return {
    verdict: "contest",
    headline: usedInPeriod
      ? "They used the service in the period they are disputing. That is the argument; submit it."
      : "Nothing here says we were in the wrong, but the usage record is thin. Read it before submitting.",
    questions,
  };
}

/* -------------------------------------------------------------------------- */
/*  The submission                                                            */
/* -------------------------------------------------------------------------- */

export type PlatformField = {
  field: EvidenceField;
  status: "held" | "missing";
  value?: string;
  required: boolean;
};

export type AssembledPlatformEvidence = {
  reason: string;
  fields: readonly PlatformField[];
  payload: Partial<Record<EvidenceTextField, string>>;
  heldRequired: number;
  totalRequired: number;
  completenessBp: number;
  hasGaps: boolean;
};

/**
 * Which fields carry a platform case, per reason.
 *
 * Its own table rather than `REASON_PLAYBOOKS`, because the *same reason code*
 * is answered differently here: `product_not_received` on a subscription is
 * answered with sign-ins, not with a carrier's scan, and `duplicate` is answered
 * from Stripe's own sequential invoices rather than from a second order.
 */
const PLATFORM_REQUIRED: Readonly<Record<string, readonly EvidenceField[]>> = {
  subscription_canceled: [
    "cancellation_rebuttal",
    "access_activity_log",
    "cancellation_policy_disclosure",
    "customer_email_address",
  ],
  unrecognized: [
    "product_description",
    "customer_email_address",
    "customer_name",
    "customer_purchase_ip",
    "billing_address",
  ],
  fraudulent: [
    "customer_name",
    "customer_email_address",
    "customer_purchase_ip",
    "billing_address",
    "access_activity_log",
  ],
  product_not_received: ["access_activity_log", "product_description", "service_date"],
  credit_not_processed: ["refund_refusal_explanation", "refund_policy_disclosure"],
  duplicate: ["duplicate_charge_id", "duplicate_charge_explanation"],
};

const PLATFORM_PERSUASIVE: readonly EvidenceField[] = [
  "uncategorized_text",
  "refund_policy_disclosure",
  "product_description",
];

export function platformFieldsFor(reason: string): readonly EvidenceField[] {
  const required = PLATFORM_REQUIRED[reason] ?? [
    "uncategorized_text",
    "product_description",
    "customer_email_address",
    "access_activity_log",
  ];
  const seen = new Set<string>(required);
  return [...required, ...PLATFORM_PERSUASIVE.filter((field) => !seen.has(field))];
}

/* The shared formatter, with this module's own absence wording. */
function date(value: Date | null): string {
  return evidenceDate(value) ?? "not on record";
}

function usageSummary(h: PlatformHoldings): string {
  const signins = h.usage.reduce((sum, day) => sum + day.signins, 0);
  const orders = h.usage.reduce((sum, day) => sum + day.ordersProcessed, 0);
  return `${signins} sign-in(s) and ${orders} order(s) processed`;
}

const clamp = clampEvidence;

/**
 * The access log for a subscription: sign-ins, not downloads.
 *
 * One line per sign-in with its address, and then the daily aggregate — because
 * `account_events` is kept 400 days and the aggregate reaches further back. Gaps
 * are printed as gaps.
 */
function accessLog(h: PlatformHoldings): string | null {
  const lines: string[] = [];

  for (const event of h.signins.slice(0, 100)) {
    lines.push(
      `${event.at.toISOString()} — signed in from ${event.ip ?? "address not recorded"}` +
        (event.country ? ` (${[event.city, event.country].filter(Boolean).join(", ")})` : ""),
    );
  }

  for (const day of h.usage) {
    lines.push(
      `${day.day} — ${day.signins} sign-in(s), ${day.ordersProcessed} order(s) processed, ` +
        `${day.storefrontViews} storefront view(s)`,
    );
  }

  /*
   * Named, not silently omitted. A day the rollup never ran is not a day the
   * seller did not use Sailo, and printing it as a zero would argue our own
   * case against us in front of an issuer.
   */
  for (const gap of h.usageGaps) {
    lines.push(`${gap} — no usage record was written for this day`);
  }

  return lines.length > 0 ? clamp(lines.join("\n")) : null;
}

function narrative(h: PlatformHoldings): string {
  const lines: string[] = [
    `Sailo is a hosted online shop service. This charge is a ${h.subscriptionInterval ?? "recurring"} ` +
      `subscription to the ${h.plan ?? "paid"} plan, ${evidenceMoney(h.amountCents, h.currency)}.`,
  ];

  if (h.accountEmail) lines.push(`Account email: ${h.accountEmail}.`);
  if (h.shopHandle) {
    lines.push(
      `The account operates a public storefront at sailo.store/${h.shopHandle}` +
        (h.shopName ? ` ("${h.shopName}")` : "") +
        ".",
    );
  }
  if (h.signupAt) {
    lines.push(
      `Signed up ${h.signupAt.toISOString()}` +
        (h.signupIp ? ` from ${h.signupIp}` : "") +
        (h.signupCountry ? ` (${h.signupCountry})` : "") +
        ".",
    );
  }
  if (h.termsAcceptedAt) {
    lines.push(
      `Accepted Sailo's terms at ${h.termsAcceptedAt.toISOString()}, recorded server-side at signup.`,
    );
  }
  if (h.statementDescriptor) {
    lines.push(`The charge appeared on the statement as "${h.statementDescriptor}".`);
  }
  if (h.receiptSentTo && !h.receiptBounced) {
    lines.push(
      `A receipt for this charge was emailed to ${h.receiptSentTo}, carrying a link to the ` +
        `self-service billing portal where the subscription can be cancelled at any time.`,
    );
  }
  if (h.receiptBounced && h.receiptSentTo) {
    /*
     * Disclosed rather than omitted. A bounced receipt explains why a
     * cardholder says they were never told, and hiding it is the kind of
     * overstatement that loses a case on the point it was hidden about.
     */
    lines.push(`The receipt to ${h.receiptSentTo} bounced, so it may not have been seen.`);
  }
  if (h.cancelAtPeriodEndSetAt) {
    lines.push(`Cancellation was set on ${date(h.cancelAtPeriodEndSetAt)}.`);
  } else {
    lines.push(
      "Cancellation was never requested on this subscription. Sailo cancels through Stripe's own " +
        "hosted billing portal, so a cancellation would appear on the subscription itself; none does.",
    );
  }
  if (h.usage.length > 0) lines.push(`Service use in the period: ${usageSummary(h)}.`);

  return clamp(lines.join("\n"));
}

function resolve(field: EvidenceField, h: PlatformHoldings): { value?: string } {
  const held = (value: string | null | undefined) =>
    value && value.trim() ? { value: clamp(value.trim()) } : {};

  switch (field) {
    case "customer_name":
      return held(h.accountName);
    case "customer_email_address":
      return held(h.accountEmail);
    case "customer_purchase_ip":
      return held(h.signupIp);
    case "billing_address":
      return held(h.signupCountry);
    case "product_description":
      return {
        value: clamp(
          `Sailo ${h.plan ?? "paid"} plan — a hosted online shop with checkout, payments, ` +
            `digital delivery and email, billed ${h.subscriptionInterval ?? "recurring"}` +
            (h.shopHandle ? `. The account's storefront is sailo.store/${h.shopHandle}` : "") +
            ".",
        ),
      };
    case "service_date":
      return held(h.chargedAt?.toISOString() ?? null);
    case "access_activity_log":
      return held(accessLog(h));
    case "cancellation_rebuttal":
      return {
        value: clamp(
          h.cancelAtPeriodEndSetAt
            ? `Cancellation was set on ${date(h.cancelAtPeriodEndSetAt)}, after the disputed charge, ` +
              `for a period already begun. ${usageSummary(h)} is on record for that period.`
            : `No cancellation was ever received for this subscription. Cancelling is self-service ` +
              `through Stripe's own hosted billing portal, linked from every receipt, and would appear ` +
              `on the subscription itself; none does. ${usageSummary(h)} is on record after the date ` +
              `the cardholder says they cancelled.`,
        ),
      };
    case "cancellation_policy_disclosure":
      if (!h.termsAcceptedAt) return {};
      return {
        value: clamp(
          `Sailo's terms, including how to cancel, were accepted at ${h.termsAcceptedAt.toISOString()}` +
            (h.termsCapturedAt
              ? ` and are reproduced below as they stood, captured ${date(h.termsCapturedAt)}`
              : "") +
            "." +
            (h.termsText ? `\n\n${h.termsText}` : ""),
        ),
      };
    case "refund_policy_disclosure":
      if (!h.termsAcceptedAt) return {};
      return {
        value: clamp(
          `Sailo's refund terms were accepted at ${h.termsAcceptedAt.toISOString()}, recorded ` +
            `server-side at signup.`,
        ),
      };
    case "refund_refusal_explanation":
      return h.refundOwedUnprocessed
        ? {}
        : {
            value: clamp(
              "No refund was requested through Sailo's support address or the billing portal before " +
                "this dispute was raised.",
            ),
          };
    case "duplicate_charge_id":
      return held(h.duplicateInvoiceId);
    case "duplicate_charge_explanation":
      return {
        value: h.duplicateInvoiceId
          ? clamp(
              `Invoice ${h.duplicateInvoiceId} is the adjacent invoice in Stripe's own sequential ` +
                `subscription billing and covers a different period. If the two are genuinely the same ` +
                `period, that is our error and the charge should be refunded rather than contested.`,
            )
          : "Stripe's subscription invoices are sequential and no second invoice covers this period.",
      };
    case "uncategorized_text":
      return { value: narrative(h) };
    default:
      /*
       * Every file field, and the connected-only text fields — shipping,
       * service documentation, a customer signature. A subscription has none of
       * them, and offering a slot Sailo can never fill would show a permanently
       * incomplete panel on a case that is actually complete.
       */
      return {};
  }
}

/**
 * Build the platform submission, and say what is missing from it.
 *
 * Text fields only. There is no order to attach a receipt to and no carrier
 * document to upload; spec 45's pack renders the human-readable document
 * separately, and the file slot it fills is registered by the same path a
 * seller's upload uses.
 */
export function assemblePlatformEvidence(
  reason: string,
  h: PlatformHoldings,
): AssembledPlatformEvidence {
  const required = new Set<string>(PLATFORM_REQUIRED[reason] ?? []);
  const wanted = platformFieldsFor(reason);

  const fields: PlatformField[] = wanted.map((field) => {
    const { value } = resolve(field, h);
    return {
      field,
      required: required.has(field),
      status: value === undefined ? "missing" : "held",
      ...(value !== undefined ? { value } : {}),
    };
  });

  const payload: Partial<Record<EvidenceTextField, string>> = {};
  let spent = 0;
  for (const entry of fields) {
    if (entry.status !== "held" || entry.value === undefined) continue;
    if (spent + entry.value.length > EVIDENCE_TEXT_BUDGET) continue;
    payload[entry.field as EvidenceTextField] = entry.value;
    spent += entry.value.length;
  }

  const requiredFields = fields.filter((field) => field.required);
  const heldRequired = requiredFields.filter((field) => field.status === "held").length;

  return {
    reason,
    fields,
    payload,
    heldRequired,
    totalRequired: requiredFields.length,
    completenessBp:
      requiredFields.length === 0
        ? 10_000
        : Math.round((heldRequired / requiredFields.length) * 10_000),
    hasGaps: heldRequired < requiredFields.length,
  };
}

/* -------------------------------------------------------------------------- */
/*  Usage gaps                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The days inside a window that the rollup never wrote.
 *
 * Pure and separate from the read, so the labelling is testable without a
 * database. `have` is the set of `YYYY-MM-DD` the aggregate actually holds.
 */
export function usageGapsIn(
  from: Date,
  to: Date,
  have: readonly string[],
): string[] {
  const held = new Set(have);
  const gaps: string[] = [];

  for (
    let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    cursor <= to;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const day = cursor.toISOString().slice(0, 10);
    if (!held.has(day)) gaps.push(day);
  }

  return gaps;
}

/**
 * How many prior undisputed subscription payments this account has.
 *
 * CE3.0's platform-side identity: a seller with two prior undisputed
 * subscription payments 120–365 days back, sharing two match points with the
 * disputed one, is a **rule** win rather than an argument. The match points on
 * this side are the account id, the signup IP and the email — there is no
 * shipping address and no device fingerprint on a subscription charge.
 */
export function platformCe3Identity(h: PlatformHoldings): {
  accountId: string | null;
  email: string | null;
  purchaseIp: string | null;
  deviceFingerprint: null;
  deviceId: null;
  shippingAddress: null;
} {
  return {
    /*
     * The handle, which is the durable identifier for a Sailo account in the
     * way `clients.id` is for a buyer. A user id would also do; the handle is
     * what appears in the evidence a human reads.
     */
    accountId: h.shopHandle,
    email: h.accountEmail,
    purchaseIp: h.signupIp,
    /*
     * Null, and null on purpose. A subscription charge is taken from a card on
     * file by a scheduled job with no browser in the loop, so there is no device
     * and no shipping address to match on — claiming either would be inventing a
     * data point for Visa.
     */
    deviceFingerprint: null,
    deviceId: null,
    shippingAddress: null,
  };
}
