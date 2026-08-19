/**
 * What a buyer may ask for, and what a seller may lawfully refuse.
 *
 * Spec 52, and the decision table below **is** the spec. Every row of it is one
 * category of what Sailo holds about a buyer and one verdict about what happens
 * when they ask for it to be deleted — with the reason on the row, because "a
 * refusal is an answer" and an answer without a reason is a shrug.
 *
 * Pure, and here rather than in `@sailo/account` beside the queries, for the
 * usual reason: this is the part with the judgement in it, it runs a handful of
 * times a month, and a mistake in it is discovered as a regulator's letter
 * rather than as a failing build. Every branch is reachable from a test with no
 * fixtures.
 *
 * ## The one people get wrong
 *
 * `email_suppressions` is **never erased**. A suppression is how somebody's
 * objection is honoured; deleting it re-subscribes them the next time the seller
 * imports a list — the one "deletion" that does the exact opposite of what was
 * asked. It is stated in the response for the same reason it is enforced in the
 * code: a buyer told "everything is gone" who then receives a newsletter has
 * been lied to twice.
 */

export const DATA_REQUEST_KINDS = ["access", "erasure", "portability"] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];

export function isDataRequestKind(value: unknown): value is DataRequestKind {
  return (
    typeof value === "string" && (DATA_REQUEST_KINDS as readonly string[]).includes(value)
  );
}

export const DATA_REQUEST_STATUSES = [
  "pending",
  "verifying",
  "in_progress",
  "fulfilled",
  "refused",
  "withdrawn",
] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

/** The statuses the partial unique index treats as one live request. */
export const LIVE_REQUEST_STATUSES: readonly DataRequestStatus[] = [
  "pending",
  "verifying",
  "in_progress",
];

/**
 * The statutory window: one month from the request.
 *
 * GDPR Article 12(3). A column and not a computation because the clock is the
 * whole point of the feature and the seller's queue sorts on it.
 */
export const DATA_REQUEST_WINDOW_DAYS = 30;

/**
 * When the seller should be nudged: a week left.
 *
 * Late enough that a seller who was always going to answer is not pestered,
 * early enough that assembling an export and reading it is still a calm
 * afternoon rather than an evening.
 */
export const DATA_REQUEST_NUDGE_DAYS = 7;

/**
 * How long a verification link lives.
 *
 * Seven days, the same as the subscribe and signup families. Long enough for
 * somebody who asked on a Friday, short enough that a link sitting in an old
 * inbox is not a standing erasure primitive for whoever gets that inbox next.
 */
export const VERIFY_TOKEN_TTL_DAYS = 7;

/**
 * How long an assembled export stays fetchable.
 *
 * Short deliberately, and shorter than the request window: the file is the
 * concentrated form of everything this feature exists to protect, and every
 * extra day is a day it can be forwarded, indexed or left in a downloads folder.
 * Seven days is long enough to notice the email.
 */
export const EXPORT_TTL_DAYS = 7;

/**
 * The clock starts at **verification**, not at submission.
 *
 * Before the address is verified there is no request from anybody — the form is
 * open to the internet, and treating an unverified submission as a statutory
 * request would let a stranger start a thirty-day timer against a seller by
 * typing somebody else's email. It is also why `dueBy` is null until then.
 */
export function dueBy(verifiedAt: Date): Date {
  return new Date(verifiedAt.getTime() + DATA_REQUEST_WINDOW_DAYS * 86_400_000);
}

