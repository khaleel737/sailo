/*
 * Turning what Sailo holds about an order into what Stripe will accept.
 *
 * Pure, and that is the point of it being here rather than in `@sailo/commerce`
 * beside the queries. Assembling dispute evidence is the step nobody exercises
 * until it matters: it runs a handful of times a month, against orders whose
 * shape varies more than any other path in the product, and a mistake in it is
 * discovered as a lost case and a debited balance sixty days later. So it takes
 * a flat record of facts and returns a flat record of fields, and every branch
 * in it is reachable from a test with no fixtures.
 *
 * `@sailo/commerce/disputes` maps a database row to `EvidenceHoldings`;
 * `@sailo/payments/disputes` posts the result. Neither one contains a decision.
 */

import {
  evidenceFieldsFor,
  isFileField,
  playbookFor,
  type EvidenceField,
  type EvidenceTextField,
  type SoldKind,
} from "./reasons";

/**
 * Everything about an order that could become evidence, already flattened.
 *
 * Nullable throughout, deliberately. The whole question this module answers is
 * *what is missing*, and a shape that required its fields could not represent
 * the case that actually happens — an order taken before `buyerIp` existed, a
 * download never fetched, a parcel never marked shipped.
 */
export type EvidenceHoldings = {
  /* Who bought it */
  customerName: string | null;
  customerEmail: string | null;
  /**
   * The address the buyer's browser came from at checkout.
   *
   * The single highest-value field on this list and the one Sailo held none of
   * until this pass. Every fraud rebuttal rests on it, Visa's Compelling
   * Evidence 3.0 requires it, and it cannot be backfilled: the buyer's
   * connection existed for one request months ago. Captured by
   * `createOrderIntent` from the same `callerIp()` the rate limiter already
   * used, which is why this was a one-line change rather than a new subsystem.
   */
  buyerIp: string | null;
  buyerUserAgent: string | null;
  /**
   * A stable per-browser identifier, ≥20 characters, for CE3.0's
   * `customer_device_fingerprint`.
   */
  buyerDeviceFingerprint: string | null;
  /** The buyer's account or client id on Sailo, for CE3.0's account match. */
  buyerAccountId: string | null;

  /* Where it went */
  billingAddress: string | null;
  shippingAddress: string | null;

  /* What it was */
  productDescription: string | null;
  soldKind: SoldKind;
  currency: string;
  totalCents: number;
  orderReference: string;
  placedAt: Date;

  /* How it was delivered */
  shippingCarrier: string | null;
  shippingTrackingNumber: string | null;
  shippedAt: Date | null;
  /** When the appointment was, for a service. */
  serviceAt: Date | null;
  /**
   * One line per time the buyer took the goods: when, from where, what.
   *
   * For a download this is `downloadEvents`; for a membership it is the
   * member's sessions. It is the whole case on a digital sale, and a count is
   * not a log — an issuer reading "downloaded 3 times" learns nothing it can
   * weigh, while three timestamped lines with the buyer's own IP address
   * beside them are the same evidence a physical seller gets from a carrier.
   */
  accessLog: readonly string[];

  /* What they agreed to */
  termsAcceptedAt: Date | null;
  refundPolicyText: string | null;
  refundPolicyUrl: string | null;
  cancellationPolicyText: string | null;

  /* What happened afterwards */
  refundedCents: number;
  refundedAt: Date | null;
  /** The seller's own account of why a refund was refused, if they gave one. */
  refundRefusalExplanation: string | null;
  /** The charge a `duplicate` claim is actually about, if one was found. */
  duplicateChargeId: string | null;
  /** Whether that other charge is a different order rather than the same one. */
  duplicateIsDistinct: boolean;
  /** For `subscription_canceled`: when the buyer actually cancelled. */
  cancelledAt: Date | null;
  /** Free-text conversation with the buyer, if the seller supplied any. */
  customerCommunicationSummary: string | null;

  /** Stripe File ids the seller has uploaded, by field. */
  files: Partial<Record<EvidenceField, string>>;
};

