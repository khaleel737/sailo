/**
 * Shopify → the shared row shape — spec 47.
 *
 * **The substantial one.** Every other platform in this category is built for
 * digital products; a Shopify seller is the migrant Sailo can serve and its
 * competitors cannot, and the one with the most data to move — which is
 * exactly why they do not move.
 *
 * Pure. The Admin GraphQL call lives in `../fetch.ts`; this takes the nodes it
 * returns and produces `ImportProduct`, so every mapping decision below can be
 * exercised from a JSON literal with no token and no network.
 */

import { moneyToCents } from "@sailo/core/currency";
import { MAX_OPTIONS, MAX_VARIANTS, normalizeOptions } from "@sailo/core/variants";
import { htmlToText } from "@sailo/core/html-text";
import type { ProductOption, VariantOptions } from "@sailo/db/schema";
import type { ImportProduct, ImportVariant, SourceBatch } from "../rows";

/** The shape of a product node, narrowed to what is actually read. */
export type ShopifyProduct = {
  id: string;
  title?: string | null;
  descriptionHtml?: string | null;
  handle?: string | null;
  status?: string | null;
  tags?: string[] | null;
  productType?: string | null;
  options?: { name?: string | null; values?: string[] | null }[] | null;
  images?: { nodes?: { url?: string | null }[] | null } | null;
  collections?: { nodes?: { title?: string | null; ruleSet?: unknown }[] | null } | null;
  variants?: { nodes?: ShopifyVariant[] | null } | null;
};

export type ShopifyVariant = {
  id: string;
  title?: string | null;
  sku?: string | null;
  price?: string | null;
  compareAtPrice?: string | null;
  /** `requires_shipping` on the variant is how Shopify models a digital good. */
  requiresShipping?: boolean | null;
  selectedOptions?: { name?: string | null; value?: string | null }[] | null;
  image?: { url?: string | null } | null;
  /**
   * Per-location counts. Summed, and the report says so — Sailo has no
   * multi-location model, and silently importing one location's count
   * oversells everything in the others.
   */
  inventoryItem?: {
    tracked?: boolean | null;
    inventoryLevels?: { nodes?: { quantities?: { quantity?: number | null }[] | null }[] | null } | null;
  } | null;
};

/**
 * A single product node, mapped.
 *
 * Every decision here is one the spec wrote down, and the comments name the
 * failure each avoids rather than restating the rule.
 */
export function mapShopifyProduct(
  node: ShopifyProduct,
  currency: string,
): ImportProduct {
  const notes: string[] = [];

  const variantNodes = (node.variants?.nodes ?? []).filter(Boolean).slice(0, MAX_VARIANTS);
  if ((node.variants?.nodes?.length ?? 0) > MAX_VARIANTS) {
    notes.push(`variants_capped:${MAX_VARIANTS}`);
  }

  /*
   * `requiresShipping = false` is how a Shopify seller models a digital good,
   * and getting it wrong makes every ebook ask for a shipping address.
   *
   * Asked of every variant rather than the first: a product with one shippable
   * combination is a physical product, whatever the others say.
   */
  const shippable = variantNodes.some((v) => v.requiresShipping !== false);
  const kind = variantNodes.length > 0 && !shippable ? "digital" : "physical";
  if (kind === "digital") {
    /*
     * The file is not transferred and cannot be: it lives behind Shopify's
     * auth, and fetching it would mean holding a credential to pull arbitrary
     * bytes. The product is created with the slot empty and the report says so,
     * which turns the gap into the seller's checklist.
     */
    notes.push("digital_needs_file");
  }

  const options = readOptions(node.options ?? []);
  if ((node.options?.length ?? 0) > MAX_OPTIONS) notes.push(`options_capped:${MAX_OPTIONS}`);

  const variants = variantNodes.map((v) => mapVariant(v, options, currency, notes));

  /*
   * The product's own price is the first variant's, because Shopify has no
   * product-level price at all. Without this every product would import at
   * zero and a variant that inherits — one whose price equals the product's —
   * would inherit nothing.
   */
  const first = variants[0];
  const priceCents = first?.priceCents ?? 0;

  return {
    externalId: node.id,
    title: (node.title ?? "").trim(),
    /*
     * Stripped to text through the shared sanitiser. Shopify's `body_html`
     * carries their theme's markup — inline styles, section wrappers, script
     * tags — and writing it into `description` puts another shop's stylesheet
     * on this storefront.
     */
    description: node.descriptionHtml ? htmlToText(node.descriptionHtml) : null,
    priceCents,
    compareAtCents: first?.compareAtCents ?? null,
    kind,
    categoryName: readCollection(node, notes),
    tags: (node.tags ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 12),
    sku: variants.length === 1 ? (first?.sku ?? null) : null,
    options,
    /*
     * A product Shopify sells as one thing has a single unnamed variant. Sailo
     * models that as no variants at all, so it is dropped — otherwise every
     * imported product would grow a "Default Title" option nobody chose.
     */
    variants: options.length === 0 ? [] : variants,
    imageUrls: (node.images?.nodes ?? [])
      .map((i) => i?.url)
      .filter((url): url is string => typeof url === "string" && url.startsWith("https://"))
      .slice(0, 8),
    trackInventory: variantNodes.some((v) => v.inventoryItem?.tracked === true),
    stockQuantity:
      options.length === 0 && variants.length > 0 ? (first?.stockQuantity ?? null) : null,
    // `ACTIVE` → published; `DRAFT` and `ARCHIVED` → not. A draft that arrived
    // live is a product a seller had deliberately hidden, now for sale.
    isPublished: (node.status ?? "").toUpperCase() === "ACTIVE",
    notes,
  };
}

