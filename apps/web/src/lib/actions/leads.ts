"use server";

import { after } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { productFiles, products, shops } from "@sailo/db/schema";
import { getDictionary, interpolate } from "@sailo/i18n";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { normalizeEmail, normalizeName } from "@sailo/marketing/contact";
import { readAnswers, readQuestions } from "@sailo/core/lead-questions";
import {
  newMagnetToken,
  hashMagnetToken,
  saveLead,
} from "@sailo/marketing/leads/server";
import { upsertClient } from "@sailo/commerce/orders/server";
import { sendLeadMagnet } from "@/lib/email";
import { notifySellerOfLead } from "@sailo/workflows/leads";

/**
 * The public end of a lead-capture product.
 *
 * Unauthenticated by necessity — somebody swapping an address for a free thing
 * has no account and must not need one — and written to the same rules as the
 * newsletter signup next to it: **the answer never depends on what the database
 * contains**, and nothing here reaches the money path.
 *
 * No order is created, no invoice number is claimed, no stock moves. That is
 * the whole design of spec 07 and it is enforced twice: this action never
 * touches `orders`, and `resolveLines` refuses a lead product outright so a
 * hand-rolled basket payload cannot smuggle one through the checkout instead.
 */

export type LeadState = {
  /** The form's one answer. */
  done: boolean;
  /** What to say once it is done — the seller's product decides, not the row. */
  message?: string;
  error?: string;
};

export async function captureLead(
  _prev: LeadState,
  formData: FormData,
): Promise<LeadState> {
  const db = getDb();
  const productId = String(formData.get("productId") ?? "");
  const email = normalizeEmail(formData.get("email"));
  const name = normalizeName(formData.get("name"));

  const dict = (locale: string | null) => getDictionary(locale ?? "en");

  /*
   * The address is the only thing this action refuses over, and it is not an
   * oracle: whether a string is shaped like an email address is knowable
   * without our database.
   */
  if (!email) return { done: false, error: dict(null).mailing.invalidEmail };
  if (!productId) return { done: false, error: dict(null).errors.body };

  const [byIp, byEmail] = await Promise.all([
    /*
     * DECISION B — both fail closed.
     *
     * A public write that creates a contact row on a seller's list and sends
     * mail on the shared quota. An hour without a ceiling here is an hour of
     * unbounded rows under somebody else's shop name, and the same hour of
     * somebody else's transactional mail going undelivered behind it.
     */
    rateLimit(`lead-ip:${await callerIp()}`, 5, 60, { onOutage: "closed" }),
    rateLimit(`lead-email:${productId}:${email}`, 1, 3_600, { onOutage: "closed" }),
  ]);

  /*
   * Two buckets, answering differently, because only one of them can be an
   * oracle — the same split `subscribeToShop` makes and for the same reasons.
   *
   * The per-address bucket is keyed on something the caller supplied, so
   * answering it with the ordinary success sentence reveals nothing: what it
   * reports is that *this caller* submitted *this address* minutes ago, which
   * they already know. And the sentence is true — their submission landed, and
   * their magnet is already in that inbox.
   *
   * The per-IP bucket is not an oracle either, but it is shared: an office, a
   * café or a mobile carrier puts dozens of unrelated people behind one
   * address, so a first-time visitor can trip it having done nothing. Telling
   * *them* the file is on its way leaves them waiting for an email nobody sent.
   * Throttled is unknown, never a positive answer.
   */
  if (!byIp.allowed) return { done: false, error: dict(null).mailing.tooMany };

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.kind, "lead"),
      eq(products.isPublished, true),
    ),
  });
  // Not a fact about the visitor: the id came from the page they are standing
  // on, so a miss is our own routing being wrong.
  if (!product) return { done: false, error: dict(null).errors.body };

  const shop = await db.query.shops.findFirst({
    where: and(
      eq(shops.id, product.shopId),
      eq(shops.isPublished, true),
      isNull(shops.suspendedAt),
      isNull(shops.deletedAt),
    ),
  });
  if (!shop) return { done: false, error: dict(null).errors.body };

  const t = dict(shop.locale);
  const questions = readQuestions(product.leadQuestions);
  const answers = readAnswers(questions, (id) => {
    const value = formData.get(`answer:${id}`);
    return typeof value === "string" ? value : null;
  });
  if (!answers.ok) {
    return {
      done: false,
      error: interpolate(t.lead.answerRequired, { question: answers.missing.label }),
    };
  }

  const files = await db.query.productFiles.findMany({
    where: eq(productFiles.productId, product.id),
  });
  /*
   * What the form will say, decided by the *product* and never by the row.
   *
   * A message that changed with whether this address was already on the list
   * would be an address checker with extra steps. This one depends on whether
   * the seller attached a file, which is public information — it is on the page
   * the visitor is reading.
   */
  const message = files.length
    ? t.lead.thanks
    : interpolate(t.lead.thanksNoFile, { shop: shop.name });

  // A repeat submission inside the hour has already been recorded and already
  // had its magnet sent. Same sentence, no second row, no second email.
  if (!byEmail.allowed) return { done: true, message };

  /*
   * Consent is only ever *taken* from a shop that asked for it.
   *
   * Reading the checkbox alone would let a request opt somebody in to a shop
   * whose form never showed the box — the client composes the body, so a flag
   * nobody was offered is a flag anyone can set. Gating on the shop's own
   * switch means the record can only say what the visitor was actually asked.
   * The same expression `createOrderIntent` uses, for the same reason.
   */
  const optedIn =
    shop.askMarketingConsent && formData.get("marketingOptIn") === "on";

  const clientId = await upsertClient(
    shop.id,
    { name, email, phone: null },
    { marketingConsentAt: optedIn ? new Date() : null },
    /*
     * How they got here. `lead` joins `order`, `subscribe`, `manual` and
     * `import` in `CLIENT_SOURCES`, and it matters for the same reason those
     * do: a broadcast audience is chosen by it, and somebody who swapped an
     * address for a checklist is a different audience from somebody who
     * bought. Written on insert only — a lead who later buys arrived as a
     * lead, and restating it would empty the audience a seller built.
     */
    "lead",
  );

  const magnet = files.length ? newMagnetToken() : null;
  const lead = await saveLead({
    shopId: shop.id,
    productId: product.id,
    clientId,
    email,
    name,
    answers: answers.answers,
    magnet: magnet
      ? {
          tokenHash: hashMagnetToken(magnet),
          // The product's own expiry, so a magnet is configured exactly as a
          // paid download is rather than through a second set of controls.
          expiresAt: product.downloadExpiryDays
            ? new Date(Date.now() + product.downloadExpiryDays * 86_400_000)
            : null,
        }
      : null,
  });

  /*
   * After the response, both of them.
   *
   * The visitor is owed a "thanks", not a wait on a mail provider — and the
   * seller's own alert is even less their business. A failure in either is
   * logged and swallowed inside the senders; neither can take back a lead that
   * has already been written.
   */
  if (magnet) {
    after(() =>
      sendLeadMagnet({
        shop,
        to: email,
        name,
        productTitle: product.title,
        url: magnetUrl(magnet),
        expiresAt: lead.magnetExpiresAt,
      }),
    );
  }
  after(() =>
    notifySellerOfLead({ shop, productTitle: product.title, email, name }),
  );

  return { done: true, message };
}

/** Where a magnet link points. Its own route, never the order download gate. */
function magnetUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  return base ? `${base}/magnet/${token}` : `/magnet/${token}`;
}
