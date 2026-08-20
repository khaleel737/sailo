/**
 * What a caller may hand us for a product, and what we may refuse.
 *
 * The limits, the input shapes and the refusal union — no database, no writes. Its own module
 * because the phone and the REST layer both need to know what a product save accepts, and
 * neither should pull a write path in behind an input type. Refusals are a closed union for the
 * same reason: a caller can exhaustively handle them, and a new one is a compile error at every
 * caller rather than an unhandled string.
 */

import "server-only";
import { type CurrencyPrices, type ProductOption, type VariantOptions } from "@sailo/db/schema";

/** Images kept per product. The gallery is a set, replaced wholesale. */
export const MAX_IMAGES = 8;
/** Downloadable files per product. */
export const MAX_FILES = 10;
/** Tags per product. */
export const MAX_TAGS = 12;
/**
 * Bands and dates per event — spec 50, defined in `@sailo/core` and re-exported
 * here beside the other ceilings.
 *
 * There rather than here because the seller's repeater is a client component
 * and this module is `server-only`: a ceiling the browser cannot see is one the
 * seller meets as a row that silently vanished on save. `MAX_VARIANTS` lives in
 * the same package for the same reason.
 */
export { MAX_SESSIONS, MAX_TIERS } from "@sailo/core/tickets";

export type ProductVariantInput = {
  options: VariantOptions;
  sku?: string | null;
  /** Null means "same as the product" — not free. */
  priceCents?: number | null;
  compareAtCents?: number | null;
  /** This combination's price in each currency the shop quotes — spec 53. */
  currencyPrices?: CurrencyPrices;
  /** Null means "nobody is counting" — not sold out. */
  stockQuantity?: number | null;
  isAvailable?: boolean;
  /** This combination's own preorder promise and ceiling — spec 33. */
  preorderExpectedAt?: Date | null;
  preorderLimit?: number | null;
  /** This combination's own weight and size — spec 51. Null is the product's. */
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  imageUrl?: string | null;
  /**
   * This combination's own sell window — spec 43. Null on either side is "no
   * bound from here", which is what every existing variant means.
   *
   * Narrows the product's window and never widens it; `effectiveSellWindow`
   * decides that at every read, so nothing has to be normalised on the way in.
   */
  sellFrom?: Date | null;
  sellUntil?: Date | null;
};

/**
 * One price band on one event — spec 50.
 *
 * **Identified by `id`, never by name.** A tier carries `sold`, which is the
 * seats already taken against it, so a row matched by its label would lose the
 * count the moment a seller fixed a typo — and `event_tiers_not_oversold`
 * would then let the band sell past a room it had already filled. A row with
 * no id is a new band; a row whose id this product does not have is treated as
 * new for the same reason.
 *
 * `sold` is deliberately absent. It moves only through `claimEventCapacity`'s
 * conditional UPDATE, and a save that could set it would be the read-then-write
 * that spec 50 exists to keep out.
 */
export type EventTierInput = {
  /** The row this edits. Null or absent creates one. */
  id?: string | null;
  name: string;
  description?: string | null;
  /** Zero is a comp or press band, which is a real thing to sell at. */
  priceCents?: number | null;
  /** **Null shares the product's stock** — a band that names a price only. */
  capacity?: number | null;
  /** Most seats in this band one order may take. Null is no cap of its own. */
  maxPerOrder?: number | null;
  /** This band's own window — spec 43's mechanism, early bird's whole point. */
  sellFrom?: Date | null;
  sellUntil?: Date | null;
  /** A comp or press band, reachable by direct link only. */
  isHidden?: boolean;
};

/**
 * One date an event runs on — spec 50.
 *
 * Identified by `id` for exactly the reason a tier is: `sold` lives on the row,
 * and a date matched by its start time would lose its seats the moment a seller
 * moved the class by an hour.
 */
