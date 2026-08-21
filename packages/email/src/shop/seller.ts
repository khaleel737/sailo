import "server-only";
import type { Order, Shop } from "@sailo/db/schema";
import { orderSummaryTitle, type OrderLine } from "@sailo/core/order-lines";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@sailo/payments/offline";
import { formatMoney } from "@sailo/core/currency";
import { appOrigin } from "@sailo/core/origin";

/** This deployment's origin — see `../origin` for why it is read, not passed. */
const appUrl = appOrigin;
import { ORDERS, send, sender, type SendResult } from "@sailo/mailer/transport";
import {
  button,
  detailTable,
  esc,
  fine,
  formatWhen,
  itemRows,
  moneyRows,
  mutedPara,
  para,
  sailoLayout,
  section,
  strong,
  type Detail,
} from "@sailo/mailer/markup";

/**
 * Every message Sailo sends to a *seller* about their own shop.
 *
 * Kept apart from `messages.ts` the way the admin dictionary is kept apart
 * from the storefront's: buyers and sellers are different audiences. Buyer
 * mail is shop-branded (`layout(shop, …)`) because the buyer bought from the
 * shop; these use `sailoLayout` because they are Sailo telling a seller what
 * happened in their own admin.
 *
 * Same contract as every sender here: a `SendResult`, never a throw — whether
 * anything should be sent at all (prefs, the daily ceiling) is decided by
 * `lib/orders/notify-seller.ts`, not in these builders.
 *
 * Buyer PII stays minimal on purpose: name and what they bought, never the
 * delivery address. The admin has the rest, and an email is the copy of an
 * order most likely to end up forwarded, printed or sitting in a breached
 * inbox. The one exception is the booking mail, which carries the buyer's
 * email/phone — the seller may need to reach them about the time, and the
 * conversation is the point of a booking.
 */

/** Where every one of these mails points: the order queue, not a detail page. */
function ordersUrl(): string {
  return `${appUrl()}/admin/orders`;
}

function methodName(order: Order): string {
  return isPaymentMethodType(order.paymentMethod)
    ? PAYMENT_METHOD_DEFS[order.paymentMethod].name
    : order.paymentMethod;
}

/**
 * Sent when an order settles — at checkout on the manual rails, on
 * `checkout.session.completed` for card. Exactly one of the two sites fires
 * per order; the discriminator is the same `settlesAtCheckout` the buyer's
 * confirmation already uses.
 */
export async function sendSellerOrderPlaced(opts: {
  shop: Shop;
  order: Order;
  items: OrderLine[];
  /** Resolved by the caller: `shop.contactEmail`, else the account email. */
  to: string;
}): Promise<SendResult> {
  const { shop, order, items, to } = opts;
  const amount = formatMoney(order.totalCents, order.currency);

  const body = `
    ${mutedPara(
      `${order.customerName ? strong(esc(order.customerName)) : "Someone"} just ordered from ${esc(shop.name)}.`,
    )}
    ${section("What they ordered", itemRows(items, order.currency, shop.timeZone) + moneyRows(order))}
    ${section(
      "Payment",
      detailTable([
        { label: "Method", value: methodName(order) },
        { label: "Status", value: order.paymentStatus === "paid" ? "Paid" : "To collect" },
      ]),
    )}
    ${button(ordersUrl(), "Open your orders")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `New order — ${amount}`,
    html: sailoLayout("You have a new order", body, {
      preheader: `${orderSummaryTitle(order)} · ${amount}`,
    }),
    // A reply should reach the buyer, who is the person with the follow-up.
    replyTo: order.customerEmail ?? undefined,
  });
}

/**
 * Sent instead of the order mail when the order carries a requested
 * appointment — the seller's next move is accept or decline, not fulfil,
 * and checkout promised the buyer an answer.
 */
export async function sendSellerBookingRequested(opts: {
  shop: Shop;
  order: Order;
  items: OrderLine[];
  to: string;
}): Promise<SendResult> {
  const { shop, order, items, to } = opts;
  const amount = formatMoney(order.totalCents, order.currency);
  const when = order.scheduledFor
    ? formatWhen(order.scheduledFor, shop.timeZone, "long")
    : null;

  // The seller has to be able to answer — a booking is a conversation.
  const contactRows: Detail[] = [
    { label: "Name", value: order.customerName ?? "" },
    { label: "Email", value: order.customerEmail ?? "" },
    { label: "Phone", value: order.customerPhone ?? "" },
  ];

  const body = `
    ${mutedPara(
      `${order.customerName ? strong(esc(order.customerName)) : "Someone"} asked to book ${esc(orderSummaryTitle(order))}${when ? ` for ${strong(esc(when))}` : ""}.`,
    )}
    ${para("The time isn't agreed until you confirm it — the buyer was told to expect your answer.")}
    ${
      when
        ? section(
            "Requested time",
            detailTable([
              { label: "When", value: when },
              { label: "Time zone", value: shop.timeZone },
            ]),
          )
        : ""
    }
    ${section("Buyer", detailTable(contactRows))}
    ${section("Order", itemRows(items, order.currency, shop.timeZone) + moneyRows(order))}
    ${button(ordersUrl(), "Confirm or decline")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `Booking request — ${amount}`,
    html: sailoLayout("New booking request", body, {
      preheader: when
        ? `${orderSummaryTitle(order)} · ${when}`
        : `${orderSummaryTitle(order)} · ${amount}`,
    }),
    replyTo: order.customerEmail ?? undefined,
  });
}

