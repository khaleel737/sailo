/*
 * What each dispute reason has to be answered with.
 *
 * The card networks do not judge a rebuttal on how convincing it reads. They
 * judge it on whether specific named fields are present, and each reason code
 * has its own list — a proof of delivery wins a `product_not_received` and is
 * worth nothing against a `credit_not_processed`. Stripe's dispute form is a
 * flat set of thirty-odd fields with no indication of which ones matter for the
 * case in front of you, which is why a seller filling it in by hand submits the
 * wrong four and loses.
 *
 * So this is the mapping, as data: for every reason Stripe reports, which
 * evidence fields are load-bearing and which merely help. It is the table
 * `assemble.ts` walks to build a submission and the one `readiness.ts` walks to
 * tell a seller — before a dispute ever arrives — what they are missing.
 *
 * Sources are Stripe's dispute categories page and the network code map, plus
 * Visa's Core Rules (18 April 2026) and Mastercard's chargeback guide for the
 * code numbers. Reconciled against `stripe@22.5.0`'s own `Evidence` param
 * interface so every name here is a field that exists.
 */

/** Every field name Stripe's dispute evidence accepts, less the files. */
export const EVIDENCE_TEXT_FIELDS = [
  "access_activity_log",
  "billing_address",
  "cancellation_policy_disclosure",
  "cancellation_rebuttal",
  "customer_email_address",
  "customer_name",
  "customer_purchase_ip",
  "duplicate_charge_explanation",
  "duplicate_charge_id",
  "product_description",
  "refund_policy_disclosure",
  "refund_refusal_explanation",
  "service_date",
  "shipping_address",
  "shipping_carrier",
  "shipping_date",
  "shipping_tracking_number",
  "uncategorized_text",
] as const;

/**
 * The fields that take a Stripe File id rather than a string.
 *
 * Kept apart because they cannot be assembled from the database: each one is an
 * upload, and a submission that puts a sentence where Stripe expects a `file_`
 * id is rejected as a whole — losing the fields that were right along with the
 * one that was not.
 */
export const EVIDENCE_FILE_FIELDS = [
  "cancellation_policy",
  "customer_communication",
  "customer_signature",
  "duplicate_charge_documentation",
  "receipt",
  "refund_policy",
  "service_documentation",
  "shipping_documentation",
  "uncategorized_file",
] as const;

export type EvidenceTextField = (typeof EVIDENCE_TEXT_FIELDS)[number];
export type EvidenceFileField = (typeof EVIDENCE_FILE_FIELDS)[number];
export type EvidenceField = EvidenceTextField | EvidenceFileField;

/**
 * What was sold, because it changes the answer more than the reason does.
 *
 * "The buyer says it never arrived" is answered with a carrier's proof of
 * delivery for a parcel, a download log for a file and an attendance record for
 * an appointment. Same reason code, three different cases, and submitting a
 * tracking number for a digital download is submitting nothing.
 *
 * These are `products.kind` values, so the branch is already in the order row.
 */
export type SoldKind = "physical" | "digital" | "service";

