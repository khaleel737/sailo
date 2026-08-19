/**
 * Stripe → the shared row shape — spec 47.
 *
 * First on the list only because it is nearly free: the seller has already
 * connected an account, so there are no credentials to collect and the read is
 * `products.list` + `prices.list` on `shops.stripeAccountId`.
 *
 * Pure. The API calls live in `../fetch.ts`.
 */

import { MAX_VARIANTS } from "@sailo/core/variants";
import type { ProductOption } from "@sailo/db/schema";
import type { ImportProduct, ImportVariant, SourceBatch } from "../rows";

/** Narrowed to what is read, so a fixture is a literal rather than a mock. */
export type StripeProductLike = {
  id: string;
  name?: string | null;
  description?: string | null;
  active?: boolean | null;
  images?: string[] | null;
};

export type StripePriceLike = {
  id: string;
  product: string;
  active?: boolean | null;
  currency?: string | null;
  unit_amount?: number | null;
  nickname?: string | null;
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
};

/**
 * Prices grouped onto their product.
 *
 * A Stripe product with several prices becomes a product with variants, named
 * by the price's nickname — which is the only human label Stripe carries. A
 * product with one price is sold as one thing, with no options at all.
 */
export function mapStripe(
  products: StripeProductLike[],
  prices: StripePriceLike[],
): Omit<SourceBatch, "source"> {
  const byProduct = new Map<string, StripePriceLike[]>();
  for (const price of prices) {
    if (price.active === false) continue;
    const list = byProduct.get(price.product);
    if (list) list.push(price);
    else byProduct.set(price.product, [price]);
  }

  /*
   * The currency the *source* quotes, for the mismatch refusal.
   *
   * Taken from the prices rather than from the account, because a Stripe
   * account can hold prices in several currencies and the one that matters is
   * the one attached to what is being imported. Where they disagree among
   * themselves, the first is reported and `planImport` refuses the run — which
   * is the honest answer: a catalogue priced in two currencies has no single
   * number to import.
   */
  const currency =
    prices.find((p) => p.active !== false && p.currency)?.currency?.toUpperCase() ?? null;

  const mapped: ImportProduct[] = [];

  for (const product of products) {
    const notes: string[] = [];
    const list = (byProduct.get(product.id) ?? []).slice(0, MAX_VARIANTS);

    if (list.length === 0) {
      /*
       * A product with no active price cannot be sold, and importing it at
       * zero would put a free product on the storefront. Skipped as a row with
       * a reason rather than dropped, so the report says why the count is
       * lower than the seller expected.
       */
      mapped.push(emptyRow(product, "no_active_price"));
      continue;
    }

    /*
     * A recurring price is a membership, and this build does not import one.
     *
     * The mapping exists — `kind: "membership"` with `billingInterval` — but
     * a membership carries a cached Stripe Price, a billing cycle and an
     * access model, and minting one from an import would create a product that
     * looks subscribable and has no subscription behind it. The row is skipped
     * and named, which is the honest half of the feature.
     */
    const recurring = list.filter((p) => p.recurring);
    if (recurring.length > 0 && recurring.length === list.length) {
      mapped.push(emptyRow(product, "recurring_not_imported"));
      continue;
    }
    if (recurring.length > 0) notes.push("recurring_prices_skipped");

    const oneOff = list.filter((p) => !p.recurring);
    const first = oneOff[0];
    if (!first) {
      mapped.push(emptyRow(product, "no_active_price"));
      continue;
    }

    const options: ProductOption[] =
      oneOff.length > 1
        ? [
            {
              name: "Option",
              values: oneOff.map((p, index) => priceLabel(p, index)),
            },
          ]
        : [];

    const variants: ImportVariant[] =
      oneOff.length > 1
        ? oneOff.map((p, index) => ({
            options: { Option: priceLabel(p, index) },
            sku: null,
            // Already minor units — Stripe's own unit, so nothing is multiplied
            // and nothing is divided. The bug this avoids is the reverse of
            // Shopify's: treating an integer as a decimal string.
            priceCents: p.unit_amount ?? null,
            compareAtCents: null,
            stockQuantity: null,
            isAvailable: true,
            imageUrl: null,
            externalId: p.id,
          }))
        : [];

    mapped.push({
      externalId: product.id,
      title: (product.name ?? "").trim(),
      description: product.description?.trim() || null,
      priceCents: first.unit_amount ?? 0,
      compareAtCents: null,
      /*
       * `digital`, because a Stripe catalogue is not a warehouse: a product
       * there has no weight, no shipping and no stock, and importing it as
       * physical would put a delivery address in front of every buyer. The
       * file slot is empty and the report says so.
       */
      kind: "digital",
      categoryName: null,
      tags: [],
      sku: null,
      options,
      variants,
      imageUrls: (product.images ?? []).filter(
        (url): url is string => typeof url === "string" && url.startsWith("https://"),
      ),
      trackInventory: false,
      stockQuantity: null,
      isPublished: product.active !== false,
      notes: [...notes, "digital_needs_file"],
    });
  }

  return { currency, products: mapped, notes: [] };
}

/** Stripe's only human label for a price, with a fallback that is stable. */
function priceLabel(price: StripePriceLike, index: number): string {
  return price.nickname?.trim() || `Option ${index + 1}`;
}

/**
 * A row that exists only to be reported.
 *
 * It carries the title so the seller recognises it and a reason so they know
 * why it is not in their catalogue. `planImport` fails it on the empty title
 * if there is not even one — which is the right outcome and the right message.
 */
function emptyRow(product: StripeProductLike, reason: string): ImportProduct {
  return {
    externalId: product.id,
    title: (product.name ?? "").trim(),
    description: null,
    priceCents: 0,
    compareAtCents: null,
    kind: "digital",
    categoryName: null,
    tags: [],
    sku: null,
    options: [],
    variants: [],
    imageUrls: [],
    trackInventory: false,
    stockQuantity: null,
    isPublished: false,
    notes: [],
    refusal: reason,
  };
}