/**
 * Sent when a buyer reports a manual payment — a bank-transfer reference or
 * an uploaded proof. The money says it moved; only the seller can confirm it.
 */
export async function sendSellerOrderNeedsAction(opts: {
  shop: Shop;
  order: Order;
  to: string;
  /** What the buyer just supplied. */
  supplied: "reference" | "proof";
}): Promise<SendResult> {
  const { shop, order, to, supplied } = opts;
  const amount = formatMoney(order.totalCents, order.currency);

  const body = `
    ${mutedPara(
      supplied === "proof"
        ? `${order.customerName ? strong(esc(order.customerName)) : "A buyer"} uploaded proof of payment for an order at ${esc(shop.name)}.`
        : `${order.customerName ? strong(esc(order.customerName)) : "A buyer"} says they've sent the payment for an order at ${esc(shop.name)}.`,
    )}
    ${section(
      "Order",
      detailTable([
        { label: "What", value: orderSummaryTitle(order) },
        { label: "Total", value: amount },
        { label: "Method", value: methodName(order) },
        { label: "Reference", value: order.paymentReference ?? "" },
      ]),
    )}
    ${fine("Check the money actually arrived before you mark it paid — a reference is a claim, not a receipt.")}
    ${button(ordersUrl(), "Review and confirm")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `Payment reported — ${amount}`,
    html: sailoLayout("A payment needs your confirmation", body, {
      preheader: `${orderSummaryTitle(order)} · ${amount} reported ${supplied === "proof" ? "with proof attached" : "as sent"}.`,
    }),
    replyTo: order.customerEmail ?? undefined,
  });
}

/**
 * Sent when we stop delivering to a webhook endpoint that has failed
 * `failures` times in a row.
 *
 * The only message here that is not about an order, and it exists because the
 * failure it reports is otherwise completely silent. A seller's Zap stops
 * firing; nothing in their inbox, nothing on their dashboard, and the shop
 * carries on selling perfectly — so the first sign is a customer asking why
 * they never got the thing the Zap was supposed to send. An email is the only
 * channel that reaches somebody who is not currently looking at the admin.
 *
 * The URL is named because a shop may have several endpoints and "one of your
 * webhooks" is not actionable. `reason` is whatever the last attempt actually
 * said — a status code, a timeout, a refused address — since that is the
 * sentence they will forward to whoever runs the receiving end.
 */