export type ReasonPlaybook = {
  /** Stripe's `dispute.reason`. */
  reason: string;
  /** What to call it in front of a seller. */
  label: string;
  /** The network code(s) this maps to, for the seller's own records. */
  networkCodes: { visa?: string; mastercard?: string; amex?: string };
  /**
   * Whether this is a card dispute at all.
   *
   * SEPA, ACH and Bacs failures arrive through the same webhook and the same
   * `Dispute` object, and none of the card evidence applies to them: there is
   * no issuer to persuade, because the debit was returned by the payer's own
   * bank. A seller shown a "gather your proof of delivery" checklist for an
   * `insufficient_funds` return is being sent to do work that cannot change
   * the outcome. The honest answer is to re-invoice.
   */
  rail: "card" | "bank_debit" | "wallet";
  /**
   * Without these, there is no case. Ordered by how much weight each carries.
   *
   * A function of what was sold rather than a flat list, because that is the
   * distinction that decides them.
   */
  required: (kind: SoldKind) => readonly EvidenceField[];
  /** Worth including when held; never the reason a case is won or lost. */
  persuasive: readonly EvidenceField[];
  /**
   * Whether Visa Compelling Evidence 3.0 can apply.
   *
   * Only ever fraud. CE3.0 is Visa's rule that a merchant who can show two
   * prior undisputed transactions by the same cardholder — with two matching
   * data points and at least 120 days of history — wins a 10.4 pre-arbitration
   * outright, on the reasoning that a genuine fraudster does not shop somewhere
   * twice. It is the only mechanism here that resolves a dispute *without* an
   * issuer weighing anything, and it is the reason `orders.buyerIp` and
   * `orders.buyerDeviceFingerprint` exist. See `ce3.ts`.
   */
  ce3Eligible: boolean;
  /** One line telling the seller what actually decides this one. */
  guidance: string;
};

/**
 * The seller's own written policy, which is evidence in its own right.
 *
 * Visa 13.3 and 13.6 both turn on whether the policy was *disclosed* at
 * purchase, not on what it says — an unlimited-returns shop that never showed
 * the buyer its terms loses to a no-returns shop that did. `orders`
 * timestamps `termsAcceptedAt` server-side for exactly this, and
 * `refund_policy_disclosure` is where that fact is stated.
 */
const POLICY_DISCLOSURE = [
  "refund_policy_disclosure",
  "cancellation_policy_disclosure",
] as const;

/** Who the buyer was and how they reached us — the spine of any fraud answer. */
const IDENTITY = [
  "customer_name",
  "customer_email_address",
  "customer_purchase_ip",
  "billing_address",
] as const;

/** How the thing sold got to them, per kind. */
function deliveryProof(kind: SoldKind): readonly EvidenceField[] {
  switch (kind) {
    case "physical":
      return [
        "shipping_documentation",
        "shipping_tracking_number",
        "shipping_carrier",
        "shipping_date",
        "shipping_address",
      ];
    case "digital":
      /*
       * The download log, and it is the whole case — on its own.
       *
       * `access_activity_log` is where an issuer looks for a digital sale: the
       * timestamps, addresses and file names of the buyer actually taking the
       * goods. `orders.downloadCount` alone cannot produce it — a count is not
       * a log — which is why `downloadEvents` records one row per fetch.
       *
       * `receipt` was required here and has been demoted to persuasive. It is a
       * file, so requiring it left every digital shop with a download log
       * reading as incomplete and an upload prompt they could not clear: the
       * receipt is one Sailo generated and emailed, not something the seller
       * holds a scan of. A complete case should read as complete.
       */
      return ["access_activity_log"];
    case "service":
      return ["service_documentation", "service_date", "access_activity_log"];
  }
}

