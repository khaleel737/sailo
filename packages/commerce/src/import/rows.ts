/**
 * The one shape every source produces — spec 47.
 *
 * The architecture rule the spec opens with is *"one write path, six readers"*:
 * each source is a **fetcher** and a **mapper** that produce this, and
 * everything downstream — the preview, the write, the failure report — is
 * shared. Six importers would be six places for the money parsing, the slug
 * collision handling and the consent rule to drift.
 *
 * Pure. No database, no network, no `server-only` — which is what lets
 * `plan.test.ts` drive every branch from object literals and a committed
 * fixture, the shape `assemble.ts` and `segments.ts` already use.
 */

import type { ProductOption, VariantOptions } from "@sailo/db/schema";

/** The sources this build reads. */
export const IMPORT_SOURCES = ["stripe", "shopify", "etsy", "gumroad", "csv"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export function isImportSource(value: unknown): value is ImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(String(value));
}

/**
 * Sources a seller pays for, and the two that are free.
 *
 * Stripe, Etsy and CSV are ungated, and that is a decision rather than an
 * oversight: Etsy is a CSV upload with no API cost to us, and it is the
 * migration this product's own marketing promises — `layout.tsx` ships
 * "Etsy alternative" as a targeting keyword. Gating it would be charging for
 * the door.
 */
export const GATED_SOURCES: readonly ImportSource[] = ["shopify", "gumroad"];

/**
 * One variant, as any source describes it.
 *
 * `priceCents` null means "same as the product", which is not the same as
 * free, and `stockQuantity` null means "nobody is counting", which is not the
 * same as sold out. Both distinctions are carried all the way from the source
 * file to the column; collapsing either is how an import sells a catalogue for
 * nothing or marks it all out of stock.
 */
export type ImportVariant = {
  options: VariantOptions;
  sku: string | null;
  priceCents: number | null;
  compareAtCents: number | null;
  stockQuantity: number | null;
  isAvailable: boolean;
  /** The source's URL. Re-hosted at the write, never stored as given. */
  imageUrl: string | null;
  externalId: string | null;
};

/** One product, as any source describes it. */
export type ImportProduct = {
  /** The source's own id. The key `import_links` re-runs against. */
  externalId: string;
  title: string;
  description: string | null;
  priceCents: number;
  compareAtCents: number | null;
  /** physical | digital | service. Never `membership` from an import. */
  kind: string;
  /** The seller's own grouping, by name. Created on demand at the write. */
  categoryName: string | null;
  tags: string[];
  sku: string | null;
  options: ProductOption[];
  variants: ImportVariant[];
  /** Source URLs, in gallery order. Re-hosted at the write. */
  imageUrls: string[];
  trackInventory: boolean;
  stockQuantity: number | null;
  isPublished: boolean;
  /**
   * Notes the *mapper* produced, which the report shows against this row.
   *
   * "Sum, and say so in the report" — inventory summed across Shopify
   * locations, a digital listing whose file has to be uploaded by hand, a
   * smart collection that was not imported because it is a query rather than a
   * list. Each is a thing that happened to a row and is invisible unless it is
   * said, which is what makes this field the opposite of a silent cap.
   */
  notes: string[];
  /**
   * A reason this row must not be written at all, or absent.
   *
   * Set by the *mapper*, for the things only it can know: a Stripe product
   * with no active price would import at zero and put a free product on the
   * storefront, and a recurring price is a membership, which carries a billing
   * cycle and an access model an import cannot mint.
   *
   * A skip and not a failure, because nothing is wrong — the row is simply not
   * something this importer creates, and the report says which so the count
   * being lower than the seller expected has an answer.
   */
  refusal?: string;
};

/**
 * What one source produced, before anything is written.
 *
 * `currency` is the source's, not the shop's, and it is carried here so the
 * preview can refuse a mismatch. "Currency mismatch is a refusal, not a
 * conversion": a shop trading in EUR importing USD-priced Shopify products
 * must be stopped at the preview and told, not silently converted at a rate
 * nobody recorded.
 */
export type SourceBatch = {
  source: ImportSource;
  currency: string | null;
  products: ImportProduct[];
  /**
   * Anything the *fetch* could not do — a page of the catalogue that failed,
   * a collection type that was skipped. Distinct from a row's notes, because
   * these describe the run rather than a product.
   */
  notes: string[];
};

/**
 * **Contacts are deliberately not here.**
 *
 * Spec 47 maps a source's customers onto `clients`, and this build does not:
 * importing people is governed by a rule with real consequences — *"consent is
 * a thing a person gave, and a column in a CSV is a claim that they did"* — and
 * a half-built path that carries a `marketingConsentAt` field nothing writes is
 * one refactor away from writing it. `consent-write-paths.test.ts` keeps an
 * allowlist of every file that may touch that column for exactly this reason,
 * and a type declaration is not a good enough reason to be on it.
 *
 * When contacts land, the rule is the one `addClient` and the API's
 * `POST /contacts` already state: consent only where the source carries a real
 * timestamp **and** a level — Shopify does, Gumroad's export does not — and
 * everything else arrives as a contact rather than an audience.
 */
export const EMPTY_BATCH = (source: ImportSource): SourceBatch => ({
  source,
  currency: null,
  products: [],
  notes: [],
});
