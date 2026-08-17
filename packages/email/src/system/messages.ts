import "server-only";
import type { Shop } from "@sailo/db/schema";
import { SUPPORT_TOPIC_LABELS, type SupportTopic } from "@sailo/core/support";
import { ACCOUNTS, SUPPORT, send, sender, type SendResult } from "../transport";
import { appOrigin } from "@sailo/core/origin";
import {
  button,
  detailTable,
  esc,
  fine,
  link,
  mutedPara,
  sailoLayout,
  section,
  strong,
  well,
} from "../markup";

/**
 * Mail about an account, not about a shop.
 *
 * Confirming an address, resetting a password, saying a second factor was
 * turned on or off, saying an account was deleted, filing a support ticket,
 * signing a staff member into HQ. None of it mentions a product, and all of it
 * is sent whether or not the recipient sells anything.
 *
 * Kept apart from the shop's mail because the failure modes differ in kind. A
 * shop notice that does not arrive costs a seller a sale; a password reset that
 * does not arrive locks somebody out of their business, and a two-factor notice
 * that does not arrive is how an account takeover goes unnoticed. These are the
 * messages that must never be batched, throttled, or made subject to a
 * preference.
 */

/** This deployment's origin — see `../origin` for why it is read, not passed. */
const appUrl = appOrigin;

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

