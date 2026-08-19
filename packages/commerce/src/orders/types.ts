import type { Handoff } from "@sailo/payments/offline";
import type { Totals } from "@sailo/core/pricing";
import type { QuoteLine } from "@sailo/core/quote";
import type { Product, ProductVariant } from "@sailo/db/schema";

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
  /**
   * What the buyer typed into the amount field, in minor units — spec 43.
   *
   * **The only money the browser is ever allowed to name**, and it is read for
   * `pricingMode: "pwyw"` products and nothing else. On a fixed-price product
   * this field is ignored entirely rather than validated, so a forged one buys
   * the same thing at the same price as an honest basket; on a PWYW one it is
   * clamped to the seller's floor in `resolveLines`, which `previewOrder` and
   * `createOrderIntent` are both built on.
   *
   * Minor units, never a decimal string. The client parses through
   * `moneyToCents`, which knows each currency's minor unit — the three-decimal
   * currencies are the standing warning here, and `parseFloat(x) * 100` is the
   * shape of the defect that overcharged a KWD buyer tenfold.
   */
  priceCents?: number;
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
  /**
   * The buyer ticked the shop's terms box. Optional because most shops don't
   * ask — but when `shop.requireTerms` is on, its absence refuses the order,
   * and it is the server that decides that rather than the form.
   */
  acceptedTerms?: boolean;
  /** The buyer ticked the optional marketing box. Only ever grants consent. */
  marketingOptIn?: boolean;
  /**
   * What the buyer typed into the shop's own checkout questions, keyed by
   * field key — spec 34's other half, and what Wave C's intake forms are
   * built on.
   *
   * Raw, and deliberately so: nothing here is trusted, and `saveAnswers`
   * validates every value against the field's own row before a character of
   * it is written. The keys a shop does not define are ignored rather than
   * refused, because a stale form is a browser with an old page open and not
   * an attack — but a value that fails its field's type or leaves its
   * dropdown's option list refuses the order, exactly like the terms box.
   */
  customFields?: Record<string, unknown>;
  /**
   * The checkout session this order came from, and whether the buyer arrived
   * through the recovery link — spec 32.
   *
   * Both are reports, not decisions. The server re-reads the session's own
   * status before attributing anything, so a forged `viaResumeLink` cannot
   * turn an ordinary sale into a recovered one: `statusAfterPayment` requires
   * the session to have actually been `recovering`, which only the cron can
   * make it.
   */
  checkoutSessionId?: string;
  viaResumeLink?: boolean;
  /**
   * A durable per-browser id, when the caller has one. Spec 44.
   *
   * Visa's Compelling Evidence 3.0 counts `customer_device_fingerprint` as one
   * of its two matching data points, and an order carrying it *plus* an IP
   * address qualifies on its own — which is the whole of a 10.4 defence.
   *
   * Optional and expected to be absent for most orders: Sailo redirects to
   * Stripe Checkout and runs no fingerprinting script of its own, so this is
   * filled only where a client already had a durable id. Never generated
   * server-side — an id minted per request matches nothing four months later,
   * and asserting it to an issuer as a match point would be a claim about a
   * returning buyer that is not true.
   */
  deviceFingerprint?: string;
} & OrderAddress;


export type ResolvedLine = QuoteLine & {
  product: Product;
  variant: ProductVariant | null;
  scheduledFor: Date | null;
  /**
   * Taken against stock that does not exist yet — spec 33.
   *
   * Decided in `resolveLines`, from the one stock question the catalogue
   * already answers: a line that is not sellable on a product whose seller has
   * turned preorders on is a preorder, and everything else that is not sellable
   * is sold out. There is no second stock read and no second concept of
   * availability — `isSellable` decides, and this only records what to do about
   * the answer.
   *
   * `createOrderIntent` reads it to know that a *failed* reservation on this
   * line is expected rather than fatal, which is what keeps one stock claim in
   * the codebase rather than two.
   */
  preorder: boolean;
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
      referral: {
        code: string;
        url: string;
        percent: string;
        /** Their private report — the only place they can see referrals. */
        portalUrl: string;
      } | null;
    }
  | { ok: false; error: string };

/**
 * Where a card checkout that left for Stripe ended up, as the storefront asks
 * on its next visit. "settled" — the money moved; the basket that became this
 * order should empty. "pending" — the buyer may still be paying in another
 * tab; touch nothing and ask again later. "gone" — the order was abandoned and
 * reclaimed, or never survived; the basket lives on and the marker does not.
 */
export type CheckoutOutcome = "settled" | "pending" | "gone";

/** What the order sheet needs to label the tax line, or null when tax is off. */
export type PreviewTax = {
  name: string;
  rateBp: number;
  inclusive: boolean;
  /**
   * Stripe Tax will work the amount out at checkout, so there is no figure to
   * show and `rateBp` means nothing.
   *
   * The cart has to say so rather than print the zero it would otherwise have:
   * a buyer shown "Tax £0.00" and then charged £4.20 on Stripe's page has been
   * told something untrue by the summary they were reading.
   */
  deferred: boolean;
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
  /** Units left, or null when nobody is counting — for "only 3 left". */
  unitsLeft: number | null;
  /**
   * The most of this line one order may take, which is a different question.
   *
   * The cart used to derive its stepper's ceiling from `unitsLeft` alone, so
   * the seller's per-order cap was invisible here: the control offered a fifth
   * ticket on a four-a-head event and the checkout silently took it back.
   * `maxOrderable` is the same function the checkout clamps with, so the
   * number a buyer can reach is the number the order will honour.
   */
  maxOrderable: number;
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
  /**
   * True when the basket holds something that also arrives by email — a
   * download or a ticket — so the panel can ask for one before the buyer
   * commits rather than the server refusing them afterwards.
   */
  needsEmail: boolean;
  hasService: boolean;
  /**
   * Every rate that reaches this address has been withdrawn because the basket
   * is heavier than any of them price — spec 51.
   *
   * Reported rather than refused, exactly as an unserviceable country is: the
   * buyer is still shopping, and blanking their basket over a rule they can fix
   * by removing an item is the opposite of what a preview is for. The panel
   * says so in a sentence; `createOrderIntent` is where it stops being a
   * sentence.
   */
  deliveryTooHeavy: boolean;
  /** Whether a pay-in-person rail (cash on delivery) may be offered. False
   * only when the basket holds an instant download, which unlocks on order. */
  canPayInPerson: boolean;
  couponError?: string;
  couponApplied?: string;
};

/**
 * Prices a basket for the checkout panel as the buyer changes quantity,
 * delivery or coupon. It runs the same `resolveLines` and `quote` as the real
 * order, so what's shown can't drift from what's charged — and it's lenient,
 * so one sold-out line doesn't blank the whole cart.
 */
