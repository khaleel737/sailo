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
import { type ProductOption, type VariantOptions } from "@sailo/db/schema";

/** Images kept per product. The gallery is a set, replaced wholesale. */
export const MAX_IMAGES = 8;
/** Downloadable files per product. */
export const MAX_FILES = 10;
/** Tags per product. */
export const MAX_TAGS = 12;

export type ProductVariantInput = {
  options: VariantOptions;
  sku?: string | null;
  /** Null means "same as the product" — not free. */
  priceCents?: number | null;
  compareAtCents?: number | null;
  /** Null means "nobody is counting" — not sold out. */
  stockQuantity?: number | null;
  isAvailable?: boolean;
  imageUrl?: string | null;
};

export type ProductFileInput = {
  name?: string | null;
  url: string;
  sizeBytes?: number | null;
  contentType?: string | null;
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
  kind: string;
  categoryId?: string | null;
  tags?: string[];
  options?: ProductOption[];
  variants?: ProductVariantInput[];
  files?: ProductFileInput[];
  imageUrls?: string[];

  trackInventory?: boolean;
  stockQuantity?: number | null;

  releaseOnPayment?: boolean;
  downloadLimit?: number | null;
  downloadExpiryDays?: number | null;

  durationMinutes?: number | null;
  serviceMode?: string;
  serviceLocation?: string | null;
  bookingEnabled?: boolean;
  bookingLeadHours?: number;

  eventStartsAt?: Date | null;
  eventJoinUrl?: string | null;

  billingInterval?: string | null;
  trialDays?: number | null;

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
  | { kind: "membership_needs_interval" }
  | { kind: "membership_needs_price" }
  | { kind: "join_url_not_public" }
  | { kind: "product_limit"; limit: number; planName: string }
  | { kind: "not_found" };

export type SaveProductResult =
  | { ok: true; id: string; slug: string; created: boolean }
  | { ok: false; refusal: SaveProductRefusal };
