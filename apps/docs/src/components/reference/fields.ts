import type {
  bookingResource,
  flowResource,
  flowRunResource,
  contactListResource,
  contactResource,
  disputeResource,
  orderResource,
  productResource,
  shopResource,
  staffResource,
  subscriptionResource,
} from "@sailo/core/wire";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import { PAYMENT_STATUSES } from "@sailo/core/payment-status";
import { PRODUCT_KIND_VALUES } from "@sailo/core/variants";
import { DISPUTE_CASE_TYPES, DISPUTE_STATUSES } from "@sailo/core/disputes";

/**
 * Every field Sailo sends an outside consumer, described once.
 *
 * WHY THIS FILE EXISTS RATHER THAN PROSE ON SIX PAGES
 *
 * `@sailo/core/wire` builds the body of a webhook *and* the body of a
 * `GET /api/v1/orders/{id}` from the same six functions, so there is exactly
 * one vocabulary — and this is its dictionary. Writing it as prose on the pages
 * that need it would mean the order shape described twice (REST and webhooks),
 * and the two copies drifting the first time somebody adds a column.
 *
 * **These cannot drift from the serialisers, and the mechanism is `tsc` rather
 * than a test.** Every list below is `as const`, and every list is followed by
 * an `Exhaustive<…>` alias comparing its names against the real return type of
 * the function that builds the object. Add a field to `orderResource` and
 * typecheck fails here until it is documented; remove one and it fails until
 * the row goes. A test could only check what it was told to check; this checks
 * the thing itself.
 *
 * The check runs in *both* directions on purpose. `Documented extends Actual`
 * catches a row describing a field that no longer ships. `Actual extends
 * Documented` catches a field shipped to every subscriber that nobody wrote
 * down — which is the dangerous one, and the one that is invisible without
 * this.
 *
 * Plain data in a `.ts` module rather than JSX, because two things render it:
 * the field tables on the object pages, and the Markdown at `/llms-full.txt`.
 * One list, two renderings, no third description.
 */

export type Field = {
  readonly name: string;
  /** As a reader needs it, not as TypeScript spells it. `money`, `string | null`. */
  readonly type: string;
  readonly body: string;
};

/**
 * Both directions. Resolves to `true` when the two unions are identical and to
 * `never` — which is a type error at the alias site — when either has a member
 * the other does not.
 */
type Exhaustive<Documented extends string, Actual extends string> = [Documented, Actual] extends [
  Actual,
  Documented,
]
  ? true
  : never;

/** The keys of whatever a serialiser returns, including through a `| null`. */
type KeysOf<T> = keyof NonNullable<T> & string;

/*
 * Enumerations are interpolated from the constants the application itself
 * branches on rather than typed out. A status added to `ORDER_STATUSES` appears
 * in these docs on the same deploy, which is the property a hand-copied list
 * can never have.
 */
const orderStatuses = ORDER_STATUSES.join(", ");
const paymentStatuses = PAYMENT_STATUSES.join(", ");
const productKinds = PRODUCT_KIND_VALUES.join(", ");
const disputeStatuses = DISPUTE_STATUSES.join(", ");
const disputeCaseTypes = DISPUTE_CASE_TYPES.join(", ");

/* -------------------------------------------------------------------------- */
/*  Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Not a serialiser return type, so not exhaustiveness-checked — `money()`
 * returns an inline object literal rather than a named shape. Three fields that
 * have not changed since the API was published, and `resources.test.ts` in
 * `@sailo/core` covers the arithmetic.
 */
export const MONEY_FIELDS = [
  {
    name: "cents",
    type: "number",
    body:
      "The amount in the currency's minor unit, as an integer. Use this for arithmetic — it " +
      "cannot lose a digit to floating point the way a decimal string parsed back to a number can.",
  },
  {
    name: "amount",
    type: "string",
    body:
      "The same amount as a decimal string, for anything a person will read. Currency-aware " +
      "rather than a division by 100: JPY has no minor unit and JOD has three, so dividing by a " +
      "fixed hundred is wrong for about a fifth of the currencies Sailo supports — and wrong by a " +
      "factor of ten or a hundred when it is.",
  },
  {
    name: "currency",
    type: "string",
    body: "ISO 4217, uppercase. Always the shop's currency; Sailo prices one shop in one currency.",
  },
] as const satisfies readonly Field[];

/* -------------------------------------------------------------------------- */
/*  Shop                                                                       */
/* -------------------------------------------------------------------------- */

