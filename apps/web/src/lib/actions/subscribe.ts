"use server";

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { getDictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { callerIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/redis";
import { sendSubscribeConfirmation } from "@/lib/email/messages";
import {
  confirmSubscriber,
  normalizeEmail,
  normalizeName,
  readSubscribeToken,
  subscribeToken,
  confirmUrl,
} from "@/lib/broadcasts/subscribe";

/**
 * The public end of a shop's mailing list.
 *
 * Two actions, both unauthenticated by necessity — a visitor asking to hear
 * from a shop has no account and must not need one — and both written to the
 * same rule: **the answer never depends on what the database contains.**
 *
 * A signup form that says "you're already subscribed" is an address checker
 * anyone can point at a shop's customer list; one that says "we don't have
 * that address" is the same tool with the answers inverted. So the form reads
 * nothing, writes nothing, and returns one sentence in every case. What it
 * does is send a signed link to the address itself, and the link is the only
 * thing that can turn an address into a contact.
 */

export type SubscribeState = {
  /** The form's one answer: sent, or not sent because of something local. */
  done: boolean;
  error?: string;
};

export type ConfirmState = {
  done: boolean;
  error?: string;
};

export async function subscribeToShop(
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase();
  const email = normalizeEmail(formData.get("email"));
  const name = normalizeName(formData.get("name"));

  const t = (locale: string | null) => getDictionary(locale ?? "en");

  /*
   * The address is checked before anything else and is the *only* thing this
   * action will refuse over. It is not an oracle: whether a string is
   * shaped like an email address is knowable without our database.
   */
  if (!email) {
    return { done: false, error: t(null).mailing.invalidEmail };
  }

  /*
   * Two buckets, rationing two different abuses — and answering differently,
   * because only one of them can be true.
   *
   * The per-address bucket stops one inbox being mailed over and over. A
   * caller who trips it submitted that address minutes ago, so "check your
   * inbox" is a true sentence: their link is already there. It also reveals
   * nothing, because what it reports is the caller's own recent behaviour and
   * not anything in our database.
   *
   * The per-IP bucket is different. An office, a café or a mobile carrier can
   * put dozens of unrelated people behind one address, so a first-time
   * subscriber can trip it having done nothing — and telling *them* to check
   * an inbox nothing was sent to leaves them waiting forever. Throttled is
   * unknown, never a positive answer. It is not an oracle either: the message
   * is the same whatever address was typed.
   */
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`subscribe-ip:${await callerIp()}`, 8, 600),
    rateLimit(`subscribe-email:${handle}:${email}`, 2, 3_600),
  ]);
  if (!byIp.allowed) {
    return { done: false, error: t(null).mailing.tooMany };
  }
  if (!byEmail.allowed) return { done: true };

  const shop = await getDb().query.shops.findFirst({
    where: and(
      eq(shops.handle, handle),
      eq(shops.isPublished, true),
      // A suspended or deleted shop keeps no list and sends no mail.
      isNull(shops.suspendedAt),
      isNull(shops.deletedAt),
    ),
  });
  // No shop is our own routing being wrong, not a fact about the visitor —
  // the handle came from the page they are standing on.
  if (!shop) return { done: false, error: t(null).errors.body };

  const token = subscribeToken({ shopId: shop.id, email, name });
  if (!token) {
    // No signing secret means no confirmable link, and an unconfirmable
    // signup is one that would either do nothing or — far worse — subscribe
    // somebody who never proved the address was theirs.
    return { done: false, error: t(shop.locale).errors.body };
  }

  const dict = t(shop.locale);
  const result = await sendSubscribeConfirmation({
    shop,
    to: email,
    name,
    confirmUrl: confirmUrl(token),
    labels: {
      subject: interpolate(dict.mailing.confirmSubject, { shop: shop.name }),
      title: dict.mailing.confirmTitle,
      body: interpolate(dict.mailing.confirmEmailBody, { shop: shop.name }),
      cta: dict.mailing.confirmCta,
    },
  });

  /*
   * A transport failure is reported. It says nothing about the address — the
   * send failed for a reason on our side — and telling somebody "check your
   * inbox" for an email that was never sent is the one outcome that leaves
   * them waiting for something that will not arrive.
   */
  return result.sent ? { done: true } : { done: false, error: dict.errors.body };
}

/**
 * The confirm page's button.
 *
 * A POST, and never a GET. Every URL in an email is fetched by scanners,
 * link checkers and corporate security gateways; a GET that subscribed
 * somebody would add people who never opened the message, which is precisely
 * the consent this whole flow exists to establish.
 */
export async function confirmSubscription(
  _prev: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const gate = await rateLimit(`subscribe-confirm:${await callerIp()}`, 30, 60);
  if (!gate.allowed) {
    // Throttled is unknown, never a positive answer: somebody told "you're on
    // the list" who is not on it will wonder why nothing ever arrives.
    return { done: false, error: getDictionary("en").errors.body };
  }

  const claim = readSubscribeToken(String(formData.get("token") ?? ""));
  if (!claim) {
    return { done: false, error: getDictionary("en").mailing.expiredBody };
  }

  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.id, claim.shopId),
    columns: { locale: true },
  });
  const dict = getDictionary(shop?.locale ?? "en");
  if (!shop) return { done: false, error: dict.mailing.expiredBody };

  const outcome = await confirmSubscriber(claim);

  /*
   * `refused` is a bounce or a spam complaint on this address, and the
   * visitor is told the same thing as everybody else.
   *
   * Not a lie by omission: the promise this page makes is "the shop may now
   * email you", and for a hard-bounced address the shop mailing them is not
   * something anybody can deliver on anyway. Explaining that a previous
   * recipient at this address reported the shop for spam would disclose one
   * person's action to whoever is holding the address today.
   */
  return { done: outcome === "subscribed" || outcome === "refused" };
}
