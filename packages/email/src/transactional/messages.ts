import "server-only";
import type { Order, Shop } from "@sailo/db/schema";
import { orderSummaryTitle, type OrderLine } from "@sailo/core/order-lines";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@sailo/payments/offline";
import { formatAddress } from "@sailo/core/address";
import { formatMoney } from "@sailo/core/currency";
import { eventBlock, type EventDetails } from "../orders";
import { ORDERS, PARTNERS, send, sender, type SendResult } from "@sailo/mailer/transport";
import {
  button,
  buttonGhost,
  detailTable,
  esc,
  fine,
  formatWhen,
  itemRows,
  layout,
  link,
  moneyRows,
  mutedPara,
  para,
  sailoLayout,
  section,
  strong,
  well,
  type Detail,
} from "@sailo/mailer/markup";

/**
 * A buyer's record of what they bought.
 *
 * Every message here is addressed to the person who paid, and every one is
 * *evidence*: what was ordered, what it cost, when it arrives, what it lets
 * them into. That is what makes them transactional rather than marketing —
 * consent has nothing to do with it, and none of them may carry an unsubscribe
 * link that would let a buyer opt out of being told their order shipped.
 *
 * The three an order's own lifecycle sends — shipped, refunded, booking
 * decided — are in `../orders`, because they are triggered from
 * `@sailo/commerce` where the money moves. The rest are triggered by something
 * a server does: a checkout completing, a webhook arriving, a schedule running.
 */

/**
 * What the buyer should understand about the money, given how they chose to
 * pay and where the payment stands right now.
 *
 * One sentence per rail kind rather than a status dump: "unpaid" is the
 * *normal* state of a fresh cash-on-delivery order and an alarming one on a
 * bank transfer that was marked sent, so the raw status means nothing without
 * the rail to read it against.
 */
function paymentStanding(order: Order, shopName: string): string {
  if (order.paymentStatus === "paid") return "Paid — nothing more to do.";
  if (!isPaymentMethodType(order.paymentMethod)) return "";

  const def = PAYMENT_METHOD_DEFS[order.paymentMethod];
  switch (def.type) {
    case "card":
      // This email can arrive before the card payment settles — the copy has
      // to be true on both sides of that moment.
      return "Card payments are completed on the secure checkout.";
    case "bank_transfer":
      return order.paymentStatus === "pending"
        ? `You've marked the transfer as sent — ${shopName} will confirm it once it arrives.`
        : `Once your transfer arrives, ${shopName} will confirm your order.`;
    case "cod":
      return "Nothing to pay now — you pay when your order arrives.";
    default:
      // The contact rails: WhatsApp, Telegram, Instagram, email, phone.
      return `You'll arrange payment directly with ${shopName}.`;
  }
}

/** Sent to the buyer the moment they order. */
export async function sendOrderConfirmation(opts: {
  shop: Shop;
  order: Order;
  /**
   * Every line. Required, not optional: an optional list with a header
   * fallback is how a two-line order came to be emailed as one line at the
   * wrong price.
   */
  items: OrderLine[];
  invoiceUrl: string | null;
  invoiceNumber: string | null;
  /** Set once a digital order's files are already unlocked. */
  downloadUrl?: string | null;
  /** Set when they're waiting on the seller confirming payment. */
  downloadPending?: boolean;
}): Promise<SendResult> {
  const { shop, order } = opts;
  if (!order.customerEmail) return { sent: false, reason: "no customer email" };

  const methodName = isPaymentMethodType(order.paymentMethod)
    ? PAYMENT_METHOD_DEFS[order.paymentMethod].name
    : order.paymentMethod;

  const paymentRows: Detail[] = [
    { label: "Method", value: methodName },
    { label: "Reference", value: order.paymentReference ?? "" },
    { label: "Invoice", value: opts.invoiceNumber ?? "" },
  ];
  const standing = paymentStanding(order, shop.name);

  /*
   * Where the order goes, at order level. Anything line-specific — an
   * appointment's time and place — is printed on its own line by `itemRows`,
   * so a cart booking two services in two places says both.
   */
  const address = formatAddress(order);
  const fulfilmentRows: Detail[] = [
    { label: "Method", value: order.deliveryLabel ?? "" },
    { label: "Deliver to", value: address },
    { label: "Collect from", value: order.pickupLocation ?? "" },
  ];
  const fulfilmentTitle =
    order.deliveryMethod === "collection" ? "Collection" : "Delivery";

  /*
   * Checkout promises that the shop confirms a requested slot afterwards; the
   * confirmation email is where that promise is repeated, so the buyer isn't
   * left thinking the time is already agreed.
   */
  const awaitingSlot =
    opts.items.some((item) => item.scheduledFor) || Boolean(order.scheduledFor);

  const body = `
    ${para(
      `Thanks${order.customerName ? ` ${esc(order.customerName)}` : ""} — ${esc(shop.name)} has your order.`,
    )}
    ${section(
      "Order summary",
      itemRows(opts.items, order.currency, shop.timeZone) + moneyRows(order),
    )}
    ${section(
      "Payment",
      detailTable(paymentRows) + (standing ? fine(esc(standing)) : ""),
    )}
    ${
      fulfilmentRows.some((row) => row.value)
        ? section(fulfilmentTitle, detailTable(fulfilmentRows))
        : ""
    }
    ${order.note ? section("Your note", well(order.note)) : ""}
    ${
      awaitingSlot
        ? fine(
            `${esc(shop.name)} will confirm your appointment time — you'll hear back by email.`,
          )
        : ""
    }
    ${opts.downloadUrl ? button(opts.downloadUrl, "Download your files") : ""}
    ${
      opts.downloadPending
        ? fine(
            `Your download unlocks as soon as ${esc(shop.name)} confirms your payment — we'll email you the link.`,
          )
        : ""
    }
    ${opts.invoiceUrl ? buttonGhost(opts.invoiceUrl, "View your invoice") : ""}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: `Your order from ${shop.name}${opts.invoiceNumber ? ` — ${opts.invoiceNumber}` : ""}`,
    html: layout(shop, "Order confirmed", body, {
      preheader: `${orderSummaryTitle(order)} · ${formatMoney(order.totalCents, order.currency)}`,
    }),
    replyTo: shop.contactEmail ?? undefined,
  });
}



