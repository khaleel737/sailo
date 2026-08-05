import type { Handoff } from "@/lib/payments";
import type { Totals } from "@/lib/pricing";
import type { QuoteLine } from "@/lib/quote";
import type { Product, ProductVariant } from "@/db/schema";

/**
 * The shapes an order passes through, in one place.
 *
 * Kept out of the server-action file on purpose: a `"use server"` module may
 * only export async functions, so every type it needed had to be re-declared
 * or re-exported by hand. Here they are importable from anywhere.
 */

export type OrderAddress = {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

/** One thing the buyer wants, as the browser asks for it. */
export type OrderLineInput = {
  productId: string;
  /** Which combination of the product's options the buyer picked. */
  variantId?: string;
  quantity: number;
  /** ISO instant from the booking picker, for a service line. */
  scheduledFor?: string;
};

export type OrderIntentInput = {
  shopId: string;
  /** One line for "buy now", several for a cart. */
  items: OrderLineInput[];
  paymentMethod: string;
  deliveryMethodId?: string;
  couponCode?: string;
  affiliateCode?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  note?: string;
} & OrderAddress;

/** Past this a "cart" is a data-entry mistake, not a shopping trip. */
const MAX_LINES = 50;

export type ResolvedLine = QuoteLine & {
  product: Product;
  variant: ProductVariant | null;
  scheduledFor: Date | null;
};

/**
 * Turns what the browser asked for into what the shop will actually sell:
 * real products, real variants, real prices. Nothing the client sent about
 * money survives this function.
 *
 * `strict` fails the whole order on the first unusable line — right when a
 * buyer is committing. The cart preview is lenient instead, dropping bad lines
 * so the rest of the basket still prices.
 */

export type OrderIntentResult =
  | {
      ok: true;
      orderId: string;
      handoff: Handoff | null;
      /** Populated for bank transfer so the buyer can pay. */
      bankDetails?: { label: string; value: string }[];
      instructions?: string;
      methodName: string;
      totals: Totals;
      currency: string;
      invoiceUrl: string | null;
      invoiceNumber: string | null;
      /** Set when a digital order's files are already unlocked. */
      downloadUrl: string | null;
      /** Set when they unlock once the seller confirms payment. */
      downloadPending: boolean;
      /** Present when the shop runs a referral programme. */
      referral: { code: string; url: string; percent: string } | null;
    }
  | { ok: false; error: string };

/** What the order sheet needs to label the tax line, or null when tax is off. */
export type PreviewTax = {
  name: string;
  rateBp: number;
  inclusive: boolean;
} | null;

/** A priced line, as the cart draws it. */
export type PreviewLine = {
  productId: string;
  variantId: string | null;
  title: string;
  label: string;
  kind: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
  /** Units left, or null when nobody is counting. */
  unitsLeft: number | null;
};

export type OrderPreview = {
  totals: Totals;
  currency: string;
  tax: PreviewTax;
  lines: PreviewLine[];
  /** Lines that have gone since they were added, so the cart can say so. */
  unavailable: { productId: string; variantId: string | null }[];
  needsDelivery: boolean;
  needsAddress: boolean;
  hasService: boolean;
  couponError?: string;
  couponApplied?: string;
};

/**
 * Prices a basket for the checkout panel as the buyer changes quantity,
 * delivery or coupon. It runs the same `resolveLines` and `quote` as the real
 * order, so what's shown can't drift from what's charged — and it's lenient,
 * so one sold-out line doesn't blank the whole cart.
 */