export async function sendSellerWebhookDisabled(opts: {
  shop: Shop;
  to: string;
  url: string;
  label: string | null;
  reason: string;
  failures: number;
}): Promise<SendResult> {
  const { shop, to, url, label, reason, failures } = opts;

  const body = `
    ${mutedPara(
      `We've stopped sending events to a webhook endpoint on ${esc(shop.name)} after ${failures} failed attempts in a row.`,
    )}
    ${section(
      "The endpoint",
      detailTable([
        { label: "Name", value: label ?? "—" },
        { label: "URL", value: url },
        { label: "Last error", value: reason },
      ]),
    )}
    ${mutedPara(
      "Nothing has been lost from your shop — orders, payments and customers were all recorded normally. What stopped is the copy we were forwarding to this address.",
    )}
    ${fine("Fix the receiving end, then switch the endpoint back on in Settings → Integrations. Events that failed while it was off are not resent.")}
    ${button(`${appUrl()}/admin/settings/integrations`, "Open integrations")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `Webhook switched off — ${label ?? url}`,
    html: sailoLayout("A webhook endpoint stopped working", body, {
      preheader: `${failures} failed attempts in a row. Last error: ${reason}`,
    }),
  });
}

/**
 * Marketing sending was paused automatically — the seller hears it from us,
 * not from a refused Send button three days later.
 *
 * The wording separates the two facts a panicking seller needs separated:
 * what stopped (marketing mail only) and what did not (orders, receipts,
 * the storefront). The same doctrine as the pause itself — a bounce rate
 * may stop broadcasts and may not reach for anything else.
 */
export async function sendSellerMarketingPaused(opts: {
  shop: Shop;
  to: string;
  reason: "complaint_rate" | "bounce_rate";
}): Promise<SendResult> {
  const { shop, to, reason } = opts;

  const what =
    reason === "complaint_rate"
      ? "too many recipients reported your recent emails as spam"
      : "too many of your recent emails bounced";

  const body = `
    ${mutedPara(
      `We've paused marketing email from ${esc(shop.name)} because ${what}. ` +
        `Broadcasts, flows and other marketing messages are held; nothing sends until we've looked at it together.`,
    )}
    ${mutedPara(
      "Everything else is untouched — orders, receipts, download links and your storefront all keep working exactly as before.",
    )}
    ${fine(
      "High complaint or bounce rates usually mean a list with addresses that didn't ask to be on it, or that went stale. " +
        "Reply to this email and tell us where the list came from; once it's cleaned up we'll switch sending back on.",
    )}
    ${button(`${appOrigin()}/admin/broadcasts`, "Open broadcasts")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `Marketing email paused for ${shop.name}`,
    html: sailoLayout("Your marketing email is paused", body, {
      preheader:
        reason === "complaint_rate"
          ? "Recipients reported recent emails as spam."
          : "Too many recent emails bounced.",
    }),
  });
}

/* -------------------------------------------------------------------------- */
/*  Running out                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Stock has fallen to the line the seller drew — spec 51.
 *
 * The other mail here that reports something nobody would otherwise see.
 * `lowStock` matched zero files in this tree, so a seller's first notice of an
 * empty shelf was a buyer asking where their order was — and by then the sale
 * is already lost, along with the fortnight of lead time that would have saved
 * it.
 *
 * It names the *combinations* that are short rather than only the product,
 * because "Speckled Mug is low" is not actionable for a seller who makes them
 * in four glazes: the answer is which glaze to throw next, and that is a
 * different sentence. A product sold as one thing gets the plain number.
 *
 * Deliberately no "reorder" button, no supplier integration and no forecast.
 * The seller knows what to do about their own stockroom; what they did not have
 * was the fact.
 */
