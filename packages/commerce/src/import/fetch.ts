import "server-only";
import { actingAs, stripe } from "@sailo/payments";
import { mapShopify, type ShopifyProduct } from "./sources/shopify";
import { mapStripe } from "./sources/stripe";
import { EMPTY_BATCH, type ImportSource, type SourceBatch } from "./rows";

/**
 * The network half of each source — spec 47's "a fetcher and a mapper".
 *
 * Every mapping decision lives in `sources/*.ts`, which is pure. What is here
 * is the part that cannot be: a token, a rate limit, a cursor.
 *
 * ## Credentials: collect, use, discard
 *
 * Shopify needs an API token and **it is not stored**. It arrives in the form,
 * it is held for the length of the job, and it goes when the job finishes. A
 * stored third-party token is a credential at rest with no ongoing purpose —
 * the import is a one-off errand, and a seller who wants to re-run it can paste
 * it again. This is deliberately the opposite of spec 31's `integration_apps`:
 * that one is a connection, this one is an errand, and continuous sync is a
 * different spec with a different security posture that must not be smuggled
 * in through this one.
 */

/** One page. Shopify's Admin API caps a product query at 250. */
const PAGE = 100;

/** Enough for a large catalogue; a ceiling so a cursor bug cannot loop. */
const MAX_PAGES = 40;

/** Somebody's else's API on a seller's click. */
const TIMEOUT_MS = 20_000;

export type FetchResult =
  | { ok: true; batch: SourceBatch }
  | { ok: false; reason: string };

/* -------------------------------------------------------------------------- */
/*  Stripe                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The connected account's own catalogue.
 *
 * Nothing is collected: `shops.stripeAccountId` is already connected, which is
 * why this source is first on the list and ungated. `actingAs` is the same
 * `Stripe-Account` header every other read of a seller's account uses, so a
 * shop cannot read anyone's catalogue but its own.
 */
export async function fetchStripe(stripeAccountId: string): Promise<FetchResult> {
  try {
    const [products, prices] = await Promise.all([
      stripe().products.list({ limit: 100, active: true }, actingAs(stripeAccountId)),
      stripe().prices.list({ limit: 100, active: true }, actingAs(stripeAccountId)),
    ]);

    /*
     * `price.product` is `string | Product | DeletedProduct` in the SDK,
     * because Stripe expands it when asked. Nothing here asks, so it is always
     * the id — narrowed rather than cast, so a future `expand` that changes
     * that is a mapping decision made here rather than a silent `[object
     * Object]` key that matches no product at all.
     */
    const mapped = mapStripe(
      products.data,
      prices.data.map((price) => ({
        ...price,
        product: typeof price.product === "string" ? price.product : price.product.id,
      })),
    );
    return {
      ok: true,
      batch: {
        ...EMPTY_BATCH("stripe"),
        ...mapped,
        notes: [
          ...mapped.notes,
          /*
           * One page each, and said out loud. A seller with more than a
           * hundred products would otherwise see a partial catalogue reported
           * as a complete one, which is exactly the silent cap rule 8 is
           * about. Paging is worth adding; pretending is not.
           */
          ...(products.has_more || prices.has_more ? ["first_page_only"] : []),
        ],
      },
    };
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Shopify                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One GraphQL query, paged.
 *
 * Written out rather than built, so what is asked for is readable next to what
 * `mapShopifyProduct` reads. Every field here has a reader; nothing is fetched
 * "in case".
 */
const PRODUCTS_QUERY = `
  query SailoImport($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        descriptionHtml
        handle
        status
        tags
        productType
        options { name values }
        images(first: 8) { nodes { url } }
        collections(first: 5) { nodes { title ruleSet { appliedDisjunctively } } }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            requiresShipping
            selectedOptions { name value }
            image { url }
            inventoryItem {
              tracked
              inventoryLevels(first: 10) {
                nodes { quantities(names: ["available"]) { quantity } }
              }
            }
          }
        }
      }
    }
    shop { currencyCode }
  }
`;

/**
 * A seller's Shopify catalogue.
 *
 * **The store domain is validated, not trusted.** It becomes the host of a
 * request our servers make, so an unchecked value is server-side request
 * forgery with a token attached. Only `*.myshopify.com` is accepted, which is
 * both what every Admin API token is issued against and a hostname whose
 * resolution we do not have to reason about.
 *
 * Rate limits are Shopify's leaky bucket, and a naive loop gets throttled
 * halfway through 200 products. `THROTTLED` is retried once with a pause
 * rather than failing the job — the alternative is a seller watching an import
 * stop at product 137 with no way to resume but starting again.
 */
export async function fetchShopify(input: {
  storeDomain: string;
  token: string;
}): Promise<FetchResult> {
  const host = input.storeDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) {
    return { ok: false, reason: "not_a_shopify_domain" };
  }

  const nodes: ShopifyProduct[] = [];
  let cursor: string | null = null;
  let currency = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await graphql(host, input.token, { first: PAGE, after: cursor });
    if (!answer.ok) return answer;

    const data = answer.data as {
      products?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: ShopifyProduct[];
      };
      shop?: { currencyCode?: string };
    };

    currency ||= data.shop?.currencyCode ?? "";
    nodes.push(...(data.products?.nodes ?? []));

    if (!data.products?.pageInfo?.hasNextPage) {
      return {
        ok: true,
        batch: { ...EMPTY_BATCH("shopify"), ...mapShopify(nodes, currency || "USD") },
      };
    }
    cursor = data.products.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }

  return {
    ok: true,
    batch: {
      ...EMPTY_BATCH("shopify"),
      ...mapShopify(nodes, currency || "USD"),
      // The ceiling reached, named. A catalogue larger than this is real and
      // the seller has to be told which part of it arrived.
      notes: [`paging_capped:${MAX_PAGES * PAGE}`],
    },
  };
}

async function graphql(
  host: string,
  token: string,
  variables: Record<string, unknown>,
  attempt = 0,
): Promise<{ ok: true; data: unknown } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`https://${host}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: PRODUCTS_QUERY, variables }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "bad_token" };
    }
    if (response.status === 404) return { ok: false, reason: "store_not_found" };

    /*
     * Shopify answers 200 with a `THROTTLED` error rather than a 429, so the
     * status code alone never sees it. Retried once after a pause — their
     * bucket refills at a known rate and a single wait clears an ordinary
     * burst; a second failure is a genuinely rate-limited account and the
     * seller is told rather than left in a loop.
     */
    const body = (await response.json()) as {
      data?: unknown;
      errors?: { message?: string; extensions?: { code?: string } }[];
    };

    const throttled = body.errors?.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return graphql(host, token, variables, attempt + 1);
    }
    if (throttled) return { ok: false, reason: "throttled" };

    if (body.errors?.length) {
      return { ok: false, reason: body.errors[0]?.message ?? "shopify_error" };
    }
    if (!response.ok) return { ok: false, reason: `answered_${response.status}` };

    return { ok: true, data: body.data };
  } catch (error) {
    return { ok: false, reason: describe(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A provider's failure, as something a seller can read.
 *
 * The raw message is kept because it is usually the only actionable thing —
 * "Invalid API key" is worth more than "something went wrong" — but it is
 * capped, because it ends up in a jsonb column a seller downloads.
 */
function describe(error: unknown): string {
  return (error instanceof Error ? error.message : "network error").slice(0, 200);
}

/** Which sources need a credential at all, for the form. */
export function needsToken(source: ImportSource): boolean {
  return source === "shopify";
}