export const REASON_PLAYBOOKS: readonly ReasonPlaybook[] = [
  {
    reason: "fraudulent",
    label: "Cardholder says they did not authorise this",
    networkCodes: { visa: "10.4", mastercard: "4837", amex: "F29" },
    rail: "card",
    required: (kind) => [...IDENTITY, ...deliveryProof(kind)],
    persuasive: ["customer_signature", "receipt", "product_description"],
    ce3Eligible: true,
    guidance:
      "Won by showing the cardholder is the buyer, not by arguing the sale was fair. " +
      "Two prior undisputed orders from the same person beats every other piece of evidence here.",
  },
  {
    reason: "unrecognized",
    label: "Cardholder does not recognise the charge",
    networkCodes: { visa: "10.4", mastercard: "4837" },
    rail: "card",
    /*
     * Usually a statement-descriptor problem rather than fraud: the buyer
     * bought from "Etheon Ltd" and their statement says something else. The
     * receipt and the product description are what resolve it, and they
     * resolve it more often than any other reason code.
     */
    required: () => ["product_description", "receipt", ...IDENTITY],
    persuasive: ["access_activity_log", "customer_communication"],
    ce3Eligible: true,
    guidance:
      "Most of these are a buyer who did not recognise the shop name on their statement. " +
      "Send the receipt and what was bought before arguing anything.",
  },
  {
    reason: "product_not_received",
    label: "Buyer says it never arrived",
    networkCodes: { visa: "13.1", mastercard: "4855", amex: "C08" },
    rail: "card",
    required: (kind) => deliveryProof(kind),
    persuasive: ["customer_communication", "product_description", "receipt"],
    ce3Eligible: false,
    guidance:
      "Proof of delivery decides it. A tracking number that shows in transit is not delivery — " +
      "ask the carrier for the signed or scanned delivery record.",
  },
  {
    reason: "product_unacceptable",
    label: "Buyer says it arrived damaged or not as described",
    networkCodes: { visa: "13.3", mastercard: "4853", amex: "C31" },
    rail: "card",
    required: () => [
      "product_description",
      "refund_policy",
      ...POLICY_DISCLOSURE,
      "refund_refusal_explanation",
    ],
    persuasive: ["customer_communication", "service_documentation", "receipt"],
    ce3Eligible: false,
    guidance:
      "Turns on what the buyer was shown before paying. Send the listing as it stood and " +
      "the returns policy they agreed to, then explain why a refund was refused.",
  },
  {
    reason: "credit_not_processed",
    label: "Buyer says a promised refund never came",
    networkCodes: { visa: "13.6", mastercard: "4860", amex: "C02" },
    rail: "card",
    required: () => [
      "refund_policy",
      ...POLICY_DISCLOSURE,
      "refund_refusal_explanation",
    ],
    persuasive: ["customer_communication", "cancellation_policy", "receipt"],
    ce3Eligible: false,
    guidance:
      "If the refund was issued, send its record and stop — this is the one reason where " +
      "the fastest answer is usually the true one. If it was refused, the disclosed policy is the case.",
  },
  {
    reason: "duplicate",
    label: "Buyer says they were charged twice",
    networkCodes: { visa: "12.6", mastercard: "4834", amex: "P08" },
    rail: "card",
    required: () => [
      "duplicate_charge_id",
      "duplicate_charge_explanation",
      "duplicate_charge_documentation",
    ],
    persuasive: ["receipt", "product_description", "customer_communication"],
    ce3Eligible: false,
    guidance:
      "Name the other charge and show the two orders are different. If they are the same order " +
      "charged twice, refund it — contesting a real duplicate costs the fee and loses.",
  },
  {
    reason: "subscription_canceled",
    label: "Buyer says they cancelled the subscription",
    networkCodes: { visa: "13.2", mastercard: "4841", amex: "C04" },
    rail: "card",
    required: () => [
      "cancellation_policy",
      ...POLICY_DISCLOSURE,
      "cancellation_rebuttal",
      "access_activity_log",
    ],
    persuasive: ["customer_communication", "receipt", "product_description"],
    ce3Eligible: false,
    guidance:
      "The strongest evidence is that they kept using it after the date they say they cancelled. " +
      "The cancellation terms they accepted come second.",
  },
  {
    reason: "general",
    label: "No reason given",
    networkCodes: {},
    rail: "card",
    /*
     * The issuer told Stripe nothing, so nothing can be targeted. Send the
     * whole file: who bought it, what it was, that it was delivered, and the
     * terms they agreed to.
     */
    required: (kind) => [
      "uncategorized_text",
      "product_description",
      ...IDENTITY,
      ...deliveryProof(kind),
    ],
    persuasive: ["receipt", "customer_communication", "refund_policy"],
    ce3Eligible: false,
    guidance:
      "No category means no target. Send everything held about the order in one narrative.",
  },
  {
    reason: "noncompliant",
    label: "Network rules compliance case",
    networkCodes: {},
    rail: "card",
    required: () => ["uncategorized_text", "uncategorized_file"],
    persuasive: [],
    ce3Eligible: false,
    guidance:
      "A compliance case, not an ordinary chargeback. Contesting a Visa one costs a $500 network " +
      "fee that is only refunded on a win, and Stripe will not accept evidence until that is acknowledged.",
  },
  /*
   * The bank rails. Same webhook, same object, and none of the above applies.
   *
   * A SEPA direct debit the payer's bank returned, an ACH debit that bounced,
   * a cheque that came back. There is no issuer weighing evidence — the money
   * simply did not clear. Enumerated rather than defaulted so the seller is
   * told the truth ("re-invoice, do not gather documents") instead of being
   * handed a card playbook that cannot work.
   */
  ...(
    [
      ["bank_cannot_process", "The buyer's bank could not process the debit"],
      ["check_returned", "The cheque was returned"],
      ["debit_not_authorized", "The buyer's bank says the debit was not authorised"],
      ["incorrect_account_details", "The account details were wrong"],
      ["insufficient_funds", "The buyer had insufficient funds"],
    ] as const
  ).map(
    ([reason, label]): ReasonPlaybook => ({
      reason,
      label,
      networkCodes: {},
      rail: "bank_debit",
      required: () => ["uncategorized_text"],
      persuasive: ["customer_communication"],
      ce3Eligible: false,
      guidance:
        "A returned bank debit, not a card chargeback. Evidence cannot reverse it — " +
        "contact the buyer and take payment another way.",
    }),
  ),
  {
    reason: "customer_initiated",
    label: "Buyer raised a case with the wallet provider",
    networkCodes: {},
    rail: "wallet",
    required: (kind) => [
      "uncategorized_text",
      "product_description",
      ...deliveryProof(kind),
    ],
    persuasive: ["customer_communication", "receipt"],
    ce3Eligible: false,
    guidance:
      "Judged by the wallet provider (Klarna, PayPal) under their own rules rather than by a card " +
      "network. Delivery proof and the buyer conversation are what they read.",
  },
];

