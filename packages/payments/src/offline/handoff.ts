import { normalizePhone } from "@sailo/core/phone";
import { currencyDecimals, minorPerMajor } from "@sailo/core/currency";
import type { PaymentConfig } from "@sailo/db/schema";
import { isPaymentMethodType, PAYMENT_METHOD_DEFS } from "./rails";

/** What happens to the buyer once they have chosen how to pay. */

export type OrderSummary = {
  shopName: string;
  productTitle: string;
  quantity: number;
  /** The final total, after any discount and delivery fee. */
  priceLabel: string;
  productUrl?: string;
  customerName?: string;
  note?: string;
  address?: string;
  delivery?: string;
  discount?: string;
  invoiceNumber?: string;
  /**
   * The same total as `priceLabel`, unformatted, for the rails that put the
   * amount inside a URL. Venmo rejects a currency symbol and PayPal.Me reads
   * the trailing code, so neither can be handed the display string.
   */
  totalCents?: number;
  /** ISO 4217, for the same two links. */
  currency?: string;
};

/**
 * A decimal amount for a pay link: `45`, `45.50`, `1200` for a zero-decimal
 * currency like JPY.
 *
 * Not `toFixed(2)`. That is wrong in both directions — it invents two decimal
 * places on JPY, where the whole amount is already in major units, and it
 * truncates the third on JOD. `currencyDecimals` is the same source the
 * checkout and the invoice already use, so the link cannot quote a total the
 * order does not.
 */
export function payAmount(minor: number, code: string): string {
  return (minor / minorPerMajor(code)).toFixed(currencyDecimals(code));
}