function mapVariant(
  v: ShopifyVariant,
  options: ProductOption[],
  currency: string,
  notes: string[],
): ImportVariant {
  const combination: VariantOptions = {};
  for (const selected of v.selectedOptions ?? []) {
    const name = selected?.name?.trim();
    const value = selected?.value?.trim();
    if (name && value && options.some((o) => o.name === name)) combination[name] = value;
  }

  /*
   * Every amount through `moneyToCents` with the *target* currency.
   *
   * Shopify prices are decimal strings — `"19.99"` — and a flat `/100` across
   * fourteen call sites once turned ¥1,000 into ¥10 and charged a KWD seller
   * ten times over (`PRODUCTION-PLAN.md` §2 item 1). An import is a bulk
   * write, so that bug arrives two hundred times at once.
   */
  const price = moneyToCents(v.price ?? "", currency);
  const compare = v.compareAtPrice ? moneyToCents(v.compareAtPrice, currency) : null;

  const levels = v.inventoryItem?.inventoryLevels?.nodes ?? [];
  const quantities = levels.flatMap((l) => l?.quantities ?? []);
  const summed = quantities.reduce((total, q) => total + (q?.quantity ?? 0), 0);

  /*
   * Summed across locations, **and the report says so**. Sailo has no
   * multi-location model; importing one location's count would oversell, and
   * importing the sum without saying so leaves a seller wondering why their
   * warehouse and their shop counter have become one number.
   */
  if (levels.length > 1) {
    const note = `stock_summed:${levels.length}`;
    if (!notes.includes(note)) notes.push(note);
  }

  return {
    options: combination,
    sku: v.sku?.trim() || null,
    priceCents: price,
    // A strike-through only means something above its own price.
    compareAtCents: compare !== null && price !== null && compare > price ? compare : null,
    stockQuantity: v.inventoryItem?.tracked === true ? summed : null,
    isAvailable: true,
    imageUrl: typeof v.image?.url === "string" ? v.image.url : null,
    externalId: v.id,
  };
}

/**
 * The option axes, normalised to what Sailo can hold.
 *
 * Shopify allows three and so does Sailo, so the arity is a match rather than
 * a promise — `MAX_OPTIONS` is the number both agree on, and it is read from
 * `@sailo/core/variants` rather than written here so the day one of them moves
 * is a compile-time fact rather than a silently truncated import.
 *
 * A single unnamed axis is Shopify's "this product has no options" and comes
 * back empty.
 */
function readOptions(raw: NonNullable<ShopifyProduct["options"]>): ProductOption[] {
  const usable = raw
    .map((o) => ({
      name: (o?.name ?? "").trim(),
      values: (o?.values ?? []).map((v) => String(v).trim()).filter(Boolean),
    }))
    .filter((o) => o.name && o.values.length > 0)
    .filter((o) => !(o.name === "Title" && o.values.length === 1 && o.values[0] === "Default Title"))
    .slice(0, MAX_OPTIONS);

  return normalizeOptions(usable);
}

/**
 * The seller's own grouping, and the one kind of collection that is not one.
 *
 * **Custom collections only.** A smart collection is a *query* — "everything
 * under £20" — and importing its current members freezes a rule into rows, so
 * the shop ends up with a category that stops being true the moment a price
 * changes. Detected by `ruleSet` being present, which is how the Admin API
 * distinguishes them.
 */
function readCollection(node: ShopifyProduct, notes: string[]): string | null {
  const nodes = node.collections?.nodes ?? [];
  const custom = nodes.find((c) => c && !c.ruleSet && c.title?.trim());
  const smart = nodes.some((c) => c?.ruleSet);
  if (smart) notes.push("smart_collection_skipped");
  return custom?.title?.trim() ?? null;
}

/** Every node, as one batch. */
export function mapShopify(
  nodes: ShopifyProduct[],
  currency: string,
): Omit<SourceBatch, "source"> {
  return {
    currency,
    products: nodes.map((node) => mapShopifyProduct(node, currency)),
    notes: [],
  };
}
