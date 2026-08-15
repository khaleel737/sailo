import "server-only";
/*
 * The three an order's own lifecycle sends moved to `@sailo/email/orders`,
 * because `packages/api` has to send them too — a refund from the phone moves
 * money, and nobody being told is worse than no button.
 *
 * Re-exported so the callers here are unchanged. The rest of this file stays:
 * every other message is triggered by something only the website has — a
 * checkout completing, a webhook arriving, a schedule running.
 */
export type { EventDetails } from "@sailo/email/orders";
import { eventBlock, type EventDetails } from "@sailo/email/orders";
export {
  sendBookingDecision,
  sendDownloadReady,
  sendRefundNotification,
  sendShippingNotification,
} from "@sailo/email/orders";
import type { Order, Shop } from "@sailo/db/schema";
import { orderSummaryTitle, type OrderLine } from "@/lib/order-lines";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { formatAddress, formatMoney } from "@/lib/utils";
import { appUrl } from "@/lib/app-url";
import { SUPPORT_TOPIC_LABELS, type SupportTopic } from "@/lib/support";
import { ACCOUNTS, ORDERS, PARTNERS, SUPPORT, send, sender, type SendResult } from "@sailo/email/transport";
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
} from "@sailo/email/markup";

/** Every message Sailo sends. */

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
 * Sent the moment someone becomes an active affiliate — approved from the
 * waiting list or added by the seller. This is how they learn where their
 * report lives; without it the only copy of the portal link sits in the
 * seller's admin, waiting to be pasted into a chat that may never happen.
 */