/**
 * Sailo's ceiling on the whole submission, which is far below Stripe's.
 *
 * Stripe rejects an update whose text fields exceed **150,000** characters
 * combined. This budget is 20,000, and the gap is deliberate rather than an
 * out-of-date constant: Stripe's own guidance is that issuers review thousands
 * of responses a day and that burying the argument loses cases that a shorter
 * one wins. Nothing Sailo assembles is close to either number — the narrative and
 * an access log run to hundreds of characters — so the budget exists to bound a
 * pathological order (a 900-line basket, a description pasted from a CMS) rather
 * than to track an API limit.
 *
 * Enforced here rather than discovered at the API because an overflow rejects the
 * *entire* update, losing the fields that were right along with the one that was
 * not. The order the fields are trimmed in is the playbook's, so what survives a
 * squeeze is what wins the case.
 */
export const EVIDENCE_TEXT_BUDGET = 20_000;

/** Per-field ceiling, so one long product description cannot eat the budget. */
export const EVIDENCE_FIELD_MAX = 4_000;

export type FieldStatus = "held" | "missing" | "needs_seller" | "not_applicable";

export type AssembledField = {
  field: EvidenceField;
  status: FieldStatus;
  /** Present when `held`, and exactly what will be sent. */
  value?: string;
  /** Whether this field is load-bearing for the reason at hand. */
  required: boolean;
  /** What to tell a seller who needs to supply it. */
  ask?: string;
};

export type AssembledEvidence = {
  reason: string;
  soldKind: SoldKind;
  /** Every field the playbook asked for, in the order it asked. */
  fields: readonly AssembledField[];
  /** The Stripe payload, ready to submit. Text fields only. */
  payload: Partial<Record<EvidenceTextField, string>>;
  /** File field ids, kept apart because Stripe validates them differently. */
  fileIds: Partial<Record<EvidenceField, string>>;
  /** Required fields we hold. */
  heldRequired: number;
  /** Required fields we do not. */
  totalRequired: number;
  /**
   * Completeness over required fields only, in basis points.
   *
   * Over *required* rather than over everything asked for, because the
   * persuasive extras are exactly that. A 10000 here does not promise a win; it
   * promises that nothing the network asks for is absent, which is the only
   * thing an engineering system can promise.
   */
  completenessBp: number;
  /** True when a submission would be sent with a required field empty. */
  hasGaps: boolean;
  /**
   * Required fields only the seller can fill. Drives the prompt on their panel.
   *
   * Required only, and the split matters. This list was every `needs_seller`
   * field including the persuasive ones, so a seller who had uploaded the proof
   * of delivery that decides their case was still shown two outstanding items —
   * a customer conversation and a receipt that neither the network asks for nor
   * changes the outcome. A complete case that reads as incomplete teaches the
   * seller to ignore the panel, which costs the next case.
   */
  blockedOnSeller: readonly EvidenceField[];
  /** Persuasive uploads, offered separately so they cannot read as blocking. */
  optionalUploads: readonly EvidenceField[];
};

