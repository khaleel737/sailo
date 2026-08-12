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
}>;

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
