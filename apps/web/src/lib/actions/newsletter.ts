"use server";

import { headers } from "next/headers";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { rateLimit } from "@sailo/rate-limit";
import { getBlogDictionary } from "@sailo/i18n/marketing/blog";
import { getDictionary } from "@sailo/i18n";
import { DEFAULT_LOCALE, isLocale } from "@sailo/i18n/config";
import {
  confirmNewsletterSubscriber,
  newsletterConfirmUrl,
  newsletterToken,
  readNewsletterToken,
  sendNewsletterConfirmation,
  sendNewsletterWelcome,
} from "@sailo/marketing/newsletter/server";
import {
  DEFAULT_NEWSLETTER_SOURCE,
  isNewsletterSource,
  normalizeEmail,
  normalizeSourcePath,
} from "@sailo/marketing/newsletter";
import { blogIndexPath } from "@/lib/blog-urls";
import { absolute } from "@sailo/core/origin";

/**
 * The public end of Sailo's own mailing list.
 *
 * Two actions, both unauthenticated by necessity — a reader asking to hear
 * from us has no account and must not need one — and both written to the same
 * rule as their shop-side counterparts in `./subscribe`: **the answer never
 * depends on what the database contains.**
 *
 * A signup form that says "you're already subscribed" is an address checker
 * anyone can point at our list; one that says "we don't have that address" is
 * the same tool with its answers inverted. So the form reads nothing, writes
 * nothing, and returns one sentence in every case. What it does is send a
 * signed link to the address itself, and that link is the only thing that can
 * turn an address into a subscriber.
 */

export type NewsletterState = {
  /** The form's one answer: sent, or not sent because of something local. */
  done: boolean;
  error?: string;
};

export type NewsletterConfirmState = {
  done: boolean;
  error?: string;
};

export async function subscribeToNewsletter(
  _prev: NewsletterState,
  formData: FormData,
): Promise<NewsletterState> {
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const b = getBlogDictionary(locale);

  const email = normalizeEmail(formData.get("email"));

  /*
   * The address is checked before anything else and is the *only* thing this
   * action will refuse over. It is not an oracle: whether a string is shaped
   * like an email address is knowable without our database.
   */
  if (!email) return { done: false, error: b.subscribeInvalid };

  /*
   * Two buckets, rationing two different abuses — and answering differently,
   * because only one of them can be true.
   *
   * The per-address bucket stops one inbox being mailed over and over. A
   * caller who trips it submitted that address minutes ago, so "check your
   * inbox" is a true sentence: their link is already there. It reveals
   * nothing, because it reports the caller's own recent behaviour rather than
   * anything in our database.
   *
   * The per-IP bucket is different. An office, a café or a mobile carrier can
   * put dozens of unrelated people behind one address, so a first-time
   * subscriber can trip it having done nothing — and telling *them* to check
   * an inbox nothing was sent to leaves them waiting forever. Throttled is
   * unknown, never a positive answer.
   */
  const [byIp, byEmail] = await Promise.all([
    /*
     * DECISION B — both fail closed (public write, and it spends the send
     * quota).
     *
     * Unauthenticated, creates a row, and mails a confirmation. With no ceiling
     * it is an open relay pointed at any address somebody types, charged against
     * the same Resend reputation that carries buyers' receipts — so an hour of
     * failing open costs more than the hour of signups it refuses.
     */
    rateLimit(`newsletter-ip:${await callerIp()}`, 8, 600, { onOutage: "closed" }),
    rateLimit(`newsletter-email:${email}`, 2, 3_600, { onOutage: "closed" }),
  ]);
  if (!byIp.allowed) return { done: false, error: b.subscribeTooMany };
  if (!byEmail.allowed) return { done: true };

  const rawSource = formData.get("source");
  const source = isNewsletterSource(rawSource)
    ? rawSource
    : DEFAULT_NEWSLETTER_SOURCE;

  /*
   * Where they were standing, taken from the form and then checked again.
   *
   * The hidden field is the only thing that knows which article converted —
   * the action has no other view of the page it was submitted from. It is also
   * attacker-shaped for exactly that reason, so `normalizeSourcePath` refuses
   * anything that is not a same-origin path rather than repairing it. The
   * `Referer` header is the fallback and not the primary, because a browser is
   * free to suppress it and many do.
   */
  const path =
    normalizeSourcePath(formData.get("path")) ?? (await refererPath());

  const token = newsletterToken({
    email,
    name: null,
    locale,
    source,
    path,
  });
  if (!token) {
    /*
     * No signing secret means no confirmable link, and an unconfirmable
     * signup is one that would either do nothing or — far worse — subscribe
     * somebody who never proved the address was theirs.
     *
     * Reported with the generic error and *not* with `subscribeInvalid`. This
     * is our environment missing a variable; telling the visitor their address
     * "doesn't look right" would blame them for it, and they would retype a
     * perfectly good address until they gave up.
     */
    return { done: false, error: getDictionary(locale).errors.body };
  }

  const result = await sendNewsletterConfirmation({
    to: email,
    name: null,
    confirmUrl: newsletterConfirmUrl(token),
    labels: {
      subject: b.mailSubject,
      heading: b.confirmTitle,
      body: b.mailBody,
      cta: b.mailCta,
      ignore: b.mailIgnore,
    },
  });

  /*
   * A transport failure is reported, and with the generic error rather than
   * either of this form's two specific ones.
   *
   * It says nothing about the address — the send failed on our side — so
   * "that address doesn't look right" would be untrue, and "too many sign-ups
   * from here" would be untrue in a way that makes the visitor wait several
   * minutes before finding out it is still broken. Telling them to check an
   * inbox nothing was sent to is worse than both.
   */
  return result.sent
    ? { done: true }
    : { done: false, error: getDictionary(locale).errors.body };
}

