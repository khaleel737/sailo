/**
 * The shapes stored in `jsonb` columns.
 *
 * Separate from the tables because both the tables and the application read
 * them, and a column's type shouldn't drag a table definition along with it.
 */

export type VisitBreakdownJson = {
  countries?: Record<string, number>;
  cities?: Record<string, number>;
  sources?: Record<string, number>;
  devices?: Record<string, number>;
  referrers?: Record<string, number>;
  /** Outbound click hosts, folded in from `clicks` — where visitors went next. */
  destinations?: Record<string, number>;
};

export type ShopSocial = {
  platform: string;
  url: string;
};

/**
 * Which seller-facing emails a shop has switched off.
 *
 * Absence of a key means ON — `{}` is "everything", so a new event type ships
 * enabled for every existing shop without a backfill. Written only through the
 * zod schema in `lib/notification-prefs.ts`, which rejects unknown keys.
 */
export type NotificationPrefs = Partial<{
  /** Any settled or manual order. */
  orderPlaced: boolean;
  /** A service order with a requested slot, awaiting confirm/decline. */
  bookingRequested: boolean;
  /** A buyer reported a manual payment or uploaded proof. */
  orderNeedsAction: boolean;
  /** Somebody started a recurring membership. */
  membershipStarted: boolean;
  /** A member asked to stop, or their membership ran out. */
  membershipCancelled: boolean;
  /** A renewal payment failed and the membership is now past due. */
  membershipPaymentFailed: boolean;
  /**
   * Revenue in one place has reached 70% or 90% of a registration threshold.
   *
   * Sent at most twice per place per year and only where a published figure
   * exists — see `packages/core/src/money/tax-thresholds.ts`. It states what
   * was collected and where; it never says a seller must register anywhere.
   */
  taxThreshold: boolean;
  /**
   * Stock has fallen to the threshold the seller set — spec 51.
   *
   * One email per downward crossing, claimed in the same conditional UPDATE
   * that reads the count, and re-armed only when stock is back above the line.
   * A seller adjusting stock in a spreadsheet-like screen crosses the threshold
   * several times in a minute and hears once.
   */
  lowStock: boolean;
}>;

/**
 * One row's price in one currency, in that currency's minor units.
 *
 * `price` is the amount charged. `secondary` is whatever second number the row
 * already has beside its own price — a product's compare-at, a delivery rate's
 * free-over threshold, a coupon's minimum subtotal — and it is one field rather
 * than three because the reader is identical in all three cases, and a shape
 * per table would be three validators that can disagree.
 *
 * The rules live in `packages/core/src/money/regional.ts`, which is where this
 * is read and written; the type is here because four tables store it and a
 * column's shape should not drag a package edge along with it.
 */
export type CurrencyPrice = {
  price: number;
  secondary?: number | null;
};

/** `{ "EUR": { price: 2500, secondary: 3000 } }`, keyed by ISO 4217 uppercase. */
export type CurrencyPrices = Record<string, CurrencyPrice>;

/** One axis of choice on a product: "Size" with "Small", "Medium", "Large". */
export type ProductOption = {
  name: string;
  values: string[];
};

/** A variant's pick on each axis, keyed by option name. */
export type VariantOptions = Record<string, string>;

/**
 * Who a broadcast goes to, as stored.
 *
 * A rule is a tagged object rather than a column per question, because the
 * questions a seller wants to ask — bought this, never bought anything,
 * lapsed since March, came in through the signup form — do not stop arriving,
 * and each one as a column would be a migration and a form field for a
 * combination nobody had asked for yet. The tag is the only part the database
 * knows about; `lib/broadcasts/segments.ts` owns what each one means and is
 * the only thing allowed to turn one into SQL.
 *
 * Stored, not recomputed into a member list: an audience is a *question*, and
 * the answer moves. A broadcast queued on Tuesday and sent on Friday asks it
 * again at queue time, so somebody who bought on Wednesday is included and
 * somebody who unsubscribed on Thursday is not.
 */
