import type { MarketingDictionary } from "@/i18n/marketing";

/**
 * Everything a crawler reads.
 *
 * Two rules hold this file together. Metadata mirrors copy that is actually on
 * the page — the descriptions come out of the marketing dictionary, so a
 * rewrite can't leave the `<head>` describing a page that no longer exists.
 * And structured data is built from the same objects the page renders, so the
 * FAQ in the markup and the FAQ in the JSON-LD are the same six questions.
 */

/**
 * The canonical origin. Vercel supplies the production domain at build time;
 * `NEXT_PUBLIC_APP_URL` wins where it's set, and localhost is the last resort
 * so a dev build doesn't emit absolute URLs pointing at production.
 */
export const APP_URL = normalizeOrigin(
  process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000"),
);

function normalizeOrigin(value: string) {
  try {
    // Trailing slashes turn every canonical into a near-duplicate of itself.
    return new URL(value).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export const absolute = (path: string) => new URL(path, APP_URL).toString();

/**
 * The product itself, for the knowledge panel and for anything that wants to
 * know what Sailo is without parsing the page.
 */
export function softwareJsonLd(m: MarketingDictionary) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Sailo",
    url: APP_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: m.seo.description,
    // The free tier is real and unlimited in time, so this is a claim we can
    // stand behind rather than a nominal zero.
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    publisher: {
      "@type": "Organization",
      name: "Sailo",
      url: APP_URL,
      logo: absolute("/brand/sailo-mark-512.png"),
    },
  };
}

export function faqJsonLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };
}

/** A storefront, so a shop's own page can be indexed as the shop it is. */
export function shopJsonLd(shop: {
  name: string;
  handle: string;
  description: string | null;
  avatarUrl: string | null;
  location: string | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Store",
    name: shop.name,
    url: absolute(`/${shop.handle}`),
    ...(shop.description ? { description: shop.description } : {}),
    ...(shop.avatarUrl ? { image: shop.avatarUrl } : {}),
    ...(shop.location
      ? { address: { "@type": "PostalAddress", addressLocality: shop.location } }
      : {}),
  };
}

/**
 * A product, in the shape Google reads for rich results.
 *
 * This is the difference between a plain blue link and a result carrying a
 * price, a stock state and a star rating — which for a seller whose whole
 * shopfront is a link is worth more than any amount of copy. The offer is the
 * part search engines actually validate, so `price`, `priceCurrency` and
 * `availability` are always present rather than conditional.
 */
export function productJsonLd(product: {
  title: string;
  slug: string;
  description: string | null;
  images: { url: string }[];
  priceCents: number;
  currency: string;
  inStock: boolean;
  avgRating: number | null;
  reviewCount: number;
  shop: { name: string; handle: string };
}) {
  const url = absolute(`/${product.shop.handle}/p/${product.slug}`);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    url,
    ...(product.description ? { description: product.description } : {}),
    ...(product.images.length > 0
      ? { image: product.images.map((image) => image.url) }
      : {}),
    brand: { "@type": "Brand", name: product.shop.name },
    offers: {
      "@type": "Offer",
      url,
      // Schema.org wants a decimal string, not our integer cents.
      price: (product.priceCents / 100).toFixed(2),
      priceCurrency: product.currency,
      availability: product.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: product.shop.name },
    },
    /*
     * Omitted entirely when there are no reviews. An aggregateRating with a
     * count of zero is a structured-data error in Search Console, not a
     * neutral statement, and it can cost the whole rich result.
     */
    ...(product.reviewCount > 0 && product.avgRating !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.avgRating.toFixed(1),
            reviewCount: product.reviewCount,
          },
        }
      : {}),
  };
}