export type EventSessionInput = {
  id?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  /** Null shares the product's stock, as a tier's capacity does. */
  capacity?: number | null;
  location?: string | null;
  joinUrl?: string | null;
  /** Called off. The row stays so its ticket-holders can still be told. */
  isCancelled?: boolean;
};

export type ProductFileInput = {
  name?: string | null;
  url: string;
  sizeBytes?: number | null;
  contentType?: string | null;
  /**
   * Which combination this file belongs to — spec 48. Null is the product
   * default, which is every file that existed before the column.
   */
  variantOptions?: VariantOptions | null;
  /** The seller's own label — "v2", "2026 edition". */
  version?: string | null;
};

/**
 * A product as the caller has already understood it — no strings that still
 * need parsing, no `FormDataEntryValue`, no wording.
 */
export type ProductInput = {
  /** Null creates. An id updates, and must already belong to this shop. */
  id: string | null;
  title: string;
  description?: string | null;
  priceCents: number;
  compareAtCents?: number | null;
  /**
   * The same price in each other currency the shop quotes — spec 53.
   *
   * A currency absent from here is a currency this product cannot be sold in,
   * which is what keeps it off the storefront until a seller has typed a
   * number. Never derived from `priceCents`: nothing in Sailo converts.
   */
  currencyPrices?: CurrencyPrices;

  /* ---- How the price is arrived at, and when it is on sale — spec 43 ---- */

  /**
   * The questions an enquiry form asks — spec 07, `kind: "lead"` only.
   *
   * Labels and flags as the seller typed them; the ids are minted server-side
   * by `normalizeQuestions`, so nothing the browser sends decides a question's
   * identity and a renamed question cannot orphan its own answers.
   */
  leadQuestions?: { label: string; required?: boolean }[];

  /** `fixed` or `pwyw`. Anything else, and anything a kind refuses, is fixed. */
  pricingMode?: string | null;
  /** The PWYW floor. **Null is "not configured"; zero is "free is allowed".** */
  minPriceCents?: number | null;
  /** What the amount field opens on. Null falls back to the list price. */
  suggestedPriceCents?: number | null;
  sellFrom?: Date | null;
  sellUntil?: Date | null;
  /** Whether a closed window hides the product or leaves it reading closed. */
  hideWhenUnavailable?: boolean;

  kind: string;
  categoryId?: string | null;
  tags?: string[];
  /** The seller's own code, for a product sold as one thing. */
  sku?: string | null;
  /** Most units one order may take. Null is no cap beyond stock. */
  maxPerOrder?: number | null;
  options?: ProductOption[];
  variants?: ProductVariantInput[];
  files?: ProductFileInput[];
  imageUrls?: string[];

  trackInventory?: boolean;
  stockQuantity?: number | null;

  /* ---- Running a stockroom — spec 51 ---------------------------------- */

  /** Tell the seller at this count. Null is no alert. */
  lowStockThreshold?: number | null;

  /* ---- Selling what there is none of — spec 33 ------------------------- */

  /** Take orders against stock that has not arrived. */
  preorderEnabled?: boolean;
  /** What the buyer is told *before* they commit. Null is "no date given". */
  preorderExpectedAt?: Date | null;
  /** A ceiling on preorders, separate from stock. Null is uncapped. */
  preorderLimit?: number | null;
  /** What one weighs, in grams. Null is unweighed, which is not zero. */
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;

  /** file | link | code — what a digital order hands over. */
  digitalDelivery?: string | null;
  digitalLinkUrl?: string | null;
  digitalAccessDetails?: string | null;
  /**
   * Where a code comes from — spec 48. Null is the shared string above, which
   * is what every product does today.
   */
  codeSource?: string | null;
  /** The shape of a minted code, under `codeSource: "generated"`. */
  codePattern?: string | null;
  /** Mint a checkable licence key per buyer — spec 48. */
  licenseEnabled?: boolean;
  /** Machines one key may run on at once. Null is unlimited. */
  licenseActivationLimit?: number | null;
  /** Licence length in days. Null never expires. */
  licenseDays?: number | null;
  releaseOnPayment?: boolean;
  downloadLimit?: number | null;
  downloadExpiryDays?: number | null;

  durationMinutes?: number | null;
  serviceMode?: string;
  serviceLocation?: string | null;
  bookingEnabled?: boolean;
  bookingLeadHours?: number;
  /** Quiet minutes either side of an appointment. */
  bookingBufferMinutes?: number | null;

  eventStartsAt?: Date | null;
  eventEndsAt?: Date | null;
  eventJoinUrl?: string | null;

  billingInterval?: string | null;
  /** How many intervals per charge — the `3` in "every 3 months". */
  billingIntervalCount?: number | null;
  trialDays?: number | null;

  /* ---- Membership depth — spec 49 -------------------------------------- */

  /** Cycles the membership runs for. Null is open-ended, which is today. */
  termCycles?: number | null;
  /** Whether the door stays open once the term is paid off. */
  accessAfterTerm?: boolean;
  /** Cycles a member must pay before they may cancel. */
  minimumTermCycles?: number | null;
  /** Days of notice before a period end. Never a refusal — it moves the date. */
  cancelNoticeDays?: number | null;
  /** The seller's own cancellation terms, disclosed at checkout. */
  cancelPolicyNote?: string | null;
  /** The most days a member may freeze for. Null is pausing not offered. */
  pauseMaxDays?: number | null;

  /* ---- Event depth — spec 50 -------------------------------------------- */

  /** NULL single (today) | pick_one | all_access. */
  sessionMode?: string | null;
  /**
   * The event's price bands, or **absent to leave them alone**.
   *
   * The distinction is load-bearing and is not the one the other list fields
   * make: `[]` means "this event has no tiers, delete the ones it had", while
   * `undefined` means "this caller does not edit tiers". The phone posts a
   * whole `ProductInput` to `products.save` without ever having rendered a
   * tier, and a caller that cannot see a list must not be able to empty it.
   */
  tiers?: EventTierInput[];
  /** The dates it runs on. Absent leaves them alone, exactly as `tiers` does. */
  sessions?: EventSessionInput[];
  /** Ask for each attendee's name at checkout. */
  collectAttendeeDetails?: boolean;
  /** online | in_person | hybrid. Null falls back to `serviceMode`. */
  eventMode?: string | null;
  eventVenueName?: string | null;
  eventAddress?: string | null;
  /** The event's own zone, falling back to the shop's. */
  eventTimeZone?: string | null;
  eventRefundPolicy?: string | null;
  eventRefundCutoffHours?: number | null;
  eventAllowSelfCancel?: boolean;

  /* ---- Service depth — spec 51 ------------------------------------------ */

  /** How many people one slot holds. Null is 1, which is today. */
  bookingCapacity?: number | null;
  /** How close to the appointment a buyer may move it. Null is not allowed. */
  rescheduleCutoffHours?: number | null;
  cancelCutoffHours?: number | null;
  /**
   * Who takes bookings for this service — `product_staff`.
   *
   * **`undefined` leaves the assignment alone; `[]` clears it, and clearing it
   * is not the same as nobody.** An empty set means *every* active person in
   * the shop, which is what a single-chair salon means and what `staffFor`
   * answers — so the difference between "this caller did not mention staff"
   * and "the seller unticked everybody" has to survive the trip. A phone
   * saving a title must not silently hand a specialist's service to the whole
   * roster.
   */
  staffIds?: string[];

  inStock?: boolean;
  isFeatured?: boolean;
  isPublished?: boolean;
};