export async function sendSellerLowStock(opts: {
  shop: Shop;
  to: string;
  productTitle: string;
  productId: string;
  threshold: number;
  remaining: number;
  /** The combinations at or under the line. Empty for a product with no options. */
  variants: { label: string; remaining: number }[];
}): Promise<SendResult> {
  const { shop, to, productTitle, productId, threshold, remaining, variants } = opts;

  const detail: Detail[] = variants.length
    ? variants.map((v) => ({
        label: v.label,
        value: v.remaining === 0 ? "sold out" : `${v.remaining} left`,
      }))
    : [
        { label: "Left", value: String(remaining) },
        { label: "Your alert", value: `at ${threshold} or fewer` },
      ];

  const body = `
    ${mutedPara(
      `${strong(esc(productTitle))} at ${esc(shop.name)} is down to ${remaining === 0 ? "none" : remaining}, which is at or under the ${threshold} you asked to be told about.`,
    )}
    ${section(variants.length ? "Which ones" : "Stock", detailTable(detail))}
    ${fine(
      "You'll hear about this product once per crossing — this message comes back only after stock goes above your threshold and falls to it again.",
    )}
    ${button(`${appUrl()}/admin/products/${productId}`, "Update stock")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject:
      remaining === 0
        ? `Sold out — ${productTitle}`
        : `Running low — ${productTitle} (${remaining} left)`,
    html: sailoLayout("Stock is running low", body, {
      preheader: `${productTitle}: ${remaining} left, your alert is set at ${threshold}.`,
    }),
  });
}

/* -------------------------------------------------------------------------- */
/*  Memberships                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where the membership mails point.
 *
 * The members list rather than the order queue, because every question these
 * three raise — who is this, what are they on, are they still active — is
 * answered there and none of them are answered by a row in Orders.
 */
function membersUrl(): string {
  return `${appUrl()}/admin/clients`;
}

/** "£12.00 / month", as the seller reads it everywhere else. */
function perInterval(priceCents: number, currency: string, interval: string): string {
  return `${formatMoney(priceCents, currency)} / ${interval}`;
}

/**
 * A new member signed up.
 *
 * The first of three that close a gap the seller could not see: Sailo has run
 * memberships for as long as it has run orders and told the seller nothing
 * about any of them. A one-off sale mails them; a member worth twelve times as
 * much over a year did not, because the recurring path never had a seller
 * notification at all.
 *
 * Deliberately separate from `sendSellerOrderPlaced`, which the signup's own
 * order also triggers. That one says money arrived. This one says a recurring
 * arrangement now exists, which is a different fact with a different lifetime —
 * and it is the one that makes the two mails on signup day worth having rather
 * than redundant. `notifySellerOfMembership` sends only this one for a signup,
 * so the seller gets one message and not two.
 */
export async function sendSellerMembershipStarted(opts: {
  shop: Shop;
  to: string;
  memberName: string | null;
  memberEmail: string | null;
  productTitle: string;
  priceCents: number;
  currency: string;
  interval: string;
  trialEndsAt: Date | null;
}): Promise<SendResult> {
  const { shop, to, memberName, memberEmail, productTitle } = opts;
  const price = perInterval(opts.priceCents, opts.currency, opts.interval);

  const details: Detail[] = [
    { label: "Member", value: memberName ?? memberEmail ?? "A new member" },
    { label: "Plan", value: productTitle },
    { label: "Price", value: price },
  ];
  /*
   * Only when there is one. A trial changes what the seller should expect —
   * no money moves today and the first charge is weeks away — and a "Trial:
   * none" row on every other signup is noise that trains them to skip the
   * table.
   */
  if (opts.trialEndsAt) {
    details.push({
      label: "Trial ends",
      value: formatWhen(opts.trialEndsAt, shop.timeZone),
    });
  }

  const body = `
    ${mutedPara(
      `${memberName ? strong(esc(memberName)) : "Someone"} started a membership at ${esc(shop.name)}.`,
    )}
    ${section("Membership", detailTable(details))}
    ${button(membersUrl(), "See your members")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `New member — ${productTitle}`,
    html: sailoLayout("You have a new member", body, {
      preheader: `${memberName ?? "A new member"} · ${productTitle} · ${price}`,
    }),
    replyTo: memberEmail ?? undefined,
  });
}

