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
  // Free text shown to the buyer after ordering (bank_transfer, cod)
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