/**
 * Why a save was refused, as a value rather than a sentence.
 *
 * The web form answers in English inside an `ActionState`; a tRPC procedure
 * answers with a code the phone localises. Neither wording belongs here, and
 * putting one here would have meant the other translating it back.
 */
export type SaveProductRefusal =
  | { kind: "no_title" }
  | { kind: "unknown_category" }
  | { kind: "event_needs_start" }
  | { kind: "event_ends_before_start" }
  | { kind: "membership_needs_interval" }
  | { kind: "membership_needs_price" }
  /**
   * A sell window that closes before it opens — spec 43.
   *
   * Almost always a start the seller changed without touching the end, and the
   * product would be permanently unsellable with nothing on any screen saying
   * why: `resolveLines` would answer "not on sale yet" and "no longer
   * available" at the same instant. Cheaper to say so while they are looking at
   * the fields, exactly as `event_ends_before_start` already does.
   */
  | { kind: "sell_window_inverted" }
  /**
   * Pay-what-you-want on a membership.
   *
   * A recurring buyer-chosen amount is a Stripe Price per buyer, and Prices are
   * immutable and per-amount — a hundred members choosing a hundred numbers is
   * a hundred objects to find again at every renewal. Refused with a message
   * rather than silently ignored, the way coupons on memberships already are: a
   * seller who set it and was never told would believe they were selling
   * something they are not.
   */
  | { kind: "pwyw_not_for_membership" }
  | { kind: "join_url_not_public" }
  /*
   * A digital product that delivers by link or by code, with nothing in the
   * field that *is* the good.
   *
   * Refused where a fileless download is not, and the asymmetry is deliberate:
   * files are managed by a separate uploader that the phone's editor does not
   * have, so a seller adding a product there would be blocked from saving a
   * draft they intend to finish on the web. A link and a code are single text
   * fields on every surface that offers the kind at all, so a blank one is not
   * an unfinished draft — it is a product whose buy button leads nowhere.
   */
  | { kind: "digital_needs_delivery"; delivery: "link" | "code" }
  | { kind: "digital_link_not_public" }
  /**
   * A code pattern that cannot be minted from — spec 48.
   *
   * Carries the reason, because the three are genuinely different problems
   * and a seller cannot guess which they hit: too little randomness is a
   * pattern that would be guessable, and `collides_with_scan_codes` is one
   * that folds to the length of a ticket or a member pass — the arithmetic
   * `admitAnyCode` depends on, so it is refused at the point it is typed
   * rather than found at a door.
   */
  | { kind: "code_pattern_invalid"; reason: string }
  /**
   * An event's own time zone that no runtime recognises — spec 50.
   *
   * Refused rather than stored, because every downstream reader falls back to
   * the shop's zone on an unknown value and the seller would never find out:
   * the reminder, the `.ics` and the buyer's page would each quietly use a
   * different clock from the one they typed.
   */
  | { kind: "event_time_zone_unknown" }
  /**
   * An in-person event with nowhere to be, or an online one with no way in.
   *
   * Refused at *publish* rather than at checkout — spec 50 — because the
   * alternative is a buyer paying for a webinar and discovering at the start
   * time that there is no link, which is the worst possible moment.
   */
  | { kind: "event_needs_venue" }
  | { kind: "event_needs_join_url" }
  /**
   * A tier or a date shrunk below the seats it has already sold — spec 50.
   *
   * `event_tiers_not_oversold` is a CHECK constraint, so this is refused by the
   * database whatever anybody does. Refused *here* as well because the database
   * refuses it as an error and not as a sentence: a seller who typed 10 into a
   * band that has sold 12 would otherwise meet a crash on a form they cannot
   * tell what is wrong with. Carries the band's name and the count, because
   * "you have already sold twelve" is the only sentence that says what to type
   * instead.
   *
   * The constraint stays the floor under this: a seat sold in the moment
   * between this check and the write is refused there, which is where a race
   * belongs.
   */
  | { kind: "capacity_below_sold"; level: "tier" | "session"; name: string; sold: number }
  | { kind: "product_limit"; limit: number; planName: string }
  | { kind: "not_found" };

export type SaveProductResult =
  | { ok: true; id: string; slug: string; created: boolean }
  | { ok: false; refusal: SaveProductRefusal };
