import type { disputeResource, subscriptionResource } from "@sailo/core/wire";

/**
 * The webhook payload shapes that have no REST endpoint behind them.
 *
 * Nine of the sixteen events — the seven `subscription.*` and the two
 * `dispute.*` — carry an object that appears nowhere else in the
 * documentation. Unlike an order or a contact there is no
 * `GET /api/v1/subscriptions/{id}` to read the shape off, and the webhooks page
 * used to send readers to a REST reference that does not describe what they
 * received.
 *
 * Plain data in a `.ts` module rather than inside the component that renders
 * it, because two things need it: the field tables on `/docs/webhooks`, and the
 * Markdown a model reads at `/llms-full.txt`. One list, two renderings.
 *
 * **These cannot drift from the serialisers**, and the mechanism is the
 * `Exhaustive` pair below rather than a test: the lists are `as const`, so
 * `tsc` compares their names against the actual return type of
 * `subscriptionResource` and `disputeResource`. Add a field to either and
 * typecheck fails here until it is documented; remove one and it fails until
 * the row goes.
 */

export type PayloadField = {
  readonly name: string;
  readonly type: string;
  readonly body: string;
};

/**
 * Both directions, which is the point.
 *
 * `Documented extends Actual` catches a row describing a field that no longer
 * exists; `Actual extends Documented` catches a field shipped to every
 * subscriber that nobody wrote down. Only the second is dangerous, and only the
 * second is invisible without this.
 */
type Exhaustive<Documented extends string, Actual extends string> = [Documented, Actual] extends [
  Actual,
  Documented,
]
  ? true
  : never;

export const SUBSCRIPTION_FIELDS = [
  { name: "id", type: "string", body: "The membership's own id. This is the handle Sailo speaks — no Stripe identifier is ever sent, because those address the seller's Stripe account rather than anything you are entitled to." },
  { name: "object", type: '"subscription"', body: "Always the literal string, so one handler can branch on the kind of thing it was given." },
  { name: "status", type: "string", body: "Where the membership stands: active, trialing, past_due, canceled, incomplete or unpaid." },
  { name: "productId", type: "string", body: "The product being subscribed to — readable with GET /api/v1/products/{id}." },
  { name: "clientId", type: "string", body: "The member — readable with GET /api/v1/contacts/{id}." },
  { name: "price", type: "money", body: "What they pay each interval, as the usual money object." },
  { name: "currency", type: "string", body: "ISO 4217, matching the money object's own currency." },
  { name: "interval", type: "string", body: "How often it renews — month or year." },
  { name: "billingMode", type: "string", body: "stripe or manual. A manual membership renews by Sailo raising an order a human settles, so nothing will ever arrive from Stripe about one, and an integration waiting for a card renewal on it waits forever." },
  { name: "paymentMethod", type: "string | null", body: "The rail a manual member pays on. Null for a card subscription." },
  { name: "currentPeriodEnd", type: "string | null", body: "ISO 8601. What they have already paid through, and the date to revoke on rather than the day they cancelled." },
  { name: "cancelAtPeriodEnd", type: "boolean", body: "True once the member has asked to stop. They keep access until currentPeriodEnd — cutting them off at the cancellation takes away a month they bought." },
  { name: "canceledAt", type: "string | null", body: "ISO 8601, when they asked to stop. Not when access ends." },
  { name: "trialEndsAt", type: "string | null", body: "ISO 8601, if the membership is in a trial." },
  { name: "startedAt", type: "string | null", body: "ISO 8601, when the membership began." },
  { name: "createdAt", type: "string | null", body: "ISO 8601, when the row was written." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601, when it last changed." },
] as const satisfies readonly PayloadField[];

type _SubscriptionIsComplete = Exhaustive<
  (typeof SUBSCRIPTION_FIELDS)[number]["name"],
  keyof ReturnType<typeof subscriptionResource> & string
>;

export const DISPUTE_FIELDS = [
  { name: "id", type: "string", body: "The dispute's own id." },
  { name: "object", type: '"dispute"', body: "Always the literal string." },
  { name: "orderId", type: "string | null", body: "The sale being charged back — readable with GET /api/v1/orders/{id}." },
  { name: "status", type: "string", body: "Where the case stands with the network." },
  { name: "caseType", type: "string", body: "inquiry, chargeback or compliance. An inquiry has not taken any money yet." },
  { name: "reason", type: "string | null", body: "Stripe's reason string — fraudulent, product_not_received, and so on." },
  { name: "networkReasonCode", type: "string | null", body: "The card network's own code, such as 10.4 or 13.1." },
  { name: "network", type: "string | null", body: "The card network the case is with." },
  { name: "amount", type: "money", body: "The disputed sale." },
  { name: "fee", type: "money", body: "Stripe's dispute fee, which is why a £42 chargeback costs £57." },
  { name: "deducted", type: "money", body: "Amount plus fee — what actually left the seller's balance." },
  { name: "currency", type: "string", body: "ISO 4217, matching the money objects above." },
  { name: "dueBy", type: "string | null", body: "ISO 8601, the response deadline — usually about twenty days. Null on a case that no longer needs one. This is the field to hang evidence-gathering off." },
  { name: "evidenceSubmittedAt", type: "string | null", body: "ISO 8601, when a response was sent." },
  { name: "submissionCount", type: "number", body: "How many times evidence has been submitted." },
  { name: "completenessBp", type: "number | null", body: "How complete the submission was over its required fields, in basis points. The evidence bundle itself is never sent — it holds the buyer's address and the seller's own account of events, and it exists to go to Stripe rather than to whatever an integration points at." },
  { name: "fundsWithdrawnAt", type: "string | null", body: "ISO 8601, when the money was taken back." },
  { name: "fundsReinstatedAt", type: "string | null", body: "ISO 8601, when it was returned after a win." },
  { name: "openedAt", type: "string | null", body: "ISO 8601, when the network opened the case." },
  { name: "createdAt", type: "string | null", body: "ISO 8601, when the row was written." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601, when it last changed." },
] as const satisfies readonly PayloadField[];

type _DisputeIsComplete = Exhaustive<
  (typeof DISPUTE_FIELDS)[number]["name"],
  keyof ReturnType<typeof disputeResource> & string
>;