export type SegmentRule = {
  /** See `SEGMENT_RULE_TYPES` — parsing rejects anything else. */
  type: string;
  /** A uuid, a tag, a country code — whatever the type names. */
  value?: string;
  /** Days, a count, or minor units, depending on the type. */
  n?: number;
};

export type SegmentFilter = {
  /** `all` intersects the rules, `any` unions them. */
  match: "all" | "any";
  rules: SegmentRule[];
};

/** Union of every rail's settings — only the keys for that type are used. */
export type PaymentConfig = {
  // Contact rails
  phone?: string; // whatsapp, phone
  username?: string; // telegram, instagram
  address?: string; // email
  // Bank transfer
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  iban?: string;
  swift?: string;
  /**
   * US wallet handles, stored bare — no `@`, no `$`, no URL. `buildHandoff`
   * strips those on the way in rather than at every read, because a handle
   * that is sometimes decorated and sometimes not builds a link that is
   * sometimes broken.
   */
  venmoHandle?: string;
  paypalMe?: string;
  // Free text shown to the buyer after ordering (bank_transfer, cod, venmo, paypal)
  instructions?: string;
};

/** Union of every delivery type's settings. */
export type DeliveryConfig = {
  /** shipping: "2–3 working days" */
  estimate?: string;
  /** collection: where to pick up */
  address?: string;
  /** collection: opening hours */
  hours?: string;
  instructions?: string;
};

/**
 * One checkout question and the answer this buyer gave, as both read at the
 * time.
 *
 * The label and type ride along rather than being resolved from
 * `contact_fields` when the order is displayed, because the whole reason this
 * is snapshotted is that the field can be deleted or retyped afterwards — and
 * an invoice reprinted next year has to say what it said. `value` is the same
 * shape `contact_field_values.value` holds, so one renderer serves both.
 */
export type OrderCustomField = {
  key: string;
  label: string;
  /** One of `FIELD_TYPES` in `@sailo/marketing/contacts`. */
  type: string;
  value: string | number | boolean | null;
};

/**
 * One row of a shipping rate's weight table — spec 51.
 *
 * "Up to 500 g costs £3.50." Read cheapest-first and matched on the *first*
 * band the parcel fits, so the boundaries are inclusive upper bounds and a
 * 500 g parcel takes the 500 g band rather than the next one up.
 *
 * Grams and minor units, both integers, for the same reason: a float on either
 * side of a boundary is a rounding argument — with a carrier on one side and a
 * buyer on the other.
 */
export type WeightBand = {
  /** Inclusive upper bound, in grams. */
  upToGrams: number;
  /** What this band costs, in the shop's minor units. */
  priceCents: number;
};

/* --------------------------------------------------------------------------
   Automations — spec 30

   The graph is stored rather than compiled, and that is the design: keeping it
   serialisable is what makes the whole of the runner's behaviour testable from
   object literals, with no database and no mail. `packages/marketing/src/
   automations/graph.ts` is the only thing that may parse one, and it validates
   on save *and again at claim time*.
-------------------------------------------------------------------------- */

/** What enrols a contact. `config` is read by the trigger's own parser. */
export type AutomationTrigger = {
  type: string;
  config?: Record<string, unknown>;
};

/**
 * One step.
 *
 * `config` is deliberately loose here and strict in `graph.ts`. This type
 * describes the column; the parser describes the vocabulary, and putting the
 * vocabulary in the schema package would mean the db and the marketing package
 * had to be edited together to add a step kind.
 */
export type AutomationNode = {
  id: string;
  /** send | timer | branch | filter | whatsapp — see `NODE_KINDS`. */
  kind: string;
  config?: Record<string, unknown>;
};

/**
 * One connection.
 *
 * `label` is what a branch's paths are told apart by — `"yes"`, `"no"`, or a
 * path index. Absent on the single edge leaving a linear node.
 */
export type AutomationEdge = {
  from: string;
  to: string;
  label?: string;
};

export type AutomationGraph = {
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  /** Where a run starts. Must name a node. */
  entry?: string;
};
