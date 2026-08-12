import { minorPerMajor } from "@/lib/currency";
import type {
  Client,
  Order,
  OrderItem,
  Product,
  ProductVariant,
  Shop,
} from "@/db/schema";

/**
 * What a Sailo object looks like to anything outside Sailo.
 *
 * **One vocabulary, two transports.** These same functions build the body of a
 * webhook and the body of a `GET /api/v1/orders/{id}`, and that is the point:
 * an integration that receives `order.paid` and then fetches the order to
 * check something sees identical field names in both, so a Zapier field map
 * built against one works against the other. Two shapes would be two sets of
 * documentation, two mental models, and a support question every week about
 * why `total` is an object here and a number there.
 *
 * It also fixes the direction of the dependency. Resources are the vocabulary;
 * a webhook is one way of shipping them. `lib/webhooks/events.ts` imports from
 * here, never the reverse.
 *
 * No `server-only` — nothing here touches the database. They take rows the
 * caller already holds and return plain JSON, which is what makes them
 * testable without a database and safe for the docs page to describe.
 *
 * **Nothing internal leaks.** No Stripe ids, no download tokens, no
 * `paymentProofUrl`, no seller's private `notes`. Each of those either
 * identifies an object in someone else's system, or is a credential, or is
 * something the seller wrote for themselves — and none of them are things a
 * consumer can act on.
 */

/* -------------------------------------------------------------------------- */
/*  Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Minor units as a decimal string — 4999 USD cents becomes `"49.99"`.
 *
 * Sent *alongside* the integer, never instead of it, because two readers want
 * different things. A program wants `cents`, which cannot lose a digit to
 * floating point. A person wiring a Zap wants something they can drop into an
 * email without a formatter step — and the single most common integration bug
 * is that person mapping the integer and mailing a customer "you paid 4999".
 *
 * Currency-aware rather than a division by 100: JPY has no minor unit at all
 * and JOD has three, so a fixed hundred is wrong for a fifth of the currencies
 * this app supports, and wrong by a factor of ten or a hundred when it is.
 */
export function decimalAmount(minor: number, currency: string): string {
  const per = minorPerMajor(currency);
  if (per === 1) return String(Math.round(minor));

  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const digits = String(per).length - 1;
  const whole = Math.floor(abs / per);
  const fraction = String(abs % per).padStart(digits, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** `{ cents, amount, currency }`, so no caller has to remember to send both. */
export function money(minor: number | null, currency: string) {
  const cents = minor ?? 0;
  return { cents, amount: decimalAmount(cents, currency), currency };
}

/** ISO 8601 or null — never `undefined`, which JSON would drop entirely. */
export function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/* -------------------------------------------------------------------------- */
/*  Order                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An order, as every `order.*` event and every `/orders` response describes it.
 *
 * One shape for all of them rather than a slimmer one per event: a consumer
 * writing against `order.paid` and later adding `order.refunded` should not
 * have to remap every field, and what differs between those two is which one
 * fired, not what an order is.
 *
 * The customer's name, email, phone and address are here. That is the same
 * personal data `exporters.ts` already writes into the orders CSV a seller can
 * download unaided, which is the boundary `docs/specs/16-outbound-webhooks.md`
 * drew — this does not widen it.
 */
export function orderResource(order: Order, items: readonly OrderItem[]) {
  const currency = order.currency;

  return {
    id: order.id,
    object: "order" as const,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,

    currency,
    subtotal: money(order.subtotalCents, currency),
    discount: money(order.discountCents, currency),
    deliveryFee: money(order.deliveryFeeCents, currency),
    tax: money(order.taxCents, currency),
    total: money(order.totalCents, currency),
    refunded: money(order.refundedCents, currency),

    itemCount: order.itemCount,

    customer: {
      clientId: order.clientId,
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
    },

    address: {
      line1: order.addressLine1,
      line2: order.addressLine2,
      city: order.city,
      region: order.region,
      postalCode: order.postalCode,
      country: order.country,
    },

    delivery: {
      method: order.deliveryMethod,
      label: order.deliveryLabel,
      pickupLocation: order.pickupLocation,
      trackingCarrier: order.trackingCarrier,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      shippedAt: iso(order.shippedAt),
    },

    /*
     * Null rather than an object of nulls when there is no appointment. A
     * consumer branching on `booking` gets a truthy test that works; one
     * branching on `booking.scheduledFor` gets the same answer either way.
     */
    booking: order.scheduledFor
      ? {
          scheduledFor: iso(order.scheduledFor),
          serviceMode: order.serviceMode,
          serviceLocation: order.serviceLocation,
        }
      : null,

    coupon: order.couponCode ? { code: order.couponCode } : null,
    affiliate: order.affiliateCode ? { code: order.affiliateCode } : null,

    note: order.note,

    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      title: item.title,
      variantLabel: item.variantLabel,
      sku: item.sku,
      kind: item.kind,
      quantity: item.quantity,
      unitPrice: money(item.unitPriceCents, currency),
      subtotal: money(item.subtotalCents, currency),
    })),

    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
  };
}