/** `@handle`, `$handle`, or a pasted `https://venmo.com/handle` → `handle`. */
function bareHandle(value: string | undefined) {
  return (value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    /*
     * The host, whether or not the paste kept its scheme. Stripping only
     * `https://host/` left `venmo.com/clayandco` — which is what a phone
     * gives you when you copy a profile link out of an address bar — reading
     * as the handle `venmo.com`, and both Venmo and Instagram answer that
     * with a page rather than an error. A handle never contains a slash, so a
     * dotted first segment with one after it can only be a host.
     */
    .replace(/^[\w-]+(?:\.[\w-]+)+\//, "")
    .replace(/^[@$]/, "")
    .replace(/[/?#].*$/, "")
    .trim();
}

export function orderMessage(order: OrderSummary) {
  const lines = [
    `Hi ${order.shopName}! I'd like to order:`,
    ``,
    `${order.productTitle}`,
    `Quantity: ${order.quantity}`,
  ];
  if (order.discount) lines.push(`Discount: ${order.discount}`);
  if (order.delivery) lines.push(`Delivery: ${order.delivery}`);
  lines.push(`Total: ${order.priceLabel}`);
  if (order.customerName) lines.push(`Name: ${order.customerName}`);
  if (order.address) lines.push(`Deliver to: ${order.address}`);
  if (order.note) lines.push(`Note: ${order.note}`);
  if (order.invoiceNumber) lines.push(`Invoice: ${order.invoiceNumber}`);
  if (order.productUrl) lines.push(``, order.productUrl);
  return lines.join("\n");
}

export type Handoff =
  | { kind: "redirect"; url: string }
  /**
   * Buyer stays on the page; `message` is offered for copy/paste.
   *
   * `payUrl` is somewhere the buyer can open *and still come back from*, which
   * is why it lives here rather than as a `redirect`. Venmo and PayPal settle
   * off platform, so the order stays unpaid until the buyer submits a
   * reference — send them away with no way back and the seller never learns
   * the money arrived, then ships nothing. Instagram is here for the sibling
   * reason: the DM it opens carries nothing, so the buyer has to still have
   * the message when they get there.
   */
  | {
      kind: "instructions";
      message?: string;
      payUrl?: string;
      payLabel?: string;
      /**
       * `payUrl` opens a chat that cannot be prefilled, so `message` is the
       * buyer's to paste. Set from the rail table rather than restated here,
       * because the checkout screen has to know the same thing one step
       * earlier — see `copyToSend` on `PaymentMethodDef`.
       */
      copyToSend?: boolean;
    };

/**
 * Turns a configured rail plus an order into the buyer's next step. Returns
 * null when the rail can't be actioned, so callers fall back to a plain
 * confirmation.
 */
export function buildHandoff(
  type: string,
  config: PaymentConfig,
  order: OrderSummary,
): Handoff | null {
  if (!isPaymentMethodType(type)) return null;
  const def = PAYMENT_METHOD_DEFS[type];
  const message = orderMessage(order);

  switch (type) {
    case "whatsapp": {
      const phone = normalizePhone(config.phone ?? "");
      if (!phone) return null;
      return {
        kind: "redirect",
        url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
      };
    }
    case "telegram": {
      /*
       * `?text=` is real here, unlike on Instagram: Telegram documents it on
       * the public-username link as "UTF-8 text to pre-enter into the text
       * input bar, if the user can write in the chat" — so the redirect is
       * right and the seller reads the order in the chat. The buyer still
       * presses send, which Telegram will not do for them.
       *
       * `bareHandle` for the paste, though — the field takes a username and
       * gets `t.me/yourshop` often enough, which used to build
       * `t.me/t.me/yourshop` and reach nobody.
       */
      const username = bareHandle(config.username);
      if (!username) return null;
      return {
        kind: "redirect",
        url: `https://t.me/${encodeURIComponent(username)}?text=${encodeURIComponent(message)}`,
      };
    }
    case "instagram": {
      const username = bareHandle(config.username);
      if (!username) return null;
      /*
       * Instructions, not a redirect — which is what this was, and why the
       * seller kept receiving blank DMs.
       *
       * `ig.me/m/<user>` opens the thread and drops any query string, and
       * Instagram documents no way to fill one in. So the redirect took the
       * buyer off the only screen the order message was ever on: no name, no
       * address, no total, no invoice number, and no way back to fetch them.
       * The rail's own description has always said "copy the details from the
       * next screen"; this is that screen. Shaped like the wallet rails for
       * the same reason they are — the order is unpaid until the buyer comes
       * back, so the page has to still be there when they do.
       *
       * `bareHandle` because this field is pasted at least as often as it is
       * typed, and `instagram.com/yourshop` in it produced a link to
       * `ig.me/m/https:/instagram.com/yourshop`, which reaches nobody.
       */
      return {
        kind: "instructions",
        message,
        payUrl: `https://ig.me/m/${encodeURIComponent(username)}`,
        // Left unlabelled on purpose: the button says the buyer's own word for
        // the rail, which the storefront has translated and this file has not.
        copyToSend: def.copyToSend,
      };
    }
    case "email": {
      const address = (config.address ?? "").trim();
      if (!address) return null;
      const subject = `Order: ${order.productTitle}`;
      return {
        kind: "redirect",
        url: `mailto:${address}?subject=${encodeURIComponent(
          subject,
        )}&body=${encodeURIComponent(message)}`,
      };
    }
    case "phone": {
      const phone = (config.phone ?? "").trim();
      if (!phone) return null;
      return { kind: "redirect", url: `tel:${phone.replace(/[^\d+]/g, "")}` };
    }
    case "venmo": {
      const handle = bareHandle(config.venmoHandle);
      if (!handle) return null;
      const url = new URL(`https://venmo.com/${encodeURIComponent(handle)}`);
      url.searchParams.set("txn", "pay");
      if (order.totalCents !== undefined && order.currency) {
        url.searchParams.set("amount", payAmount(order.totalCents, order.currency));
      }
      /*
       * The invoice number and nothing else. A Venmo note is public on the
       * sender's feed by default, so `orderMessage` — which carries the
       * buyer's name, address and what they bought — must never go in it.
       */
      url.searchParams.set(
        "note",
        order.invoiceNumber ? `${order.shopName} ${order.invoiceNumber}` : order.shopName,
      );
      return { kind: "instructions", message, payUrl: url.toString(), payLabel: "Venmo" };
    }
    case "paypal": {
      const handle = bareHandle(config.paypalMe);
      if (!handle) return null;
      /*
       * PayPal.Me reads the amount from the path and the currency from the
       * code glued to it — `paypal.me/shop/25USD`. A link with no amount is
       * still a working link, so an order in a currency we cannot state falls
       * back to the bare profile rather than to nothing.
       */
      const amount =
        order.totalCents !== undefined && order.currency
          ? `/${payAmount(order.totalCents, order.currency)}${order.currency.toUpperCase()}`
          : "";
      return {
        kind: "instructions",
        message,
        payUrl: `https://paypal.me/${encodeURIComponent(handle)}${amount}`,
        payLabel: "PayPal",
      };
    }
    case "bank_transfer":
    case "cod":
      return { kind: "instructions", message };

    // Card can't be resolved here: the buyer's next step is a Stripe Checkout
    // Session, which needs the saved order to exist first. `createOrderIntent`
    // builds that redirect once it has an order id.
    case "card":
      return null;
  }
}

/** Human-readable account lines shown to the buyer after a bank transfer order. */
export function bankDetailLines(config: PaymentConfig) {
  return (
    [
      ["Bank", config.bankName],
      ["Account name", config.accountName],
      ["Account number", config.accountNumber],
      ["IBAN", config.iban],
      ["SWIFT / BIC", config.swift],
    ] as const
  )
    // One pass rather than filter-then-assert: the filter proved the value was
    // there and the map had to swear to it again, which is exactly the kind of
    // promise that stops being true when someone edits one line and not the other.
    .flatMap(([label, value]) => {
      const trimmed = value?.trim();
      return trimmed ? [{ label, value: trimmed }] : [];
    });
}