/**
 * A member asked to stop, or their membership ended.
 *
 * One builder for both because the seller's next move is identical — look at
 * why, and decide whether to ask — while the *dates* are not, which is what
 * `endsAt` carries. A cancellation is not a departure yet: the member has paid
 * through the end of the period and is still owed everything they bought until
 * then, so a mail that said "X has left" on the day they clicked cancel would
 * be wrong for up to a month and would invite the seller to cut off access
 * somebody is still paying for.
 */
export async function sendSellerMembershipCancelled(opts: {
  shop: Shop;
  to: string;
  memberName: string | null;
  memberEmail: string | null;
  productTitle: string;
  priceCents: number;
  currency: string;
  interval: string;
  /** Null once it has actually ended — see the note above. */
  endsAt: Date | null;
}): Promise<SendResult> {
  const { shop, to, memberName, memberEmail, productTitle, endsAt } = opts;
  const price = perInterval(opts.priceCents, opts.currency, opts.interval);

  const details: Detail[] = [
    { label: "Member", value: memberName ?? memberEmail ?? "A member" },
    { label: "Plan", value: productTitle },
    { label: "Was paying", value: price },
  ];
  if (endsAt) {
    details.push({ label: "Access until", value: formatWhen(endsAt, shop.timeZone) });
  }

  const body = `
    ${mutedPara(
      endsAt
        ? `${memberName ? strong(esc(memberName)) : "A member"} cancelled their membership at ${esc(shop.name)}. They keep access until the end of the period they've already paid for.`
        : `${memberName ? strong(esc(memberName)) : "A member"}'s membership at ${esc(shop.name)} has ended.`,
    )}
    ${section("Membership", detailTable(details))}
    ${fine(
      endsAt
        ? "Nothing to do — Sailo stops the billing and the access on the date above."
        : "Their access has stopped. Reach out if it's worth asking why.",
    )}
    ${button(membersUrl(), "See your members")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: endsAt
      ? `Membership cancelled — ${productTitle}`
      : `Membership ended — ${productTitle}`,
    html: sailoLayout(
      endsAt ? "A member cancelled" : "A membership ended",
      body,
      {
        preheader: `${memberName ?? "A member"} · ${productTitle} · ${price}`,
      },
    ),
    replyTo: memberEmail ?? undefined,
  });
}

/**
 * A renewal payment failed.
 *
 * The one of the three that is genuinely urgent, and the reason the set exists.
 * The member has already been mailed a pay-now link by
 * `handleMembershipInvoiceFailed`; this tells the seller the same thing,
 * because Stripe's dunning eventually gives up and cancels — and a seller who
 * learns about it then has lost the member without ever having had the chance
 * to send a message that would have kept them.
 *
 * `until` is when the access actually stops, which is the date that decides
 * whether the seller has a week to act or an afternoon.
 */
