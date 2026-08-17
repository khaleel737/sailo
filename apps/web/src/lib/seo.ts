import type { MarketingDictionary } from "@sailo/i18n/marketing";
import type { DeliveryMethodType } from "@sailo/commerce/delivery";
import type { PaymentMethodType } from "@/lib/payments";
import { centsToAmount } from "@sailo/core/currency";

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

/* -------------------------------------------------------------------------- */
/*  How a shop takes money, in a vocabulary a crawler already knows            */
/* -------------------------------------------------------------------------- */

/**
 * Sailo's payment rails, mapped onto schema.org's.
 *
 * `null` means "this is not a payment method" and is the important half of the
 * table. WhatsApp, Telegram, Instagram, email and phone are how a buyer *places
 * an order*; the money then changes hands off-platform by means we never learn.
 * Declaring them under `paymentAccepted` would be answering a question we do
 * not know the answer to, so a shop that only offers chat rails declares no
 * payment methods at all — which is the truth.
 *
 * A `Record` keyed on the union rather than a lookup with a default: adding a
 * rail should not silently ship a storefront that under-declares itself. The
 * compiler makes the next person decide what the new rail is worth telling
 * Google, even if the answer is `null`.
 *
 * `uri` is GoodRelations where GoodRelations has the term, because that is the
 * vocabulary `acceptedPaymentMethod` was built around and the one validators
 * recognise. `label` is the human string `paymentAccepted` wants.
 */
const PAYMENT_SCHEMA: Record<
  PaymentMethodType,
  { label: string; uri: string } | null
> = {
  // Stripe Checkout offers the wallets alongside the card, so all three are
  // genuinely accepted and worth naming — a buyer scanning a result for
  // "Apple Pay" is looking for exactly this.
  card: {
    label: "Credit Card, Debit Card, Apple Pay, Google Pay, Link, Cash App Pay",
    uri: "https://schema.org/CreditCard",
  },
  bank_transfer: {
    label: "Bank Transfer",
    uri: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
  },
  /*
   * Both are real payment methods rather than order channels, so unlike the
   * chat rails they belong here. GoodRelations has `PayPal` and nothing for
   * Venmo, so Venmo borrows the generic prepayment term — the label carries
   * the name a buyer is actually scanning for.
   */
  paypal: { label: "PayPal", uri: "http://purl.org/goodrelations/v1#PayPal" },
  venmo: {
    label: "Venmo",
    uri: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
  },
  cod: { label: "Cash on Delivery", uri: "http://purl.org/goodrelations/v1#COD" },
  whatsapp: null,
  telegram: null,
  instagram: null,
  email: null,
  phone: null,
};

/** schema.org's `DeliveryMethod` terms for the two ways an order can travel. */
const DELIVERY_SCHEMA: Record<DeliveryMethodType, string> = {
  shipping: "https://schema.org/ParcelService",
  collection: "https://schema.org/OnSitePickup",
};

type Rails = {
  /** The payment rails the buyer can actually use — enabled and configured. */
  payment?: readonly { type: string }[];
  /** The delivery options the buyer can actually pick. */
  delivery?: readonly { type: string }[];
};

function paymentTerms(rails: Rails | undefined) {
  const seen = new Set<string>();
  const terms: { label: string; uri: string }[] = [];

  for (const { type } of rails?.payment ?? []) {
    const term = PAYMENT_SCHEMA[type as PaymentMethodType];
    // `?? null` rather than a truthiness check: an unrecognised type coming
    // out of the database reads as `undefined` here, and that is the same
    // "say nothing" answer as a deliberate `null`.
    if (!term || seen.has(term.uri)) continue;
    seen.add(term.uri);
    terms.push(term);
  }

  return terms;
}

function deliveryTerms(rails: Rails | undefined) {
  const terms = new Set<string>();
  for (const { type } of rails?.delivery ?? []) {
    const term = DELIVERY_SCHEMA[type as DeliveryMethodType];
    if (term) terms.add(term);
  }
  return [...terms];
}

/** A storefront, so a shop's own page can be indexed as the shop it is. */
export function shopJsonLd(
  shop: {
    name: string;
    handle: string;
    description: string | null;
    avatarUrl: string | null;
    location: string | null;
    currency?: string;
  },
  rails?: Rails,
) {
  const payment = paymentTerms(rails);

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
    /*
     * What a buyer can pay with, before they click. This is the one field on a
     * storefront that answers a question every buyer has and no title tag has
     * room for, and Google reads it on `Store` specifically.
     *
     * Comma-separated text, which is the shape `paymentAccepted` is defined
     * with — unlike `acceptedPaymentMethod` on an Offer below, which takes URIs.
     */
    ...(payment.length > 0
      ? { paymentAccepted: payment.map((term) => term.label).join(", ") }
      : {}),
    ...(shop.currency ? { currenciesAccepted: shop.currency.toUpperCase() } : {}),
  };
}

/**
 * The trail above a page, which is what turns a raw URL in a search result into
 * `sailo.store › forno › Sourdough loaf`.
 *
 * Positions are 1-based and must be contiguous — Google drops the whole
 * breadcrumb otherwise — so they are generated here rather than passed in.
 */
export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absolute(crumb.path),
    })),
  };
}

/**
 * One language's blog index, declared as the blog it is.
 *
 * `inLanguage` is the point. Thirty-five indexes that differ only by language
 * need to say which one they are in a field a crawler reads, not only in the
 * `lang` attribute of the document.
 */
export function blogJsonLd(blog: {
  name: string;
  description: string;
  path: string;
  locale: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: blog.name,
    description: blog.description,
    url: absolute(blog.path),
    inLanguage: blog.locale,
    publisher: {
      "@type": "Organization",
      name: "Sailo",
      url: APP_URL,
      logo: absolute("/brand/sailo-mark-512.png"),
    },
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
export function productJsonLd(
  product: {
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
  },
  rails?: Rails,
) {
  const url = absolute(`/${product.shop.handle}/p/${product.slug}`);
  const payment = paymentTerms(rails);
  const delivery = deliveryTerms(rails);

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
      price: centsToAmount(product.priceCents, product.currency),
      priceCurrency: product.currency,
      availability: product.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: product.shop.name },
      /*
       * How this can be paid for and how it travels — URIs here, where the
       * storefront's `paymentAccepted` uses text, because that is what each
       * property is defined to take.
       *
       * Both come from the rails the seller has actually enabled *and*
       * configured, so a shop that connected Stripe and then disconnected it
       * stops claiming cards on the same deploy the button disappears.
       */
      ...(payment.length > 0
        ? { acceptedPaymentMethod: payment.map((term) => term.uri) }
        : {}),
      ...(delivery.length > 0 ? { availableDeliveryMethod: delivery } : {}),
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