export async function sendAffiliateWelcome(opts: {
  to: string;
  shopName: string;
  /** "10" — already formatted, the way the shop shows it. */
  percent: string;
  shareUrl: string;
  portalUrl: string;
}): Promise<SendResult> {
  const { to, shopName, percent, shareUrl, portalUrl } = opts;

  // Share URLs run long; without a break they widen the card off a phone.
  const linkPara = (href: string) =>
    `<p style="margin:0;font-size:15px;line-height:1.6;word-break:break-all;">${link(href, href)}</p>`;

  const html = sailoLayout(
    `You're in — share ${esc(shopName)}, earn ${esc(percent)}%`,
    `${mutedPara(
      `Every order placed through your link earns you ${strong(`${percent}%`)} of the sale.`,
    )}
      ${section("Your link to share", linkPara(shareUrl))}
      ${section("Your referral report", linkPara(portalUrl))}
      ${fine(
        `The report shows your clicks, orders and what you're owed, and it's where you tell ${esc(shopName)} how you'd like to be paid. Keep the link to yourself: anyone who has it can see your earnings.`,
      )}`,
    { preheader: `Share ${shopName} and earn ${percent}% of every order.` },
  );

  return send({
    from: sender("Sailo", PARTNERS),
    to,
    subject: `Share ${shopName}, earn ${percent}% of every order`,
    html,
  });
}

/**
 * Sent to the affiliate whenever the payout details on their report change.
 *
 * This mail is the countermeasure to the portal's one real attack. The report
 * is opened by a bare link, and a leaked link would let a stranger quietly
 * point the commission at their own account. The change still goes through —
 * the token is the only credential there is — but it can never go through
 * silently: the owner of the email always hears about it, and the mail tells
 * them exactly which lever to pull if it wasn't them.
 */
export async function sendPayoutDetailsChanged(opts: {
  to: string;
  shopName: string;
  /** "Bank transfer" — English, like every mail Sailo sends. */
  methodLabel: string;
  /** Already masked. This mail must not be a second copy of the details. */
  maskedDetails: string;
  portalUrl: string;
}): Promise<SendResult> {
  const { to, shopName, methodLabel, maskedDetails, portalUrl } = opts;

  const html = sailoLayout(
    "Your payout details changed",
    `${mutedPara(
      `The payout details on your referral report for ${esc(shopName)} were just changed to ${strong(`${methodLabel} · ${maskedDetails}`)}.`,
    )}
      ${mutedPara(
        `If that was you, you're done. If it wasn't, someone else has your report link: open your report, put your own details back, and reset the link — the old one stops working the moment you do. Then tell ${esc(shopName)} so they hold your payout.`,
      )}
      ${button(portalUrl, "Open your report")}`,
    { preheader: `Payout details for ${shopName} are now ${methodLabel} · ${maskedDetails}.` },
  );

  return send({
    from: sender("Sailo", PARTNERS),
    to,
    subject: "Your payout details changed",
    html,
  });
}

/**
 * A seller's support ticket, delivered to our inbox with the seller in CC.
 *
 * The CC is the mechanism, not a courtesy: it puts both addresses on one
 * thread, so support answers by replying and the seller's copy doubles as
 * their confirmation. `replyTo` points at the seller for the same reason —
 * a plain reply from the support inbox goes to them, not back to us.
 */
export async function sendSupportTicket(opts: {
  shopName: string;
  handle: string;
  /** The seller's login email — CC'd, and where a reply lands. */
  email: string;
  topic: SupportTopic;
  subject: string;
  message: string;
  imageUrls: string[];
  ticketId: string;
}): Promise<SendResult> {
  const { shopName, handle, email, topic, subject, message, imageUrls, ticketId } = opts;
  const base = appUrl();

  const screenshots = imageUrls
    .map(
      (url, i) =>
        `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;">${link(url, `Screenshot ${i + 1}`)}</p>`,
    )
    .join("");

  const html = sailoLayout(
    subject,
    `${detailTable([
      { label: "Shop", value: `${shopName} (@${handle})`, href: `${base}/${handle}` },
      { label: "From", value: email },
      { label: "Topic", value: SUPPORT_TOPIC_LABELS[topic] },
      { label: "Ticket", value: ticketId },
    ])}
      ${section("Message", well(message))}
      ${imageUrls.length > 0 ? section("Screenshots", screenshots) : ""}
      ${fine(
        `Reply to this email to answer — the seller is in CC. Close the ticket in ${link(`${base}/hq/support`, "HQ")} when it's done.`,
      )}`,
    { preheader: `${shopName} (@${handle}) — ${SUPPORT_TOPIC_LABELS[topic]}` },
  );

  return send({
    from: sender(shopName, SUPPORT),
    to: SUPPORT,
    cc: email,
    replyTo: email,
    subject: `[${topic}] ${subject} · @${handle}`,
    html,
  });
}




/**
 * The way into /hq. Staff don't have a password to type — this link, sent only
 * to an address on the roster in `lib/staff.ts`, is the whole sign-in.
 *
 * As sparse as the password reset, and for the same reason: it lands in an
 * inbox, and inboxes get read by the wrong people. It names no panel features
 * and carries nothing but the link and how long it lasts.
 */
export async function sendHqSignInLink(opts: {
  to: string;
  url: string;
  /** How long the link stays good, in whole minutes. */
  expiresInMinutes: number;
}): Promise<SendResult> {
  const { to, url, expiresInMinutes } = opts;

  const body = `
    ${mutedPara(`Here's your sign-in link for ${strong(to)}.`)}
    ${button(url, "Sign in")}
    ${fine(
      `This link works once, and expires in ${expiresInMinutes} minute${expiresInMinutes === 1 ? "" : "s"}.`,
    )}
    ${fine("If you didn't ask for it, ignore this email — nobody gets in without it.")}
  `;

  return send({
    from: sender("Sailo", ACCOUNTS),
    to,
    subject: "Your Sailo sign-in link",
    html: sailoLayout("Sign in to Sailo", body, {
      preheader: `Your one-time sign-in link — expires in ${expiresInMinutes} minutes.`,
    }),
  });
}

/**
 * Proof that a new seller's address is really theirs.
 *
 * Sent on sign-up. Not a gate — they can use their admin while it waits — but
 * until they click it, the account is only a claim to an inbox, and a claim is
 * all an impostor has. Sparse like the other account mail: whoever typed the
 * address might not be its owner, and the wrong inbox should learn nothing.
 */
export async function sendEmailConfirmation(opts: {
  to: string;
  name?: string | null;
  url: string;
}): Promise<SendResult> {
  const { to, name, url } = opts;

  const body = `
    ${mutedPara(
      `${name ? `Hi ${esc(name)} — ` : ""}a Sailo account was just created with ${strong(to)}. One click confirms this address is yours.`,
    )}
    ${button(url, "Confirm my email")}
    ${fine("If you didn't create this account, ignore this email — unconfirmed, it goes nowhere.")}
  `;

  return send({
    from: sender("Sailo", ACCOUNTS),
    to,
    subject: "Confirm your email",
    html: sailoLayout("Confirm your email", body, {
      preheader: "One click confirms this address is yours.",
    }),
  });
}

/**
 * The link that lets someone back into their own account.
 *
 * Deliberately sparse: no order data, no shop branding, nothing worth
 * harvesting if it lands in the wrong inbox. It says how long the link lasts
 * and what to do if they didn't ask for it, because a reset mail nobody
 * requested is the first sign of someone trying the door.
 */
export async function sendPasswordReset(opts: {
  to: string;
  name?: string | null;
  url: string;
  /** How long the link stays good, in whole hours. */
  expiresInHours: number;
}): Promise<SendResult> {
  const { to, name, url, expiresInHours } = opts;

  const body = `
    ${mutedPara(
      `${name ? `Hi ${esc(name)} — ` : ""}someone asked to reset the password for the Sailo account on ${strong(to)}.`,
    )}
    ${button(url, "Choose a new password")}
    ${fine(
      `This link works once, and expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"}.`,
    )}
    ${fine("If this wasn't you, ignore this email — your password stays as it is.")}
  `;

  return send({
    from: sender("Sailo", ACCOUNTS),
    to,
    subject: "Reset your Sailo password",
    html: sailoLayout("Reset your password", body, {
      preheader: `Your password reset link — expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"}.`,
    }),
  });
}