export const SHOP_FIELDS = [
  { name: "id", type: "string", body: "The shop's id, a UUID. Stable for the life of the shop." },
  {
    name: "object",
    type: '"shop"',
    body: "Always the literal string, so one handler can branch on the kind of thing it was given.",
  },
  {
    name: "handle",
    type: "string",
    body: "The shop's URL segment — the `acme` in `sailo.store/acme`. A seller can change it, so store the `id` as your key and treat this as a display value.",
  },
  { name: "name", type: "string", body: "The shop's display name, as the seller wrote it." },
  {
    name: "currency",
    type: "string",
    body: "ISO 4217. Every money object on every other resource carries this same code.",
  },
  {
    name: "timeZone",
    type: "string",
    body: "IANA, such as `Europe/London`. Every timestamp in the API is UTC ISO 8601 — this is the zone to render them in for the seller, and the one their business day is measured in.",
  },
  { name: "createdAt", type: "string | null", body: "ISO 8601, when the shop was created." },
] as const satisfies readonly Field[];

type _ShopIsComplete = Exhaustive<
  (typeof SHOP_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof shopResource>>
>;

/* -------------------------------------------------------------------------- */
/*  Order                                                                      */
/* -------------------------------------------------------------------------- */

export const ORDER_FIELDS = [
  { name: "id", type: "string", body: "The order's id, a UUID. This is the value `order.*` webhooks carry and the one `GET /orders/{id}` takes." },
  { name: "object", type: '"order"', body: "Always the literal string." },
  {
    name: "status",
    type: "string",
    body: `Where the order is in fulfilment. One of ${orderStatuses}. Separate from payment: an order can be paid and not yet shipped.`,
  },
  {
    name: "paymentStatus",
    type: "string",
    body: `Where the money stands. One of ${paymentStatuses}. \`disputed\` means a chargeback has been opened against it — see the dispute object.`,
  },
  {
    name: "paymentMethod",
    type: "string",
    body: "The rail the buyer chose: `card`, `bank_transfer`, `cod`, `paypal`, `venmo`, or one of the contact rails (`whatsapp`, `telegram`, `instagram`, `email`, `phone`). Only `card` and `paypal` confirm themselves; the rest are marked paid by the seller.",
  },

  { name: "currency", type: "string", body: "ISO 4217. The same code every money object below carries." },
  { name: "subtotal", type: "money", body: "Line items before discount, delivery and tax." },
  { name: "discount", type: "money", body: "What the coupon or affiliate code took off. Zero rather than null when there was none." },
  { name: "deliveryFee", type: "money", body: "What was charged for delivery. Zero on a digital order." },
  { name: "tax", type: "money", body: "Tax charged on this order, where the shop collects it." },
  { name: "total", type: "money", body: "What the buyer actually owes — subtotal minus discount, plus delivery and tax. This is the number to report." },
  { name: "refunded", type: "money", body: "How much has been given back so far. A partial refund leaves `total` untouched and moves this, so compare the two rather than reading `status` alone." },

  { name: "itemCount", type: "number", body: "Total units across all lines, not the number of lines. Two of one product is 2." },

  { name: "customer", type: "object", body: "Who bought it — see the customer table below. Null fields are normal: a digital order needs no phone." },
  { name: "address", type: "object", body: "Where it goes. Every field is null on an order that needs no delivery." },
  { name: "delivery", type: "object", body: "How it gets there, and the tracking details once it has shipped." },
  {
    name: "booking",
    type: "object | null",
    body: "The appointment, on an order for a service. Null — rather than an object of nulls — when there is none, so a consumer can branch on the object itself.",
  },
  { name: "coupon", type: "object | null", body: "`{ code }` if a coupon was used, null otherwise." },
  { name: "affiliate", type: "object | null", body: "`{ code }` if the sale came through an affiliate link, null otherwise." },
  { name: "note", type: "string | null", body: "What the buyer typed at checkout. Never the seller's own private note — that is not sent." },

  { name: "items", type: "object[]", body: "The lines, in the order they were added. See the line item table below." },

  { name: "createdAt", type: "string | null", body: "ISO 8601, when the order was placed." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601, when it last changed." },
] as const satisfies readonly Field[];

type _OrderIsComplete = Exhaustive<
  (typeof ORDER_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof orderResource>>
>;

export const ORDER_CUSTOMER_FIELDS = [
  {
    name: "clientId",
    type: "string | null",
    body: "The contact this order belongs to, readable with `GET /contacts/{id}`. Null on a guest checkout that matched nobody on the list.",
  },
  { name: "name", type: "string | null", body: "As the buyer typed it." },
  { name: "email", type: "string | null", body: "As the buyer typed it. Not evidence of marketing consent — see the contact object for that." },
  { name: "phone", type: "string | null", body: "Normalised before storage." },
] as const satisfies readonly Field[];

type _OrderCustomerIsComplete = Exhaustive<
  (typeof ORDER_CUSTOMER_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof orderResource>["customer"]>
>;

export const ADDRESS_FIELDS = [
  { name: "line1", type: "string | null", body: "Street address." },
  { name: "line2", type: "string | null", body: "Apartment, suite, or whatever the buyer added." },
  { name: "city", type: "string | null", body: "City or town." },
  { name: "region", type: "string | null", body: "State, province or county, where the country has one." },
  { name: "postalCode", type: "string | null", body: "Postal or ZIP code." },
  { name: "country", type: "string | null", body: "ISO 3166-1 alpha-2, uppercase." },
] as const satisfies readonly Field[];

type _AddressIsComplete = Exhaustive<
  (typeof ADDRESS_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof orderResource>["address"]>
>;

export const ORDER_DELIVERY_FIELDS = [
  { name: "method", type: "string | null", body: "`shipping` or `collection`. Null on an order that needs no delivery at all — a digital download, a service." },
  { name: "label", type: "string | null", body: "The rate the buyer picked, in the seller's own words: `Standard`, `Next day`, `Pickup`." },
  { name: "pickupLocation", type: "string | null", body: "Where to collect from, on a `collection` order." },
  { name: "trackingCarrier", type: "string | null", body: "Carrier name, as the seller entered it. Free text rather than an enumeration — sellers ship with local couriers Sailo has never heard of." },
  { name: "trackingNumber", type: "string | null", body: "The consignment number." },
  { name: "trackingUrl", type: "string | null", body: "A link the buyer can follow, where the seller gave one." },
  { name: "shippedAt", type: "string | null", body: "ISO 8601. Set at the same moment `order.shipped` fires." },
] as const satisfies readonly Field[];

type _OrderDeliveryIsComplete = Exhaustive<
  (typeof ORDER_DELIVERY_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof orderResource>["delivery"]>
>;

export const ORDER_BOOKING_FIELDS = [
  { name: "scheduledFor", type: "string | null", body: "ISO 8601, in UTC. Render it in the shop's `timeZone` — an appointment at 09:00 local is not 09:00 to a consumer in another zone." },
  { name: "serviceMode", type: "string | null", body: "`in_person` or `online`." },
  { name: "serviceLocation", type: "string | null", body: "Where it happens, or the joining details for an online booking." },
] as const satisfies readonly Field[];

type _OrderBookingIsComplete = Exhaustive<
  (typeof ORDER_BOOKING_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof orderResource>["booking"]>
>;

export const ORDER_ITEM_FIELDS = [
  { name: "id", type: "string", body: "The line's own id." },
  {
    name: "productId",
    type: "string | null",
    body: "The product, readable with `GET /products/{id}`. Null once the seller has deleted it — the line keeps its own `title` and price, because an order is a record of what was sold and not a join to a catalogue that has moved on.",
  },
  { name: "variantId", type: "string | null", body: "The variant, on a product that has them." },
  { name: "title", type: "string", body: "The product's name as it was at the moment of sale." },
  { name: "variantLabel", type: "string | null", body: "The variant as it was — `Large / Blue`." },
  { name: "sku", type: "string | null", body: "The seller's own code for it." },
  { name: "kind", type: "string", body: `What sort of thing it is. One of ${productKinds}.` },
  { name: "quantity", type: "number", body: "How many of this line." },
  { name: "unitPrice", type: "money", body: "Price for one, at the moment of sale." },
  { name: "subtotal", type: "money", body: "`unitPrice` times `quantity`, before any order-level discount." },
] as const satisfies readonly Field[];

type _OrderItemIsComplete = Exhaustive<
  (typeof ORDER_ITEM_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof orderResource>["items"][number]>
>;

/* -------------------------------------------------------------------------- */
/*  Product                                                                    */
/* -------------------------------------------------------------------------- */

export const PRODUCT_FIELDS = [
  { name: "id", type: "string", body: "The product's id, a UUID." },
  { name: "object", type: '"product"', body: "Always the literal string." },
  { name: "title", type: "string", body: "The product's name." },
  { name: "slug", type: "string", body: "Its URL segment on the storefront — `sailo.store/{handle}/p/{slug}`." },
  { name: "description", type: "string | null", body: "The seller's description, as plain text." },
  { name: "kind", type: "string", body: `One of ${productKinds}. It decides what the rest of the object carries: only \`service\` has a \`booking\`, only \`event\` has an \`event\`, only \`membership\` has a \`membership\`.` },
  { name: "tags", type: "string[]", body: "The seller's own labels. Normalised — lowercased and trimmed — before storage." },

  { name: "price", type: "money", body: "What it sells for, in the shop's currency." },
  {
    name: "compareAt",
    type: "money | null",
    body: "The struck-through 'was' price, where the seller set one. Null rather than equal to `price` when there is no comparison to draw.",
  },

  { name: "trackInventory", type: "boolean", body: "Whether Sailo counts stock for this product at all." },
  {
    name: "stock",
    type: "number | null",
    body: "Units on hand, or null when `trackInventory` is false. **Null means not counted, which is not the same statement as sold out** — a consumer syncing levels into a marketplace listing must not read one as the other.",
  },
  { name: "inStock", type: "boolean", body: "Whether it can be bought right now. Already accounts for `trackInventory`, so this — not `stock` — is the field to gate a listing on." },

  { name: "isPublished", type: "boolean", body: "Whether buyers can see it. A draft is invisible on the storefront but readable through the API." },
  { name: "isFeatured", type: "boolean", body: "Whether the seller pinned it to the top of their shop." },

  { name: "booking", type: "object | null", body: "Appointment settings, on a bookable product. Null on everything else." },
  { name: "event", type: "object | null", body: "`{ startsAt }` on a ticketed event. Null on everything else." },
  { name: "membership", type: "object | null", body: "Recurring billing settings, on a membership product. Null on everything else." },

  { name: "variants", type: "object[]", body: "Empty on `GET /products` — a page of twenty-five products with every variant inline is a large response nobody asked for. Populated on `GET /products/{id}`." },

  { name: "createdAt", type: "string | null", body: "ISO 8601." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601." },
] as const satisfies readonly Field[];

type _ProductIsComplete = Exhaustive<
  (typeof PRODUCT_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof productResource>>
>;

export const PRODUCT_BOOKING_FIELDS = [
  { name: "durationMinutes", type: "number | null", body: "How long one appointment runs." },
  { name: "serviceMode", type: "string | null", body: "`in_person` or `online`." },
  { name: "leadHours", type: "number | null", body: "How far ahead a buyer must book. A same-day cutoff, expressed in hours." },
] as const satisfies readonly Field[];

type _ProductBookingIsComplete = Exhaustive<
  (typeof PRODUCT_BOOKING_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof productResource>["booking"]>
>;

export const PRODUCT_EVENT_FIELDS = [
  { name: "startsAt", type: "string | null", body: "ISO 8601, in UTC. Render it in the shop's `timeZone`. Ticket sales close at this moment." },
  { name: "endsAt", type: "string | null", body: "ISO 8601, in UTC. Optional — plenty of events have no fixed end, and this one closes nothing." },
] as const satisfies readonly Field[];

type _ProductEventIsComplete = Exhaustive<
  (typeof PRODUCT_EVENT_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof productResource>["event"]>
>;

export const PRODUCT_MEMBERSHIP_FIELDS = [
  { name: "interval", type: "string | null", body: "`day`, `week`, `month` or `year`." },
  { name: "intervalCount", type: "number | null", body: "How many of them per charge — the `3` in every 3 months. Read it with `interval`, never alone: `month` on its own would bill a quarterly membership monthly." },
  { name: "trialDays", type: "number | null", body: "Free days before the first charge. Null or zero means none." },
] as const satisfies readonly Field[];

type _ProductMembershipIsComplete = Exhaustive<
  (typeof PRODUCT_MEMBERSHIP_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof productResource>["membership"]>
>;

export const PRODUCT_VARIANT_FIELDS = [
  { name: "id", type: "string", body: "The variant's id — the value an order line's `variantId` carries." },
  { name: "sku", type: "string | null", body: "The seller's own code for this variant." },
  { name: "options", type: "object", body: "The choices that define it, as a plain object: `{ \"Size\": \"Large\", \"Colour\": \"Blue\" }`. Keys are whatever the seller named their option groups." },
  { name: "price", type: "money", body: "Always populated. A variant with no price of its own inherits the product's, so there is no null to handle." },
  { name: "stock", type: "number | null", body: "Units of this variant, or null when the product does not track inventory." },
  { name: "isAvailable", type: "boolean", body: "Whether this particular variant can be bought." },
] as const satisfies readonly Field[];

type _ProductVariantIsComplete = Exhaustive<
  (typeof PRODUCT_VARIANT_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof productResource>["variants"][number]>
>;

/* -------------------------------------------------------------------------- */
/*  Contact                                                                    */
/* -------------------------------------------------------------------------- */

export const CONTACT_FIELDS = [
  { name: "id", type: "string", body: "The contact's id, a UUID." },
  { name: "object", type: '"contact"', body: "Always the literal string." },
  { name: "name", type: "string", body: "Their name. Falls back to the email, then the phone, then `Contact` — never empty." },
  { name: "email", type: "string | null", body: "Lowercased. Null on a contact known only by phone." },
  { name: "phone", type: "string | null", body: "Normalised before storage. Null on a contact known only by email." },
  { name: "tags", type: "string[]", body: "How the seller segments their list, and what a broadcast is targeted by. Normalised the same way stored tags are." },
  { name: "source", type: "string | null", body: "How they arrived — `order`, `api`, `signup`, and so on. Set once, at creation, and not changed by later activity." },
  {
    name: "marketingConsentAt",
    type: "string | null",
    body:
      "ISO 8601 when this person opted in to marketing email, or null if they never did. **This is the field that decides whether you may email them.** Null is not 'unknown' — it is a customer who bought something and never agreed to be mailed. A timestamp rather than a boolean because 'when' is what a regulator asks.",
  },
  { name: "address", type: "object", body: "Their address, where an order has given us one. Every field is null otherwise." },
  { name: "createdAt", type: "string | null", body: "ISO 8601." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601." },
] as const satisfies readonly Field[];

type _ContactIsComplete = Exhaustive<
  (typeof CONTACT_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof contactResource>>
>;

/* -------------------------------------------------------------------------- */
/*  Subscription                                                               */
/* -------------------------------------------------------------------------- */

export const SUBSCRIPTION_FIELDS = [
  {
    name: "id",
    type: "string",
    body:
      "The membership's own id. This is the handle Sailo speaks — no Stripe identifier is ever sent, because `stripeSubscriptionId`, `stripeCustomerId` and `stripeAccountId` all name objects in the *seller's* Stripe account, and shipping them would let anything holding a payload address that account directly.",
  },
  { name: "object", type: '"subscription"', body: "Always the literal string, so one handler can branch on the kind of thing it was given." },
  { name: "status", type: "string", body: "Where the membership stands: `trialing`, `active`, `past_due`, `canceled`, `incomplete` or `unpaid`." },
  { name: "productId", type: "string | null", body: "The product being subscribed to — readable with `GET /products/{id}`." },
  { name: "clientId", type: "string | null", body: "The member — readable with `GET /contacts/{id}`." },
  { name: "price", type: "money", body: "What they pay each interval. Snapshotted at signup: a seller who re-prices the product has not re-priced this member." },
  { name: "currency", type: "string", body: "ISO 4217, matching the money object's own currency." },
  { name: "interval", type: "string", body: "How often it renews — `day`, `week`, `month` or `year`." },
  { name: "intervalCount", type: "number", body: "How many of them per renewal — the `3` in every 3 months. Snapshotted at signup alongside the price, so a seller who changes the product's cycle has not changed this member's." },
  {
    name: "billingMode",
    type: "string",
    body:
      "`stripe` or `manual`. A manual membership is one Sailo raises renewal orders for and a human settles at the door, so nothing will ever arrive from Stripe about it — an integration waiting for a card renewal on one waits forever.",
  },
  { name: "paymentMethod", type: "string | null", body: "The rail a manual member pays on. Null for a card subscription, where Stripe is the rail." },
  {
    name: "currentPeriodEnd",
    type: "string | null",
    body:
      "ISO 8601. What they have already paid through, and **the date to revoke access on** — not the day they cancelled.",
  },
  {
    name: "cancelAtPeriodEnd",
    type: "boolean",
    body:
      "True once the member has asked to stop. They keep access until `currentPeriodEnd`; cutting them off at the cancellation takes away a month they already bought.",
  },
  { name: "canceledAt", type: "string | null", body: "ISO 8601, when they asked to stop. Not when access ends." },
  { name: "trialEndsAt", type: "string | null", body: "ISO 8601, if the membership is in a trial." },
  { name: "startedAt", type: "string | null", body: "ISO 8601, when the membership began." },
  { name: "createdAt", type: "string | null", body: "ISO 8601, when the row was written." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601, when it last changed." },
] as const satisfies readonly Field[];

type _SubscriptionIsComplete = Exhaustive<
  (typeof SUBSCRIPTION_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof subscriptionResource>>
>;

/* -------------------------------------------------------------------------- */
/*  Dispute                                                                    */
/* -------------------------------------------------------------------------- */

export const DISPUTE_FIELDS = [
  { name: "id", type: "string", body: "The dispute's own id." },
  { name: "object", type: '"dispute"', body: "Always the literal string." },
  { name: "orderId", type: "string | null", body: "The sale being charged back — readable with `GET /orders/{id}`." },
  { name: "status", type: "string", body: `Where the case stands with the network. One of ${disputeStatuses}.` },
  {
    name: "caseType",
    type: "string",
    body: `One of ${disputeCaseTypes}. \`inquiry\` is a question from the issuer and has taken no money yet; \`chargeback\` has. The two arrive through the same event, so branch on this before you tell anybody they have lost a sale.`,
  },
  { name: "reason", type: "string | null", body: "Stripe's reason string — `fraudulent`, `product_not_received`, and so on." },
  { name: "networkReasonCode", type: "string | null", body: "The card network's own code, such as `10.4` or `13.1`. Not a Stripe identifier." },
  { name: "network", type: "string | null", body: "The card network the case is with." },
  { name: "amount", type: "money", body: "The disputed sale." },
  { name: "fee", type: "money", body: "Stripe's dispute fee, which is why a £42 chargeback costs £57." },
  { name: "deducted", type: "money", body: "Amount plus fee — what actually left the seller's balance." },
  { name: "currency", type: "string", body: "ISO 4217, matching the money objects above." },
  {
    name: "dueBy",
    type: "string | null",
    body:
      "ISO 8601, the response deadline — usually about twenty days. Null on a case that no longer needs one. **This is the field to hang evidence-gathering off**, since what wins a case normally lives in a helpdesk or a shipping account rather than in Sailo.",
  },
  { name: "evidenceSubmittedAt", type: "string | null", body: "ISO 8601, when a response was sent." },
  { name: "submissionCount", type: "number", body: "How many times evidence has been submitted." },
  {
    name: "completenessBp",
    type: "number | null",
    body:
      "How complete the submission was over its required fields, in basis points. The evidence bundle itself is never sent — it holds the buyer's address, delivery proof and the seller's own account of events, and it exists to go to Stripe rather than to whatever an integration points at.",
  },
  { name: "fundsWithdrawnAt", type: "string | null", body: "ISO 8601, when the money was taken back." },
  { name: "fundsReinstatedAt", type: "string | null", body: "ISO 8601, when it was returned after a win." },
  { name: "openedAt", type: "string | null", body: "ISO 8601, when the network opened the case." },
  { name: "createdAt", type: "string | null", body: "ISO 8601, when the row was written." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601, when it last changed." },
] as const satisfies readonly Field[];

type _DisputeIsComplete = Exhaustive<
  (typeof DISPUTE_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof disputeResource>>
>;

/* -------------------------------------------------------------------------- */
/*  Booking                                                                    */
/* -------------------------------------------------------------------------- */

export const BOOKING_FIELDS = [
  { name: "id", type: "string", body: "The appointment's own id." },
  { name: "object", type: '"booking"', body: "Always the literal string." },
  { name: "orderId", type: "string", body: "The sale that bought this appointment — readable with `GET /orders/{id}`. Always present: an appointment exists because something was ordered." },
  { name: "productId", type: "string", body: "The service booked — readable with `GET /products/{id}`." },
  {
    name: "productTitle",
    type: "string | null",
    body:
      "The service as it is titled **now**, not as it was when the appointment was made. Unlike an order line, which keeps the title it sold under, this is a live read — so a service the seller renames renames itself in every future booking.",
  },
  {
    name: "staffId",
    type: "string | null",
    body:
      "Who is taking it — readable with `GET /staff/{id}`. Null on a shop that books the shop rather than a named person, which is most of them.",
  },
  { name: "staffName", type: "string | null", body: "Their name now, resolved for you so a diary entry does not need a second call." },
  { name: "startsAt", type: "string | null", body: "ISO 8601, when the appointment begins. Read it in the staff member's `timeZone`, or the shop's where they have none." },
  { name: "endsAt", type: "string | null", body: "ISO 8601, when it ends. Derived from the service's duration at the time of booking." },
  {
    name: "seats",
    type: "number",
    body:
      "How many places this claim takes. Always 1 on an exclusive booking; on a class it is how many people came in on one order.",
  },
  {
    name: "isExclusive",
    type: "boolean",
    body:
      "**Read this before mirroring anything into a calendar.** True means the claim holds the whole slot — a one-to-one appointment. False means a seat in a class, where several bookings share one window and do not conflict. Treating every entry as busy will report clashes that are not real, and will book a teacher out of their own class.",
  },
  { name: "createdAt", type: "string | null", body: "ISO 8601, when it was booked. This is what `/bookings` orders by, not `startsAt`." },
] as const satisfies readonly Field[];

type _BookingIsComplete = Exhaustive<
  (typeof BOOKING_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof bookingResource>>
>;

/* -------------------------------------------------------------------------- */
/*  Staff                                                                      */
/* -------------------------------------------------------------------------- */

export const STAFF_FIELDS = [
  { name: "id", type: "string", body: "The roster entry's own id. This is what `staffId` on a booking points at." },
  { name: "object", type: '"staff"', body: "Always the literal string." },
  { name: "name", type: "string", body: "What a buyer sees when picking who they want." },
  {
    name: "email",
    type: "string | null",
    body:
      "Where their own appointment notifications go. Not a login — nothing about this address grants access to the shop.",
  },
  { name: "avatarUrl", type: "string | null", body: "A picture for the booking page, if the seller uploaded one." },
  {
    name: "timeZone",
    type: "string | null",
    body:
      "IANA name. **Null means the shop's own zone, not UTC** — this is the zone their appointment times should be read in, and defaulting a null to UTC will shift every booking for a shop that is not in London.",
  },
  {
    name: "isActive",
    type: "boolean",
    body:
      "Whether they can be booked right now. Somebody stood down goes inactive rather than being deleted, because the appointments already against them have to keep naming somebody — so an inactive person can still be the `staffId` on a future booking.",
  },
  { name: "position", type: "number", body: "Where the seller put them in their own ordering of the roster. `/staff` does not sort by it; it is yours to sort by." },
  { name: "createdAt", type: "string | null", body: "ISO 8601, when they were added." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601, when the entry last changed." },
] as const satisfies readonly Field[];

type _StaffIsComplete = Exhaustive<
  (typeof STAFF_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof staffResource>>
>;

/* -------------------------------------------------------------------------- */
/*  List                                                                       */
/* -------------------------------------------------------------------------- */

export const LIST_FIELDS = [
  { name: "id", type: "string", body: "The list's own id. What you pass to `POST /contacts/{id}/lists`." },
  { name: "object", type: '"list"', body: "Always the literal string." },
  { name: "name", type: "string", body: "What the seller calls it. Unique within a shop, case-folded." },
  { name: "description", type: "string | null", body: "The seller's own note about what this list is for." },
  {
    name: "doubleOptIn",
    type: "boolean",
    body:
      "Whether joining needs a click in the member's own inbox. **The field that decides what a write can achieve**: on a list that asks for it, a join lands as `pending` and no API call will ever produce a subscriber. The one exception is a contact who already carries `marketingConsentAt` for this shop — they have clicked a link for this seller before, and asking twice costs a real join.",
  },
  {
    name: "subscribedCount",
    type: "number",
    body:
      "How many people a send would actually reach. **This is the audience size.** If a seller asks how big a list is, this is the honest answer.",
  },
  {
    name: "pendingCount",
    type: "number",
    body:
      "Added to a double opt-in list and not yet confirmed. On the list, and **not** recipients. Adding this to `subscribedCount` overstates every list a seller has by exactly the number of people who never clicked, which is the commonest way an audience number becomes a lie.",
  },
  { name: "createdAt", type: "string | null", body: "ISO 8601, when the list was made." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601, when it last changed." },
] as const satisfies readonly Field[];

type _ListIsComplete = Exhaustive<
  (typeof LIST_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof contactListResource>>
>;

/* -------------------------------------------------------------------------- */
/*  Flow                                                                       */
/* -------------------------------------------------------------------------- */

export const FLOW_FIELDS = [
  { name: "id", type: "string", body: "The flow's own id. What `/flows/{id}/runs` takes." },
  { name: "object", type: '"flow"', body: "Always the literal string." },
  { name: "name", type: "string", body: "What the seller called it." },
  {
    name: "kind",
    type: "string",
    body:
      "`email` for a sequence the builder drew, `scenario` for a one-step rule wired to an outside app. `/flows` returns `email` unless you ask otherwise, because they are separate screens to a seller.",
  },
  {
    name: "status",
    type: "string",
    body:
      "`draft`, `active` or `paused`. **Only `active` enrols anybody.** A paused flow keeps the people already inside it — their timers keep running and they resume where they were — so pausing is not cancelling.",
  },
  {
    name: "trigger",
    type: "object | null",
    body:
      "What starts the flow: `{ type, config }`, where `config` is the qualifier — which list, which product. Null on a draft nobody finished. The `type` vocabulary is the same one the webhook events use.",
  },
  {
    name: "entryPolicy",
    type: "string",
    body:
      "`once` or `repeat` — whether somebody who already walked this flow may enter it again. A consumer counting sends per person needs it, because `repeat` means the same address can legitimately appear in several runs.",
  },
  {
    name: "steps",
    type: "array",
    body:
      "The nodes in the order the runner walks them, each `{ id, kind }`. Kinds are `send`, `timer`, `branch`, `filter`, `whatsapp` and `action`. The node *bodies* are deliberately absent — that shape is the builder's and the runner's, and reconstructing what a flow does from raw node config would mean reimplementing the parser against something we change.",
  },
  { name: "stepCount", type: "number", body: "How many nodes, so you need not count the array." },
  {
    name: "runs",
    type: "object | null",
    body:
      "`{ total, live, completed, failed, cancelled }`. **Null on the list endpoint** — counting who is inside each flow is a query against a table that grows with every contact who ever entered one, and a page of twenty-five should not pay for it. Fetch one flow to get them. `live` is queued plus waiting together, because both are people still inside the sequence.",
  },
  { name: "activatedAt", type: "string | null", body: "ISO 8601, when it was last switched on. Null on a flow that has never run." },
  { name: "createdAt", type: "string | null", body: "ISO 8601, when it was made." },
  { name: "updatedAt", type: "string | null", body: "ISO 8601, when it last changed." },
] as const satisfies readonly Field[];

type _FlowIsComplete = Exhaustive<
  (typeof FLOW_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof flowResource>>
>;

/* -------------------------------------------------------------------------- */
/*  Flow run                                                                   */
/* -------------------------------------------------------------------------- */

export const FLOW_RUN_FIELDS = [
  { name: "id", type: "string", body: "The run's own id." },
  { name: "object", type: '"flow_run"', body: "Always the literal string." },
  { name: "flowId", type: "string", body: "Which flow — readable with `GET /flows/{id}`." },
  {
    name: "contactId",
    type: "string | null",
    body:
      "The contact, readable with `GET /contacts/{id}`. Null when the flow was entered by an address that has no contact record.",
  },
  { name: "email", type: "string", body: "The address the run is keyed on. This is what `?email=` matches." },
  {
    name: "status",
    type: "string",
    body:
      "`queued`, `waiting`, `done`, `failed` or `cancelled`. **A `waiting` run is not stuck** — it is a timer that has not elapsed yet, and reporting it as a failure is the commonest way to misread this endpoint.",
  },
  {
    name: "currentStep",
    type: "string | null",
    body:
      "The node they are sitting on, matching an `id` in the flow's `steps`. Null once the run is over. This is what tells you *where* somebody stopped.",
  },
  {
    name: "wakeAt",
    type: "string | null",
    body:
      "ISO 8601, when the runner will next look at them. Null when nothing is pending. On a `waiting` run this is when the next step happens.",
  },
  {
    name: "attempt",
    type: "number",
    body: "How many times the current step has been retried. Six is the ceiling, after which the run fails.",
  },
  { name: "enteredAt", type: "string | null", body: "ISO 8601, when they entered the flow. This is what the list orders by." },
  { name: "finishedAt", type: "string | null", body: "ISO 8601, when the run ended, however it ended." },
  {
    name: "lastError",
    type: "string | null",
    body:
      "Why a failed run stopped, as a sentence. Never a stack trace, a driver message or a third party's response body — the runner writes a reason a person can act on, and nothing else reaches this field.",
  },
] as const satisfies readonly Field[];

type _FlowRunIsComplete = Exhaustive<
  (typeof FLOW_RUN_FIELDS)[number]["name"],
  KeysOf<ReturnType<typeof flowRunResource>>
>;