/** Whole days left, negative once overdue. Null when nothing is running. */
export function daysLeft(due: Date | null, now = new Date()): number | null {
  if (!due) return null;
  return Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/*  The decision table                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What happens to one category of data on an erasure request.
 *
 *   `erase`         — the row or the field goes.
 *   `pseudonymise`  — the row stays and the identifiers are replaced with a
 *                     stable surrogate. Everything a money row points at is
 *                     this: the alternative breaks the ledger, and spec 03
 *                     already decided it for sellers.
 *   `retain`        — it stays, and the response says which data, why, and for
 *                     how long.
 *   `never_erase`   — it stays *because erasing it would harm the person who
 *                     asked*. Exactly one category is this, and it is the one
 *                     people get wrong.
 *   `already_anonymous`
 *                   — there is nothing there to erase, because the rows hold no
 *                     identifier for this person at all.
 *
 * That last verdict is not in the spec's table, and it is here because the
 * alternative was to lie. The spec lists `visits`, `clicks` as "erase or
 * de-identify" — but both are keyed on a rotating `sessionId` that is derived
 * per visitor and never stored against an email or a client id. There is no
 * query that could select this person's rows. Reporting that as "erased" would
 * be a claim about a delete that did not happen, on the one feature whose whole
 * output is a truthful statement about what was done; reporting it as "retained"
 * would tell a buyer we still hold something about them when we do not.
 */
export type ErasureVerdict =
  | "erase"
  | "pseudonymise"
  | "retain"
  | "never_erase"
  | "already_anonymous";

export type ErasureRule = {
  /** The table or field group, as the spec's own table names it. */
  category: string;
  verdict: ErasureVerdict;
  /** What a buyer is told, in the response. Plain, and true. */
  reason: string;
  /**
   * Whether the verdict depends on the dispute window still being open.
   *
   * `buyerIp`, `buyerUserAgent`, `buyerDeviceFingerprint` and `download_events`
   * are retained *while a chargeback can still arrive* and erased afterwards —
   * which is a real deadline, not a euphemism, and `EVIDENCE_RETENTION_DAYS`
   * in `@sailo/core/disputes` is the number.
   */
  whileDisputeWindowOpen?: boolean;
};

/**
 * One entry per row of spec 52's table, in its order.
 *
 * The spec says every row gets a named test, and it does — `privacy.test.ts`
 * walks this array. Adding a category means adding a row here first, which is
 * what keeps the response and the code the same list.
 */
export const ERASURE_RULES: readonly ErasureRule[] = [
  {
    category: "contact_details",
    verdict: "pseudonymise",
    reason:
      "Your name, phone number, address and any tags on your customer record are replaced with an anonymous reference. The record itself stays because your orders point at it.",
  },
  {
    category: "marketing_consent",
    verdict: "erase",
    reason: "Your marketing consent and any list membership are deleted outright.",
  },
  {
    category: "visits_and_clicks",
    verdict: "already_anonymous",
    reason:
      "Analytics about page views and outbound clicks are recorded against a rotating visitor id and never against your email address, so they hold nothing that identifies you and there is nothing there to erase.",
  },
  {
    category: "order_messages",
    verdict: "retain",
    reason:
      "Emails sent to you about an order are kept as tax and chargeback evidence for 400 days from the message.",
  },
  {
    category: "orders_and_invoices",
    verdict: "retain",
    reason:
      "Orders, order lines and invoices are kept because tax law requires it — commonly six to ten years — and because the invoice sequence must stay unbroken.",
  },
  {
    category: "purchase_identifiers",
    verdict: "retain",
    whileDisputeWindowOpen: true,
    reason:
      "The IP address, browser and device fingerprint recorded when you paid are kept while a bank can still reverse the payment, then erased.",
  },
  {
    category: "download_events",
    verdict: "retain",
    whileDisputeWindowOpen: true,
    reason:
      "The record of files you downloaded is kept while a bank can still reverse the payment, then erased.",
  },
  {
    category: "email_suppressions",
    verdict: "never_erase",
    /*
     * The sentence that has to be in the response, not just in the code.
     * Somebody told "everything is gone" who then receives a newsletter has been
     * lied to twice, and the second time is the one they act on.
     */
    reason:
      "If you have unsubscribed or complained, that record is kept permanently and on purpose. It is how the shop knows never to email you again — deleting it would put you back on the list.",
  },
  {
    category: "tickets_and_memberships",
    verdict: "pseudonymise",
    reason:
      "The name and email on any ticket are replaced. The ticket, membership and check-in records themselves are kept while your access is live and are anonymous once it ends.",
  },
] as const;

export type ErasureCategory = (typeof ERASURE_RULES)[number]["category"];

const BY_CATEGORY = new Map(ERASURE_RULES.map((rule) => [rule.category, rule]));

/** The verdict for one category. Throws on an unknown one — see the note. */
export function erasureRuleFor(category: string): ErasureRule {
  const rule = BY_CATEGORY.get(category);
  if (!rule) {
    /*
     * Loudly, and at the call site rather than as a silent `retain`. A category
     * the table has never heard of is a piece of personal data somebody added
     * without deciding what happens to it on an erasure — which is the one
     * failure this module exists to make impossible.
     */
    throw new Error(`ERASURE_RULES has no entry for \`${category}\``);
  }
  return rule;
}

/** Everything actually removed or replaced, for the confirmation screen. */
export const ERASED_CATEGORIES = ERASURE_RULES.filter(
  (rule) => rule.verdict === "erase" || rule.verdict === "pseudonymise",
);

/** Categories that hold no identifier for the person in the first place. */
export const ANONYMOUS_CATEGORIES = ERASURE_RULES.filter(
  (rule) => rule.verdict === "already_anonymous",
);

/** Everything that stays, with the reason, for the confirmation and the reply. */
export const RETAINED_CATEGORIES = ERASURE_RULES.filter(
  (rule) => rule.verdict === "retain" || rule.verdict === "never_erase",
);

/* -------------------------------------------------------------------------- */
/*  Refusals                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The reasons a seller may give, as a closed list.
 *
 * A picklist and not free text. A refusal is a legal position, and a sentence
 * typed at the keyboard by somebody who wants the queue to be shorter is a legal
 * position nobody reviewed. Four entries, because there are four honest reasons.
 */
export const REFUSAL_REASONS = [
  {
    id: "not_our_data",
    label: "We hold nothing for this address",
    body: "We could not find any record of this email address in our shop.",
  },
  {
    id: "legal_obligation",
    label: "The law requires us to keep it",
    body: "We must keep the records this request covers to meet tax and accounting obligations.",
  },
  {
    id: "legal_claims",
    label: "It is needed for a live dispute",
    body: "We are keeping these records while a payment dispute or legal claim about this order is open.",
  },
  {
    id: "manifestly_unfounded",
    label: "Repeated or excessive request",
    body: "We have already answered this request and no new information has been given.",
  },
] as const;

export type RefusalReasonId = (typeof REFUSAL_REASONS)[number]["id"];

export function isRefusalReason(value: unknown): value is RefusalReasonId {
  return (
    typeof value === "string" &&
    REFUSAL_REASONS.some((reason) => reason.id === value)
  );
}

export function refusalBody(id: string): string | null {
  return REFUSAL_REASONS.find((reason) => reason.id === id)?.body ?? null;
}

/* -------------------------------------------------------------------------- */
/*  The one sentence a public form is allowed to say                          */
/* -------------------------------------------------------------------------- */

/**
 * The same answer whatever it found.
 *
 * A form that says "we have no record of that address" is a customer-list
 * oracle anybody can point at a shop, and one that says "check your inbox" only
 * for known addresses is the same tool with its answers inverted. This is the
 * finding `applyAsAffiliate` and the subscribe page already carry, applied to a
 * form whose subject is *precisely* whether a person is in a database.
 *
 * `unavailable` is separate and is **not an answer about the request**. Decision
 * B has this endpoint failing closed — it is an existence oracle and it writes —
 * so a refusal on `verdict.reason === "outage"` has to read as "we could not
 * check", exactly as `COUPON_MESSAGES.unavailable` does.
 */
export const DATA_REQUEST_MESSAGES = {
  received:
    "Thanks. If we hold anything for that address, we've sent a link there to confirm it's you. Nothing happens until you click it.",
  unavailable: "We couldn't take that request just now. Try again in a moment.",
  invalidEmail: "That doesn't look like an email address.",
} as const;