/**
 * Sent a day before an event, and again an hour before.
 *
 * One email per order per event per lead — the caller claims the right to
 * send by inserting a row whose unique index says so, so this function is
 * never the thing deciding whether it has already run.
 */
export async function sendEventReminder(opts: {
  shop: Shop;
  order: Order;
  event: EventDetails;
  lead: "24h" | "1h";
  /** The buyer's own page, where the tickets and the link live. */
  portalUrl: string | null;
}): Promise<SendResult> {
  const { shop, order, event } = opts;
  if (!order.customerEmail) return { sent: false, reason: "no customer email" };

  const soon = opts.lead === "24h" ? "tomorrow" : "in about an hour";

  const body = `
    ${para(
      `${order.customerName ? `${esc(order.customerName)}, y` : "Y"}our event with ${esc(shop.name)} starts ${soon}.`,
    )}
    ${section("Your event", eventBlock(event, shop.timeZone))}
    ${opts.portalUrl ? buttonGhost(opts.portalUrl, "View your ticket") : ""}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject:
      opts.lead === "24h"
        ? `Tomorrow: ${event.title}`
        : `Starting soon: ${event.title}`,
    html: layout(shop, `Starts ${soon}`, body, {
      preheader: `${event.title} — ${soon}.`,
    }),
    replyTo: shop.contactEmail ?? undefined,
  });
}

/**
 * The affiliate's own report links, one per shop they promote. Sent only to an
 * address that already has an active affiliate row against it.
 */
export async function sendPortalLinks(opts: {
  to: string;
  links: { shopName: string; url: string }[];
}): Promise<SendResult> {
  const { to, links } = opts;
  if (links.length === 0) return { sent: false, reason: "no links" };

  const one = links.length === 1;
  const rows = links
    .map(
      (l) =>
        `<p style="margin:0 0 10px;font-size:15px;line-height:1.6;">${link(l.url, l.shopName)}</p>`,
    )
    .join("");

  const html = sailoLayout(
    "Your referral report",
    `${mutedPara(
      one
        ? "Here's your private link to the report."
        : "Here are your private links — one for each shop you promote.",
    )}
      ${section(one ? "Your report" : "Your reports", rows)}
      ${fine(
        `Keep ${one ? "it" : "them"} to yourself: anyone with a link can see your earnings.`,
      )}`,
    {
      preheader: one
        ? "Your private referral report link."
        : `Your ${links.length} private referral report links.`,
    },
  );

  return send({
    from: sender("Sailo", PARTNERS),
    to,
    subject: "Your referral report",
    html,
  });
}

/**
 * Welcome to the thing you now pay for every month.
 *
 * Sent once, on the first invoice that actually settles — not when the
 * subscription is created, because a trial creates one and takes no money, and
 * "thanks for your payment" about a payment that has not happened is the kind
 * of email that produces a support ticket.
 *
 * The manage link is not decoration. A member who cannot find how to cancel
 * cancels through their bank instead, and a chargeback costs the seller the
 * month, the fee, and a mark against their account.
 */
export async function sendMembershipStarted(opts: {
  shop: Shop;
  to: string;
  name: string | null;
  productTitle: string;
  interval: string;
  priceCents: number;
  currency: string;
  manageUrl: string | null;
}): Promise<SendResult> {
  const { shop } = opts;
  const every = opts.interval === "year" ? "a year" : "a month";

  const body = `
    ${para(
      `${opts.name ? `${esc(opts.name)}, y` : "Y"}our ${strong(esc(opts.productTitle))} membership is active.`,
    )}
    ${section(
      "Your membership",
      detailTable([
        { label: "Membership", value: opts.productTitle },
        {
          label: "Price",
          value: `${formatMoney(opts.priceCents, opts.currency)} every ${every}`,
        },
      ]),
    )}
    ${opts.manageUrl ? button(opts.manageUrl, "Manage your membership") : ""}
    ${fine(
      `It renews automatically until you cancel, and you can cancel any time — you keep access until the end of the period you've paid for.`,
    )}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: opts.to,
    subject: `You're a member of ${shop.name}`,
    html: layout(shop, "Membership active", body, {
      preheader: `${opts.productTitle} — ${formatMoney(opts.priceCents, opts.currency)} every ${every}.`,
    }),
    replyTo: shop.contactEmail ?? undefined,
  });
}

