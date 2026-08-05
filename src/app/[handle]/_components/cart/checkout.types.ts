import type { OrderLineInput, OrderPreview } from "@/lib/orders/types";
import type { Dictionary } from "@/i18n";
import type { PaymentMethodType } from "@/lib/payments";
import type { DeliveryMethodType } from "@/lib/delivery";

/** What the checkout is offered, as the storefront hands it over. */

export type CheckoutMethod = {
  type: PaymentMethodType;
  label: string | null;
};

export type CheckoutDelivery = {
  id: string;
  type: DeliveryMethodType;
  name: string;
  feeCents: number;
  freeOverCents: number | null;
  estimate?: string;
  address?: string;
  hours?: string;
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
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  contactEmail: string | null;
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