/**
 * Sent whenever two-factor authentication is switched on or off.
 *
 * The change goes through either way — whoever made it proved a password and
 * a code — but it must never go through *silently*: quietly disabling 2FA is
 * the first move of someone who has stolen a password, and this mail is the
 * one place the real owner finds out in time to act. Every other session is
 * revoked in the same breath (see `lib/actions/security.ts`), so the mail
 * also explains why other devices were signed out.
 */
export async function sendTwoFactorChanged(opts: {
  to: string;
  name?: string | null;
  enabled: boolean;
}): Promise<SendResult> {
  const { to, name, enabled } = opts;

  const body = `
    ${mutedPara(
      `${name ? `Hi ${esc(name)} — ` : ""}two-factor authentication on your Sailo account was just ${strong(enabled ? "turned on" : "turned off")}.`,
    )}
    ${mutedPara(
      "Every other signed-in device was signed out at the same moment, so only whoever made this change is still in.",
    )}
    ${fine(
      enabled
        ? "If this was you, you're done — from now on, signing in asks for a code from your authenticator app."
        : "If this was you, you're done — signing in goes back to just your password.",
    )}
    ${fine(
      "If this wasn't you, someone else has your password: reset it immediately from the sign-in page, and contact support.",
    )}
  `;

  return send({
    from: sender("Sailo", ACCOUNTS),
    to,
    subject: enabled
      ? "Two-factor authentication was turned on"
      : "Two-factor authentication was turned off",
    html: sailoLayout(
      enabled ? "Two-factor is on" : "Two-factor is off",
      body,
      {
        preheader: `Two-factor authentication was just ${enabled ? "enabled" : "disabled"} on your account.`,
      },
    ),
  });
}

/**
 * The last mail an account ever gets, sent BEFORE the address is overwritten
 * with its tombstone — after that there is no way to reach them at all. It
 * names the escape hatch: a reply window, in case the deletion was someone
 * else holding the session.
 */
export async function sendAccountDeleted(opts: {
  to: string;
  name?: string | null;
  shopName: string;
}): Promise<SendResult> {
  const { to, name, shopName } = opts;

  const body = `
    ${mutedPara(
      `${name ? `Hi ${esc(name)} — ` : ""}your Sailo account and your shop ${strong(esc(shopName))} were just deleted at your request.`,
    )}
    ${mutedPara(
      "Your products, images and settings are gone, and your page is offline. Records of orders you already completed are kept, without your personal details, because invoices that document real payments have to survive for tax purposes.",
    )}
    ${fine(
      "If this wasn't you, reply to this email within 30 days and we'll investigate — after that, we can no longer reach you at this address.",
    )}
  `;

  return send({
    from: sender("Sailo", ACCOUNTS),
    to,
    subject: "Your Sailo account was deleted",
    html: sailoLayout("Account deleted", body, {
      preheader: `Your Sailo account and ${shopName} were deleted.`,
    }),
    replyTo: SUPPORT,
  });
}

/**
 * The one email a shop may send to an address that has not consented to
 * anything — because it is the email that asks.
 *
 * Transactional, not marketing: it is the direct, immediate answer to
 * somebody typing that address into a form seconds earlier, it carries no
 * offer, and it is the only way the consent it asks for can ever be given.
 * Everything else this feature sends is gated on the answer.
 *
 * It deliberately says what happens if the recipient did *not* ask. A signup
 * form is a way to type a stranger's address, so the person who did not ask
 * needs to read, in the first screenful, that ignoring this email is the
 * whole of the action required — and that nothing has been added anywhere
 * yet.
 */
export async function sendSubscribeConfirmation(opts: {
  shop: Shop;
  to: string;
  name: string | null;
  confirmUrl: string;
  labels: {
    subject: string;
    title: string;
    body: string;
    cta: string;
  };
}): Promise<SendResult> {
  const { shop, labels } = opts;

  const body = `
    ${para(
      `${opts.name ? `${esc(opts.name)}, ` : ""}${esc(labels.body)}`,
    )}
    ${button(opts.confirmUrl, labels.cta)}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: opts.to,
    subject: labels.subject,
    html: layout(shop, labels.title, body, { preheader: labels.subject }),
    replyTo: shop.contactEmail ?? undefined,
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