const BY_REASON = new Map(REASON_PLAYBOOKS.map((p) => [p.reason, p]));

/**
 * The fallback, resolved once at module load rather than looked up per call.
 *
 * A `Map.get` that "cannot" miss still returns `T | undefined`, and the honest
 * options were an assertion or this. This is better than either: the failure —
 * somebody deleting the `general` entry from the table above — becomes a startup
 * error naming exactly what is wrong, instead of a runtime crash inside a dispute
 * response three months later.
 */
function requirePlaybook(reason: string): ReasonPlaybook {
  const found = BY_REASON.get(reason);
  if (!found) {
    throw new Error(
      `REASON_PLAYBOOKS must contain a \`${reason}\` entry: it is the fallback`,
    );
  }
  return found;
}

const GENERAL_PLAYBOOK = requirePlaybook("general");

/**
 * The playbook for a reason, or the `general` one for anything unrecognised.
 *
 * Never throws and never returns undefined. Stripe adds reason codes — its own
 * type is `string`, not a union, which is the API telling us so — and a dispute
 * that arrives on a reason we have not met must still produce a submission. The
 * `general` playbook is the right fallback because it asks for everything.
 */
export function playbookFor(reason: string): ReasonPlaybook {
  return BY_REASON.get(reason) ?? GENERAL_PLAYBOOK;
}

/** Every field worth sending for this reason and kind, required ones first. */
export function evidenceFieldsFor(
  reason: string,
  kind: SoldKind,
): readonly EvidenceField[] {
  const playbook = playbookFor(reason);
  const required = playbook.required(kind);
  const seen = new Set<string>(required);
  return [...required, ...playbook.persuasive.filter((f) => !seen.has(f))];
}

const FILE_FIELDS = new Set<string>(EVIDENCE_FILE_FIELDS);

export function isFileField(field: string): field is EvidenceFileField {
  return FILE_FIELDS.has(field);
}
