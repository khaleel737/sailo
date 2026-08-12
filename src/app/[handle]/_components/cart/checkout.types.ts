import type { OrderLineInput, OrderPreview } from "@/lib/orders/types";
import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import type { PaymentMethodType } from "@/lib/payments";
import type { DeliveryMethodType } from "@/lib/delivery";

/** What the checkout is offered, as the storefront hands it over. */

export type CheckoutMethod = {
  type: PaymentMethodType;
  label: string | null;
};

/**
 * The shop's compliance switches, as the storefront hands them over.
 *
 * Carried as one object rather than three loose props because it threads
 * through four components to reach the panel, and a bundle that arrives whole
 * cannot arrive two-thirds of the way. Required, not optional: a shop that
 * forgot to pass it should fail to compile, not quietly stop asking buyers to
 * agree to anything.
 */
export type CheckoutCompliance = {
  requireTerms: boolean;
  termsUrl: string | null;
  askMarketingConsent: boolean;
};

/**
 * The three columns, read off the shop in exactly one place.
 *
 * Two pages mount a checkout — the storefront and a product page — and a
 * compliance object assembled independently in each is the bug shape this
 * codebase keeps finding: a rule applied at one sink and not at its twin. One
 * function with two callers cannot drift.
 */
export function complianceOf(
  shop: Pick<Shop, "requireTerms" | "termsUrl" | "askMarketingConsent">,
): CheckoutCompliance {
  return {
    requireTerms: shop.requireTerms,
    termsUrl: shop.termsUrl,
    askMarketingConsent: shop.askMarketingConsent,
  };
}

export type CheckoutDelivery = {
  id: string;
  type: DeliveryMethodType;
  name: string;
  feeCents: number;
  freeOverCents: number | null;
  estimate?: string;
  address?: string;
  hours?: string;
  /**
   * Where this rate reaches, as ISO 3166-1 alpha-2. **Empty is anywhere**, not
   * nowhere — every rate created before zones existed has an empty one.
   * Shaped to satisfy `DeliveryZone`, so the panel asks `shipsTo` the same
   * question the server does rather than re-implementing the rule.
   */
  countries: string[];
};

/**
 * Everything below the goods: how it arrives, how it's paid for, who to send
 * it to, and what it costs.
 *
 * One product or twenty, the questions are the same — so "buy now" and the
 * cart render this same panel and differ only in what they put above it.
 * Money and eligibility come from the server on every change, so the panel
 * never has to know the rules.
 */

export type CheckoutPanelProps = {
  shopId: string;
  shopName: string;
  currency: string;
  /** What's being bought. The server re-prices all of it. */
  items: OrderLineInput[];
  /**
   * Every rail the shop has live. The panel narrows them to the ones this
   * order can actually use — cash on delivery is not on offer for a download.
   */
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  /**
   * Whether anything here travels, as the caller already knows it from the
   * kinds in the basket. The server re-decides on the first quote; this only
   * spares the panel a frame of asking the wrong questions.
   */
  needsDeliveryHint?: boolean;
  /** First-frame guess for whether cash-in-person shows; the server's quote
   * decides. Defaults to showing it — only an instant download hides it. */
  payInPersonHint?: boolean;
  contactEmail: string | null;
  compliance: CheckoutCompliance;
  /** True when a digital line has files attached. */
  hasFiles?: boolean;
  /** True when those files wait for the seller to confirm payment. */
  heldUntilPaid?: boolean;
  /** Short label for the sheet's header — "Order", "Your basket". */
  title: string;
  /** The fuller description a screen reader announces. */
  ariaLabel?: string;
  t: Dictionary;
  onClose: () => void;
  /** Fires once the order is placed, so a cart can empty itself. */
  onPlaced?: () => void;
  /** The goods: variant pickers, or the basket's lines. */
  children?: (preview: OrderPreview | null) => React.ReactNode;
  /** Shown instead of the form when there's nothing to buy. */
  empty?: React.ReactNode;
};