function date(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function money(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function clamp(text: string): string {
  return text.length <= EVIDENCE_FIELD_MAX
    ? text
    : `${text.slice(0, EVIDENCE_FIELD_MAX - 1)}…`;
}

/**
 * The narrative, which is the one field a human would have written.
 *
 * Assembled rather than left blank because `uncategorized_text` is what an
 * issuer reads first and, on a `general` dispute, the only thing they are given
 * a category for. It states facts and nothing else — no argument, no adjectives
 * — because the fields above it are the argument and a paragraph of insistence
 * beside a missing proof of delivery reads as exactly what it is.
 */
function narrative(h: EvidenceHoldings): string {
  const lines: string[] = [
    `Order ${h.orderReference}, placed ${h.placedAt.toISOString()}, for ${money(h.totalCents, h.currency)}.`,
  ];
  if (h.customerName) lines.push(`Buyer: ${h.customerName}.`);
  if (h.customerEmail) lines.push(`Email given at checkout: ${h.customerEmail}.`);
  if (h.buyerIp && h.buyerIp !== "unknown") {
    lines.push(`Purchase IP address: ${h.buyerIp}.`);
  }
  if (h.buyerUserAgent) lines.push(`Browser: ${h.buyerUserAgent}.`);
  if (h.productDescription) lines.push(`Sold: ${h.productDescription}.`);

  if (h.termsAcceptedAt) {
    lines.push(
      `The buyer accepted the shop's terms at ${h.termsAcceptedAt.toISOString()}, ` +
        `recorded server-side at checkout${h.refundPolicyUrl ? ` (${h.refundPolicyUrl})` : ""}.`,
    );
  }

  if (h.shippedAt && h.shippingTrackingNumber) {
    lines.push(
      `Shipped ${date(h.shippedAt)} via ${h.shippingCarrier ?? "carrier"}, ` +
        `tracking ${h.shippingTrackingNumber}.`,
    );
  }
  if (h.serviceAt) lines.push(`Service was booked for ${h.serviceAt.toISOString()}.`);
  if (h.accessLog.length > 0) {
    lines.push(`Accessed by the buyer ${h.accessLog.length} time(s):`);
    // Capped: an issuer needs the pattern, not four hundred rows, and the
    // budget above is shared with every other field.
    lines.push(...h.accessLog.slice(0, 20));
  }

  if (h.refundedCents > 0) {
    lines.push(
      `${money(h.refundedCents, h.currency)} was refunded on ${date(h.refundedAt)}.`,
    );
  }
  return clamp(lines.join("\n"));
}

/**
 * What is held for one field, or why it is not.
 *
 * `needs_seller` is a third answer and it earns its place: a field the seller
 * could supply but has not is a different problem from one nothing can supply,
 * and only the first has a useful thing to show them. Merging them into
 * `missing` is what produces a readiness panel telling a seller to go and find
 * an IP address from four months ago.
 */
function resolve(field: EvidenceField, h: EvidenceHoldings): {
  status: FieldStatus;
  value?: string;
  ask?: string;
} {
  const held = (value: string | null | undefined) =>
    value && value.trim() && value !== "unknown"
      ? { status: "held" as const, value: clamp(value.trim()) }
      : null;

  if (isFileField(field)) {
    const id = h.files[field];
    if (id) return { status: "held", value: id };
    return {
      status: "needs_seller",
      ask: FILE_ASKS[field] ?? "Upload this document.",
    };
  }

  switch (field) {
    case "customer_name":
      return held(h.customerName) ?? { status: "missing" };
    case "customer_email_address":
      return held(h.customerEmail) ?? { status: "missing" };
    case "customer_purchase_ip":
      return (
        held(h.buyerIp) ?? {
          status: "missing",
          /*
           * Not `needs_seller`. Nobody can produce this after the fact — the
           * buyer's connection existed for one request — so asking the seller
           * for it wastes their time and hides the real finding, which is that
           * the order predates the capture.
           */
        }
      );
    case "billing_address":
      return held(h.billingAddress) ?? { status: "missing" };
    case "shipping_address":
      if (h.soldKind !== "physical") return { status: "not_applicable" };
      return held(h.shippingAddress) ?? { status: "missing" };
    case "shipping_carrier":
      if (h.soldKind !== "physical") return { status: "not_applicable" };
      return (
        held(h.shippingCarrier) ?? {
          status: "needs_seller",
          ask: "Add the carrier you shipped with.",
        }
      );
    case "shipping_tracking_number":
      if (h.soldKind !== "physical") return { status: "not_applicable" };
      return (
        held(h.shippingTrackingNumber) ?? {
          status: "needs_seller",
          ask: "Add the tracking number. Without it a not-received claim cannot be answered.",
        }
      );
    case "shipping_date":
      if (h.soldKind !== "physical") return { status: "not_applicable" };
      return (
        held(date(h.shippedAt)) ?? {
          status: "needs_seller",
          ask: "Mark the order shipped so the date is on record.",
        }
      );
    case "service_date":
      if (h.soldKind !== "service") return { status: "not_applicable" };
      return held(h.serviceAt?.toISOString() ?? null) ?? { status: "missing" };
    case "product_description":
      return held(h.productDescription) ?? { status: "missing" };
    case "access_activity_log":
      if (h.accessLog.length === 0) {
        return h.soldKind === "physical"
          ? { status: "not_applicable" }
          : {
              status: "missing",
              /*
               * A digital order with no access log is the strongest possible
               * evidence *for the buyer*: they paid and never got the goods.
               * Surfaced as missing rather than hidden, because the right
               * action here is usually to refund rather than to contest.
               */
            };
      }
      return { status: "held", value: clamp(h.accessLog.join("\n")) };
    case "refund_policy_disclosure":
      if (!h.termsAcceptedAt) {
        return {
          status: "missing",
          ask: "Turn on terms acceptance at checkout so future orders carry this.",
        };
      }
      return {
        status: "held",
        value: clamp(
          `The shop's refund policy was shown at checkout and accepted by the buyer at ` +
            `${h.termsAcceptedAt.toISOString()}. The acceptance is recorded server-side from ` +
            `the server's own clock at order creation, not from a client-submitted flag` +
            `${h.refundPolicyUrl ? `, and the policy is published at ${h.refundPolicyUrl}` : ""}.` +
            (h.refundPolicyText ? `\n\nPolicy as it stood:\n${h.refundPolicyText}` : ""),
        ),
      };
    case "cancellation_policy_disclosure":
      if (!h.termsAcceptedAt) {
        return {
          status: "missing",
          ask: "Turn on terms acceptance at checkout so future orders carry this.",
        };
      }
      return {
        status: "held",
        value: clamp(
          `The cancellation terms were shown at checkout and accepted at ` +
            `${h.termsAcceptedAt.toISOString()}.` +
            (h.cancellationPolicyText ? `\n\n${h.cancellationPolicyText}` : ""),
        ),
      };
    case "cancellation_rebuttal":
      if (!h.cancelledAt) {
        return {
          status: "held",
          value: clamp(
            `No cancellation was ever received for this subscription. Sailo cancels through ` +
              `Stripe's own hosted billing portal, so a cancellation would appear on the ` +
              `subscription itself; none does.`,
          ),
        };
      }
      return {
        status: "held",
        value: clamp(
          `The subscription was cancelled at ${h.cancelledAt.toISOString()}. The disputed ` +
            `charge was raised before that date, for a period the member had already begun. ` +
            (h.accessLog.length > 0
              ? `The member accessed the subscription ${h.accessLog.length} time(s) after the ` +
                `charge, listed under the access log.`
              : ""),
        ),
      };
    case "refund_refusal_explanation":
      if (h.refundedCents > 0) {
        return {
          status: "held",
          value: clamp(
            `A refund of ${money(h.refundedCents, h.currency)} was issued on ` +
              `${date(h.refundedAt)}, before this dispute. The chargeback duplicates it.`,
          ),
        };
      }
      return (
        held(h.refundRefusalExplanation) ?? {
          status: "needs_seller",
          ask: "Explain in a sentence why a refund was not given. The disclosed policy is the argument, not your judgement of the buyer.",
        }
      );
    case "duplicate_charge_id":
      if (!h.duplicateChargeId) {
        return {
          status: "missing",
          ask: "No second charge to this buyer was found — which is itself the answer to a duplicate claim.",
        };
      }
      return { status: "held", value: h.duplicateChargeId };
    case "duplicate_charge_explanation":
      if (!h.duplicateChargeId) {
        return {
          status: "held",
          value:
            "No other charge to this cardholder was found for this shop, so there is no duplicate.",
        };
      }
      return {
        status: "held",
        value: h.duplicateIsDistinct
          ? clamp(
              `Charge ${h.duplicateChargeId} is a separate order for different items, placed at a ` +
                `different time. Both were fulfilled. Receipts for each are attached.`,
            )
          : clamp(
              `Charge ${h.duplicateChargeId} is the same order charged twice and should be refunded ` +
                `rather than contested.`,
            ),
      };
    case "uncategorized_text":
      return { status: "held", value: narrative(h) };
  }
}

const FILE_ASKS: Partial<Record<EvidenceField, string>> = {
  shipping_documentation:
    "Upload the carrier's proof of delivery — a signature or a delivery scan. A tracking page showing 'in transit' is not delivery.",
  receipt: "Upload the receipt or invoice the buyer was sent.",
  refund_policy: "Upload your refund policy as the buyer saw it.",
  cancellation_policy: "Upload your cancellation terms as the buyer saw them.",
  customer_communication:
    "Upload the conversation with the buyer — email or chat, with dates visible.",
  service_documentation:
    "Upload proof the service happened: an attendance record, a signed job sheet, photos.",
  customer_signature: "Upload the buyer's signature, if you hold one.",
  duplicate_charge_documentation:
    "Upload receipts for both charges so the issuer can see they are different orders.",
  uncategorized_file: "Upload anything else that supports the sale.",
};

/**
 * Build the submission, and say what is missing from it.
 *
 * Never throws and never returns a partial object: a dispute with a reason we
 * have never seen still produces a payload, because a submission with gaps beats
 * no submission and an empty response is an automatic loss.
 */
export function assembleEvidence(
  reason: string,
  h: EvidenceHoldings,
): AssembledEvidence {
  const playbook = playbookFor(reason);
  const requiredSet = new Set<string>(playbook.required(h.soldKind));
  const wanted = evidenceFieldsFor(reason, h.soldKind);

  const fields: AssembledField[] = wanted.map((field) => {
    const resolved = resolve(field, h);
    return {
      field,
      required: requiredSet.has(field),
      status: resolved.status,
      ...(resolved.value !== undefined ? { value: resolved.value } : {}),
      ...(resolved.ask !== undefined ? { ask: resolved.ask } : {}),
    };
  });

  /*
   * Spend the character budget in playbook order.
   *
   * Required fields come first in `wanted`, so a submission that has to be
   * trimmed loses its persuasive extras and keeps the fields the network
   * actually reads. Silently dropping the reverse is how a complete-looking
   * submission arrives without its proof of delivery.
   */
  const payload: Partial<Record<EvidenceTextField, string>> = {};
  const fileIds: Partial<Record<EvidenceField, string>> = {};
  let spent = 0;

  for (const entry of fields) {
    if (entry.status !== "held" || entry.value === undefined) continue;
    if (isFileField(entry.field)) {
      fileIds[entry.field] = entry.value;
      continue;
    }
    if (spent + entry.value.length > EVIDENCE_TEXT_BUDGET) continue;
    payload[entry.field as EvidenceTextField] = entry.value;
    spent += entry.value.length;
  }

  const required = fields.filter((f) => f.required && f.status !== "not_applicable");
  const heldRequired = required.filter((f) => f.status === "held").length;

  return {
    reason,
    soldKind: h.soldKind,
    fields,
    payload,
    fileIds,
    heldRequired,
    totalRequired: required.length,
    completenessBp:
      required.length === 0 ? 10_000 : Math.round((heldRequired / required.length) * 10_000),
    hasGaps: heldRequired < required.length,
    blockedOnSeller: fields
      .filter((f) => f.status === "needs_seller" && f.required)
      .map((f) => f.field),
    optionalUploads: fields
      .filter((f) => f.status === "needs_seller" && !f.required)
      .map((f) => f.field),
  };
}