/**
 * The card did not work.
 *
 * Sent because Stripe's own dunning mail is the seller's setting to make on
 * their connected account and is off by default — so without this the first a
 * member hears about a failed payment is the day their access stops working,
 * which is both a bad experience and a support ticket for the seller.
 *
 * Deliberately calm, and deliberately specific about what has *not* happened
 * yet: nothing has been cancelled, the card will be retried, and there is a
 * link to fix it in one tap. A panicked "YOUR MEMBERSHIP HAS BEEN TERMINATED"
 * for a bank's routine fraud check loses the member.
 */
export async function sendMembershipPaymentFailed(opts: {
  shop: Shop;
  to: string;
  name: string | null;
  productTitle: string;
  payUrl: string | null;
  /** How long their access lasts regardless, so the copy can be honest. */
  until: Date | null;
}): Promise<SendResult> {
  const { shop } = opts;

  const body = `
    ${para(
      `${opts.name ? `${esc(opts.name)}, w` : "W"}e couldn't take the payment for ${strong(esc(opts.productTitle))}.`,
    )}
    ${mutedPara(
      "It's usually an expired card or a bank check rather than anything wrong. We'll try again over the next few days.",
    )}
    ${opts.payUrl ? button(opts.payUrl, "Update your payment details") : ""}
    ${
      opts.until
        ? fine(
            `Your access continues until ${esc(
              formatWhen(opts.until, shop.timeZone, "long"),
            )} while we retry.`,
          )
        : ""
    }
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: opts.to,
    subject: `Payment problem — ${opts.productTitle}`,
    html: layout(shop, "We couldn't take your payment", body, {
      preheader: `We'll retry the card for ${opts.productTitle} over the next few days.`,
    }),
    replyTo: shop.contactEmail ?? undefined,
  });
}

/**
 * Your membership is up for renewal, and here is how to pay for it.
 *
 * The card path never needs this — Stripe just charges the card and the member
 * finds out from their bank statement. On every other rail the member has to
 * *do* something, so somebody has to ask them, and nobody else is going to.
 *
 * Sent a few days ahead rather than on the day, because a bank transfer takes
 * a day or two to arrive and the seller then has to see it and confirm it. A
 * request that lands the morning access expires is a request that arrives too
 * late to be acted on.
 */
export async function sendMembershipRenewalDue(opts: {
  shop: Shop;
  to: string;
  name: string | null;
  productTitle: string;
  priceCents: number;
  currency: string;
  /** When the current period runs out — the deadline, stated plainly. */
  until: Date | null;
  /** Their own membership page, which carries the shop's payment details. */
  manageUrl: string | null;
}): Promise<SendResult> {
  const { shop } = opts;

  const body = `
    ${para(
      `${opts.name ? `${esc(opts.name)}, y` : "Y"}our ${strong(esc(opts.productTitle))} membership is due for renewal.`,
    )}
    ${section(
      "This period",
      detailTable([
        { label: "Amount", value: formatMoney(opts.priceCents, opts.currency) },
        {
          label: "Paid up to",
          value: opts.until ? formatWhen(opts.until, shop.timeZone, "long") : "",
        },
      ]),
    )}
    ${opts.manageUrl ? button(opts.manageUrl, "How to pay") : ""}
    ${fine(
      `${esc(shop.name)} will confirm your payment and your membership carries straight on. Reply to this email if anything has changed.`,
    )}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: opts.to,
    subject: `Time to renew — ${opts.productTitle}`,
    html: layout(shop, "Your membership is due", body, {
      preheader: `${formatMoney(opts.priceCents, opts.currency)} to carry on with ${opts.productTitle}.`,
    }),
    replyTo: shop.contactEmail ?? undefined,
  });
}
