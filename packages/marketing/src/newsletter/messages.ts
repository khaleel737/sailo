import "server-only";
import {
  MARKETING,
  send,
  type SendResult,
} from "@sailo/mailer/transport";
import { button, esc, mutedPara, para, sailoLayout } from "@sailo/mailer/markup";
import { appOrigin } from "@sailo/core/origin";
import {
  marketingOptOutPostUrl,
  marketingOptOutToken,
  marketingOptOutUrl,
} from "../lifecycle/unsubscribe";

/**
 * The two emails the signup form itself sends: the one that asks, and the one
 * that says yes.
 *
 * Both go out on `MARKETING`, never on `ACCOUNTS`. Mailbox providers score
 * reputation per sending address as well as per domain, and this is the stream
 * that earns complaints — keeping it off the address carrying password resets
 * means a bad campaign cannot land somebody's *sign-in* mail in spam, which is
 * the one failure they could never diagnose and we could never see.
 *
 * The copy is passed in rather than written here. Thirty-five languages
 * publish on this blog and a reader who subscribed from a Portuguese article
 * is owed Portuguese; the dictionary lives with the rest of the marketing
 * copy, and this module renders whatever it is handed.
 */

export type ConfirmLabels = {
  subject: string;
  heading: string;
  body: string;
  cta: string;
  /** What to do if you did not ask for this. Never omitted — see below. */
  ignore: string;
};

/**
 * The one email Sailo may send to an address that has consented to nothing —
 * because it is the email that asks.
 *
 * Transactional in every sense that matters: it is the direct answer to
 * somebody typing that address into a form seconds earlier, it carries no
 * offer, and it is the only way the consent it asks for can ever be given.
 * It therefore has no unsubscribe link, and that is correct rather than an
 * omission — there is nothing yet to unsubscribe from.
 *
 * `ignore` is not optional and not decoration. A public signup form is a way
 * to type a stranger's address, so the person who did *not* ask has to read,
 * in the first screenful, that ignoring this is the whole of the action
 * required and that nothing has been recorded anywhere yet. It is also true:
 * no row exists until this link is clicked.
 */
export async function sendNewsletterConfirmation(opts: {
  to: string;
  name: string | null;
  confirmUrl: string;
  labels: ConfirmLabels;
}): Promise<SendResult> {
  const { labels } = opts;

  const body = `
    ${para(`${opts.name ? `${esc(opts.name)}, ` : ""}${esc(labels.body)}`)}
    ${button(opts.confirmUrl, labels.cta)}
    ${mutedPara(esc(labels.ignore))}
  `;

  return send({
    from: `Sailo <${MARKETING}>`,
    to: opts.to,
    subject: labels.subject,
    html: sailoLayout(labels.heading, body, { preheader: labels.subject }),
    text: `${labels.body}\n\n${opts.confirmUrl}\n\n${labels.ignore}`,
  });
}

export type WelcomeLabels = {
  subject: string;
  heading: string;
  body: string;
  cta: string;
  unsubscribe: string;
};

/**
 * The first email somebody gets as a subscriber, sent the moment they confirm.
 *
 * Sent rather than skipped because the confirmation click happens in a mail
 * client — often on a different device from the one they typed the address
 * into — and the page they land on is the last thing they will see from us
 * for a fortnight. A welcome in the inbox is what makes the next campaign
 * recognised instead of reported.
 *
 * It carries a working unsubscribe link, and the send is *refused* without one
 * rather than sent bare. This is marketing mail: a footer and a
 * `List-Unsubscribe` header pointing at nothing is not something we may send
 * in any jurisdiction this operates in, and failing loudly here is how that
 * stays true when a signing secret goes missing from an environment.
 */
export async function sendNewsletterWelcome(opts: {
  to: string;
  name: string | null;
  labels: WelcomeLabels;
  /** Where the button goes. The blog, usually. */
  ctaUrl?: string;
}): Promise<SendResult> {
  const { labels } = opts;

  const token = marketingOptOutToken({ email: opts.to });
  if (!token) return { sent: false, reason: "no unsubscribe signing secret" };

  const optOutUrl = marketingOptOutUrl(token);
  const body = `
    ${para(`${opts.name ? `${esc(opts.name)}, ` : ""}${esc(labels.body)}`)}
    ${button(opts.ctaUrl ?? `${appOrigin()}/blog`, labels.cta)}
  `;

  return send({
    from: `Sailo <${MARKETING}>`,
    to: opts.to,
    subject: labels.subject,
    html: sailoLayout(labels.heading, body, {
      preheader: labels.subject,
      unsubscribeUrl: optOutUrl,
    }),
    text: `${labels.body}\n\n${opts.ctaUrl ?? `${appOrigin()}/blog`}\n\n${labels.unsubscribe}: ${optOutUrl}`,
    /*
     * The two headers Gmail and Outlook require on bulk mail, and the reason
     * they are worth the trouble: they put a one-click unsubscribe in the mail
     * client's own chrome, which is the difference between somebody leaving
     * the list and somebody pressing "report spam" — and the second damages
     * every other message this domain carries.
     */
    headers: newsletterHeaders(token),
  });
}

/**
 * `List-Unsubscribe` and its RFC 8058 companion, built from one token.
 *
 * Exported because the campaign send path needs exactly the same pair, and a
 * second copy of these two header names is one typo away from mail that Gmail
 * treats as bulk with no way out.
 */
export function newsletterHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${marketingOptOutPostUrl(token)}>, <${marketingOptOutUrl(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
