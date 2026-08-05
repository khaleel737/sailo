import "server-only";
import { Resend } from "resend";

/** Getting mail out, and saying plainly when it didn't go. */

let client: Resend | null = null;

function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY);

/**
 * Every address we send from lives on one domain, and that domain has to stay
 * verified in Resend or nothing leaves the building. Overridable so a staging
 * deploy can point at a different verified domain rather than mailing buyers
 * from production's.
 */
const MAIL_DOMAIN = process.env.SAILO_MAIL_DOMAIN ?? "sailo.store";

/** Anything a buyer gets about an order they placed. */
export const ORDERS = `orders@${MAIL_DOMAIN}`;
/** Sailo speaking for itself, to the people who promote shops. */
export const PARTNERS = `partners@${MAIL_DOMAIN}`;
/** Anything about the seller's own Sailo login, not their shop. */
export const ACCOUNTS = `accounts@${MAIL_DOMAIN}`;

/**
 * Builds a From header.
 *
 * The address is always ours — it's the one Resend has verified — but the name
 * beside it is the shop's, because the buyer bought from them and not from us.
 * `replyTo` then carries the conversation to the seller's real inbox.
 *
 * Shop names are seller-supplied and end up in a mail header, so a newline
 * never survives: it would let a name inject headers of its own. Quotes and
 * backslashes are escaped rather than stripped, since plenty of shops
 * legitimately have them.
 */
export function sender(displayName: string, address: string) {
  const safe = displayName
    .replace(/[\r\n]+/g, " ")
    .replace(/["\\]/g, "\\$&")
    .trim()
    .slice(0, 78);
  return safe ? `"${safe}" <${address}>` : address;
}

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: string };

export async function send(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<SendResult> {
  const api = resend();
  if (!api) return { sent: false, reason: "RESEND_API_KEY is not set" };

  try {
    const { data, error } = await api.emails.send({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      replyTo: opts.replyTo,
    });
    if (error) return { sent: false, reason: error.message };
    return { sent: true, id: data?.id ?? "" };
  } catch (error) {
    // Email must never take an order down with it.
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "unknown error",
    };
  }
}
