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
/** Sellers asking us for help — the inbox the team answers from. */
export const SUPPORT = `support@${MAIL_DOMAIN}`;
/**
 * Sailo's own lifecycle and product mail to sellers.
 *
 * Its own address rather than a reuse of `ACCOUNTS`, and the separation is
 * the point rather than tidiness. Mailbox providers score reputation per
 * sending address as well as per domain, and marketing is the traffic that
 * earns complaints. Keeping it off the address that carries password resets
 * and email confirmations means a bad campaign cannot land a seller's
 * *sign-in* mail in spam — which is the one failure they could never diagnose
 * and we could never see.
 */
export const MARKETING = `marketing@${MAIL_DOMAIN}`;

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

export type Message = {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /** Carbon copy — how a support ticket puts us and the seller on one thread. */
  cc?: string;
  /**
   * Extra headers, for the ones that are protocol rather than content.
   *
   * `List-Unsubscribe` and `List-Unsubscribe-Post` are the reason this
   * exists: Gmail and Outlook both require them on bulk mail, and they are
   * what puts a one-click unsubscribe in the mail client's own chrome — which
   * is the difference between somebody unsubscribing and somebody pressing
   * "report spam", and the second one damages every other seller sending
   * through this domain.
   */
  headers?: Record<string, string>;
  /** Plain-text alternative. Bulk mail without one reads as bulk mail. */
  text?: string;
};

export async function send(opts: Message): Promise<SendResult> {
  const api = resend();
  if (!api) return { sent: false, reason: "RESEND_API_KEY is not set" };

  try {
    const { data, error } = await api.emails.send({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      replyTo: opts.replyTo,
      cc: opts.cc,
      headers: opts.headers,
      text: opts.text,
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

/** What one batch may carry. Resend's own ceiling, not a number we chose. */
export const MAX_BATCH = 100;

/**
 * Sends up to `MAX_BATCH` messages in one call.
 *
 * Returns one result per message, in the order given, so a caller can mark
 * each delivery row with what actually happened to it. A batch-level failure
 * becomes the same failure repeated per message rather than an exception,
 * because the caller's next move is identical either way: record it against
 * every row it was going to send.
 *
 * Resend's batch endpoint returns ids without saying which is which beyond
 * position, which is why this preserves order rather than keying by address —
 * two recipients cannot share an address inside one broadcast anyway (the
 * unique index sees to that), but position is the contract the API actually
 * offers.
 */
export async function sendBatch(messages: Message[]): Promise<SendResult[]> {
  if (messages.length === 0) return [];

  const api = resend();
  const fail = (reason: string) =>
    messages.map((): SendResult => ({ sent: false, reason }));

  if (!api) return fail("RESEND_API_KEY is not set");
  if (messages.length > MAX_BATCH) return fail(`batch larger than ${MAX_BATCH}`);

  try {
    const { data, error } = await api.batch.send(
      messages.map((m) => ({
        from: m.from,
        to: m.to,
        subject: m.subject,
        html: m.html,
        replyTo: m.replyTo,
        headers: m.headers,
        text: m.text,
      })),
    );
    if (error) return fail(error.message);

    const ids = data?.data ?? [];
    return messages.map((_, i) => {
      const id = ids[i]?.id;
      return id
        ? { sent: true, id }
        : // Fewer ids than messages is the provider telling us it did not
          // accept them all, and guessing which is worse than saying so.
          { sent: false, reason: "the provider returned no id for this message" };
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "unknown error");
  }
}