export async function sendSellerMembershipPaymentFailed(opts: {
  shop: Shop;
  to: string;
  memberName: string | null;
  memberEmail: string | null;
  productTitle: string;
  priceCents: number;
  currency: string;
  interval: string;
  until: Date | null;
}): Promise<SendResult> {
  const { shop, to, memberName, memberEmail, productTitle, until } = opts;
  const price = perInterval(opts.priceCents, opts.currency, opts.interval);

  const details: Detail[] = [
    { label: "Member", value: memberName ?? memberEmail ?? "A member" },
    { label: "Plan", value: productTitle },
    { label: "Amount", value: price },
  ];
  if (until) {
    details.push({ label: "Access until", value: formatWhen(until, shop.timeZone) });
  }

  const body = `
    ${mutedPara(
      `A renewal payment failed for ${memberName ? strong(esc(memberName)) : "a member"} at ${esc(shop.name)}.`,
    )}
    ${section("Membership", detailTable(details))}
    ${fine(
      "We've emailed them a link to pay it. Stripe will retry the card for a few days and then cancel the membership — a message from you before that is what usually saves it.",
    )}
    ${button(membersUrl(), "See your members")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `Renewal failed — ${productTitle}`,
    html: sailoLayout("A renewal payment failed", body, {
      preheader: `${memberName ?? "A member"} · ${productTitle} · ${price}`,
    }),
    replyTo: memberEmail ?? undefined,
  });
}

/**
 * "You have taken £7,100 of a £10,000 figure in Germany."
 *
 * The most carefully worded mail in this file, and the wording is the feature.
 * It states two numbers and a place, and it stops. It does not say the seller
 * must register, must charge anything, or has done anything wrong — those are
 * legal claims, and `GAP-2026-08-easytools.md` §4.3 is the argument for why
 * Sailo does not make them. The seller draws the conclusion; the link goes to
 * the tab where the working is shown, including the date the figure was last
 * checked.
 *
 * Sent at most twice per place per calendar year, at 70% and 90%, and the claim
 * that makes "at most" true is a conditional UPDATE in `tax_country_rules` —
 * not a read followed by a write, which two overlapping cron ticks both pass.
 */
export async function sendSellerTaxThreshold(opts: {
  /** Only the name is used, so the monitor need not load a whole `Shop`. */
  shopName: string;
  to: string;
  /** "Germany", "California", "the EU" — already in the seller's words. */
  place: string;
  rung: "70" | "90";
  netCents: number;
  thresholdCents: number;
  currency: string;
  /** The date the published figure was last reviewed. Never omitted. */
  reviewedOn: string;
  /** Set when the figures were compared through an indicative rate. */
  converted: boolean;
}): Promise<SendResult> {
  const { shopName, to, place, rung, currency, reviewedOn, converted } = opts;
  const taken = formatMoney(opts.netCents, currency);
  const limit = formatMoney(opts.thresholdCents, currency);

  const body = `
    ${mutedPara(
      `Sales from ${esc(shopName)} into ${strong(esc(place))} have reached ${strong(rung)}% of the registration threshold published for that place.`,
    )}
    ${section(
      "Where it stands",
      detailTable([
        { label: "Place", value: place },
        { label: "Taken", value: taken },
        { label: "Published threshold", value: limit },
        { label: "Figure last checked", value: reviewedOn },
      ]),
    )}
    ${fine(
      converted
        ? "Your sales and that threshold are in different currencies, so they were compared at an indicative rate — treat the percentage as a signal rather than an exact position."
        : "Only sales to individuals count toward this. Business sales are shown separately on the tab.",
    )}
    ${fine(
      "This is a count of what you have taken, not tax advice. Thresholds change, and whether you need to register anywhere is a question for your accountant.",
    )}
    ${button(`${appUrl()}/admin/settings/tax`, "See the working")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `${rung}% of the ${place} threshold`,
    html: sailoLayout(`Sales into ${place} are at ${rung}%`, body, {
      preheader: `${taken} of ${limit}`,
    }),
  });
}

/**
 * "Somebody asked for your checklist."
 *
 * Deliberately small. A lead is not a sale and this mail must not read like
 * one — no total, no order number, no "you have a new order". What the seller
 * needs is that it happened and where to look, and anything more would train
 * them to skim the mail that does carry money.
 */
export async function sendSellerLead(opts: {
  shopName: string;
  to: string;
  productTitle: string;
  leadEmail: string;
  leadName: string | null;
}): Promise<SendResult> {
  const { shopName, to, productTitle, leadEmail, leadName } = opts;

  const body = `
    ${mutedPara(
      `${leadName ? strong(esc(leadName)) : "Someone"} asked for ${strong(esc(productTitle))} at ${esc(shopName)}.`,
    )}
    ${section(
      "Who",
      detailTable([
        { label: "Name", value: leadName ?? "Not given" },
        { label: "Email", value: leadEmail },
      ]),
    )}
    ${button(`${appUrl()}/admin/clients`, "See your contacts")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `New lead — ${productTitle}`,
    html: sailoLayout("Somebody left their details", body, {
      preheader: `${leadName ?? leadEmail} · ${productTitle}`,
    }),
    replyTo: leadEmail,
  });
}