/**
 * A stand-in order, for the "send test event" button on a shop that has never
 * had a real one.
 *
 * Built by handing `orderResource` a complete fabricated row rather than by
 * writing the JSON out by hand, and **every field is stated explicitly** — a
 * partial object would leave the untouched ones `undefined`, JSON would drop
 * them entirely, and the test payload would have a different set of keys from
 * a real one. That is precisely the failure the test button exists to prevent:
 * Zapier builds its whole field map from the first payload it receives, so a
 * seller who maps against a thin sample discovers the mismatch on their first
 * real sale.
 *
 * `resources.test.ts` compares its keys against a real order's and fails if
 * the two ever drift.
 */
export function sampleOrderResource(shop: Pick<Shop, "currency">) {
  const now = new Date();

  const order = {
    id: "00000000-0000-0000-0000-000000000000",
    status: "new",
    paymentStatus: "paid",
    paymentMethod: "card",
    currency: shop.currency,
    subtotalCents: 2500,
    discountCents: 0,
    deliveryFeeCents: 0,
    taxCents: 0,
    totalCents: 2500,
    refundedCents: 0,
    itemCount: 1,
    clientId: null,
    customerName: "Sample Buyer",
    customerEmail: "sample@example.com",
    customerPhone: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    deliveryMethod: null,
    deliveryLabel: null,
    pickupLocation: null,
    trackingCarrier: null,
    trackingNumber: null,
    trackingUrl: null,
    shippedAt: null,
    scheduledFor: null,
    serviceMode: null,
    serviceLocation: null,
    couponCode: null,
    affiliateCode: null,
    note: null,
    createdAt: now,
    updatedAt: now,
  } as unknown as Order;

  const item = {
    id: "00000000-0000-0000-0000-000000000001",
    productId: null,
    variantId: null,
    title: "Sample product",
    variantLabel: null,
    sku: null,
    kind: "digital",
    quantity: 1,
    unitPriceCents: 2500,
    subtotalCents: 2500,
  } as unknown as OrderItem;

  return orderResource(order, [item]);
}

/* -------------------------------------------------------------------------- */
/*  Contact                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A person on a shop's list.
 *
 * `marketingConsentAt` is the field that matters most here: an integration
 * pushing these into Kit or Mailchimp must be able to tell somebody who agreed
 * to be emailed from somebody who merely bought a thing, and a boolean could
 * not carry *when*. A null means no consent, and a consumer that mails them
 * anyway is doing so on its own authority rather than on ours.
 *
 * `notes` is absent by design — that column is the seller's private scratchpad
 * about a customer, and it is the last thing that should be syncable into a
 * third-party CRM by an integration nobody re-read.
 */
export function contactResource(client: Client) {
  return {
    id: client.id,
    object: "contact" as const,
    name: client.name,
    email: client.email,
    phone: client.phone,
    tags: client.tags,
    source: client.source,
    marketingConsentAt: iso(client.marketingConsentAt),
    address: {
      line1: client.addressLine1,
      line2: client.addressLine2,
      city: client.city,
      region: client.region,
      postalCode: client.postalCode,
      country: client.country,
    },
    createdAt: iso(client.createdAt),
    updatedAt: iso(client.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Product                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A product, priced in the shop's currency.
 *
 * Products carry no currency of their own — a shop prices in one — so it is
 * passed in rather than guessed, and the money helper above needs it to know
 * how many decimal places the number has.
 *
 * `stock` is null when the product does not track inventory, which is a
 * different statement from zero. A consumer syncing stock levels into a
 * marketplace listing must not read "not counted" as "sold out".
 */
export function productResource(
  product: Product,
  currency: string,
  variants: readonly ProductVariant[] = [],
) {
  return {
    id: product.id,
    object: "product" as const,
    title: product.title,
    slug: product.slug,
    description: product.description,
    kind: product.kind,
    tags: product.tags,

    price: money(product.priceCents, currency),
    compareAt: product.compareAtCents === null ? null : money(product.compareAtCents, currency),

    trackInventory: product.trackInventory,
    stock: product.trackInventory ? product.stockQuantity : null,
    inStock: product.inStock,

    isPublished: product.isPublished,
    isFeatured: product.isFeatured,

    booking: product.bookingEnabled
      ? {
          durationMinutes: product.durationMinutes,
          serviceMode: product.serviceMode,
          leadHours: product.bookingLeadHours,
        }
      : null,

    event: product.eventStartsAt ? { startsAt: iso(product.eventStartsAt) } : null,

    membership: product.billingInterval
      ? { interval: product.billingInterval, trialDays: product.trialDays }
      : null,

    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      options: variant.options,
      price: money(variant.priceCents ?? product.priceCents, currency),
      stock: product.trackInventory ? variant.stockQuantity : null,
      isAvailable: variant.isAvailable,
    })),

    createdAt: iso(product.createdAt),
    updatedAt: iso(product.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Shop                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The shop the key speaks for — the "who am I" every integration setup screen
 * calls first to prove the credential works and to name what it connected to.
 *
 * Deliberately thin. Nothing about billing, nothing about the owner's account,
 * no contact email: this answers "which shop" and not "tell me everything
 * about this seller".
 */
export function shopResource(shop: Shop) {
  return {
    id: shop.id,
    object: "shop" as const,
    handle: shop.handle,
    name: shop.name,
    currency: shop.currency,
    timeZone: shop.timeZone,
    createdAt: iso(shop.createdAt),
  };
}