/** The path of the page the form was submitted from, when the browser says. */
async function refererPath(): Promise<string | null> {
  const referer = (await headers()).get("referer");
  if (!referer) return null;
  try {
    return normalizeSourcePath(new URL(referer).pathname);
  } catch {
    return null;
  }
}

/**
 * The confirm page's button.
 *
 * A POST, and never a GET. Every URL in an email is fetched by scanners, link
 * checkers and corporate security gateways; a GET that subscribed somebody
 * would add people who never opened the message, which is precisely the
 * consent this whole flow exists to establish.
 */
export async function confirmNewsletter(
  _prev: NewsletterConfirmState,
  formData: FormData,
): Promise<NewsletterConfirmState> {
  const gate = await rateLimit(`newsletter-confirm:${await callerIp()}`, 30, 60);
  if (!gate.allowed) {
    // Throttled is unknown, never a positive answer: somebody told "you're on
    // the list" who is not on it will wonder why nothing ever arrives.
    /*
     * Throttled reads as expired rather than as success. The alternative —
     * "you're on the list" to somebody who is not — leaves them wondering for
     * a fortnight why nothing arrived, and the fix ("sign up again") is the
     * one this sentence already offers.
     */
    return {
      done: false,
      error: getBlogDictionary(DEFAULT_LOCALE).expiredBody,
    };
  }

  const claim = readNewsletterToken(String(formData.get("token") ?? ""));
  if (!claim) {
    return {
      done: false,
      error: getBlogDictionary(DEFAULT_LOCALE).expiredBody,
    };
  }

  const b = getBlogDictionary(claim.locale);
  const outcome = await confirmNewsletterSubscriber(claim);

  /*
   * `refused` is a bounce or a spam complaint on this address, and the visitor
   * is told the same thing as everybody else.
   *
   * Not a lie by omission: the promise this page makes is "we may now email
   * you", and for a hard-bounced address our mailing them is not something
   * anybody can deliver on anyway. Explaining that a previous recipient at
   * this address reported us for spam would disclose one person's action to
   * whoever holds the address today.
   */
  if (outcome !== "subscribed") return { done: true };

  /*
   * The welcome, sent only on a genuine first-time confirmation and never
   * awaited for its result beyond logging.
   *
   * The visitor is looking at a page that has already told them they are on
   * the list, and a mail vendor having a bad minute must not turn that into an
   * error in front of somebody who did exactly what we asked. A missing
   * welcome is a small loss; a red error on a successful confirmation is a
   * subscriber who assumes it did not work and does it again.
   */
  const welcome = await sendNewsletterWelcome({
    to: claim.email,
    name: claim.name,
    ctaUrl: absolute(blogIndexPath(claim.locale)),
    labels: {
      subject: b.welcomeSubject,
      heading: b.confirmedTitle,
      body: b.welcomeBody,
      cta: b.welcomeCta,
      unsubscribe: b.unsubscribe,
    },
  });
  if (!welcome.sent) {
    console.error(`[sailo] newsletter welcome not sent: ${welcome.reason}`);
  }

  return { done: true };
}
