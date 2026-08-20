import "server-only";
import { and, eq, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  checkoutSessions,
  coupons,
  emailSuppressions,
  orders,
  products,
  shops,
  type CheckoutSession,
  type Shop,
} from "@sailo/db/schema";
import { ORDERS, send, sender } from "@sailo/mailer/transport";
import { button, esc, layout, mutedPara, para } from "@sailo/mailer/markup";
import { can } from "@sailo/core/plans";
import { formatMoney } from "@sailo/core/currency";
import {
  RECOVERY_AFTER_MS,
  recoveryCouponCode,
  recoveryDue,
  recoveryEnabledFor,
  recoveryOffer,
  type RecoveryOffer,
} from "@sailo/commerce/recovery";
import {
  attachDiscount,
  claimForRecovery,
  expireSessions,
  resumeToken,
  resumeUrl,
} from "@sailo/commerce/recovery/server";
import { unsubscribePostUrl, unsubscribeToken, unsubscribeUrl } from "@sailo/marketing/broadcasts/server";
import { enrolIfMatching } from "@sailo/marketing/automations/server";

/**
 * One pass over abandoned checkouts.
 *
 * A workflow by this package's own test: its body is "read a session, mint a
 * coupon, send an email" — three systems, and the function is about none of
 * them. The rules it applies are `@sailo/commerce/recovery`, which is pure and
 * separately tested; this is the part that touches rows and a transport.
 *
 * **One email, ever.** Their standard, adopted verbatim: *"it is one-time (we
 * don't remind 10x)."* Enforced by a conditional UPDATE — `recovery_sent_at is
 * null` in the WHERE — and not by the predicate, because two ticks reading a
 * predicate concurrently both find it null.
 *
 * **Consent is the part to get right.** The mail is triggered by an abandoned
 * purchase and offers nothing but finishing it, so it is transactional in
 * substance — and that is not a licence to mail anyone. It goes only where the
 * address was typed into *this* checkout or the buyer is already a client of
 * *this* shop, never from a marketing list, never from another shop, and never
 * past an `email_suppressions` row of any kind. A `bounced` or `complained`
 * suppression is absolute, exactly as it is for a broadcast.
 */

/** Sessions one pass will look at. The cron runs hourly. */
const MAX_PER_PASS = 200;

export type RecoveryPassResult = {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  expired: number;
  /** Sessions whose abandonment was announced to the flows engine this pass. */
  flowsEnrolled: number;
};

export async function runRecoveryPass(
  now = new Date(),
  /** Injected so the coin flip can be seeded in a test. */
  roll: () => number = Math.random,
): Promise<RecoveryPassResult> {
  const db = getDb();
  const result: RecoveryPassResult = {
    considered: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    expired: 0,
    flowsEnrolled: 0,
  };

  /*
   * The expiry sweep runs first and in its own statement. It is what keeps the
   * candidate scan small as history grows, and it is deliberately an UPDATE
   * rather than a DELETE: an expired session is the *denominator* of the
   * seller's recovery rate, and deleting it would make the rate climb every
   * month on its own.
   */
  result.expired = await expireSessions(now);

  const due = new Date(now.getTime() - RECOVERY_AFTER_MS);

  /*
   * The flows announcement, before the built-in email and unfiltered by
   * `shops.recoveryEnabled` — a seller composing their own sequence has
   * replaced the built-in mail, not supplemented it, and switching one off
   * must not silence the other. Claimed by conditional UPDATE so a session is
   * announced exactly once; sessions with no typed address are stamped and
   * skipped, because the consent rule for the built-in email binds a flow
   * identically — the address must come from *this* checkout.
   */
  result.flowsEnrolled = await announceAbandonments(now, due);

  const candidates = await db
    .select({ session: checkoutSessions, shop: shops })
    .from(checkoutSessions)
    .innerJoin(shops, eq(shops.id, checkoutSessions.shopId))
    .where(
      and(
        inArray(checkoutSessions.status, ["opened", "error"]),
        lt(checkoutSessions.openedAt, due),
        isNull(checkoutSessions.recoverySentAt),
        isNull(checkoutSessions.orderId),
        /*
         * The shop's switch, in the WHERE rather than in the loop. A shop with
         * recovery off has nothing here to consider, and scanning its sessions
         * to discard them is work every pass would repeat for ever.
         *
         * The *product's* override cannot be asked here — it inherits, so a
         * null means "whatever the shop says" and the join would have to
         * express that. It is asked below, per session.
         */
        eq(shops.recoveryEnabled, true),
      ),
    )
    .orderBy(checkoutSessions.openedAt)
    .limit(MAX_PER_PASS);

  result.considered = candidates.length;

  for (const { session, shop } of candidates) {
    try {
      const outcome = await recoverOne(session, shop, now, roll);
      result[outcome] += 1;
    } catch (error) {
      /*
       * One session's failure must never take the pass with it. Every other
       * seller's abandoned checkouts are still due, and this one becomes due
       * again on the next tick only if the claim did not land — which is the
       * safe direction.
       */
      result.failed += 1;
      console.error(`[sailo] recovery for session ${session.id} failed`, error);
    }
  }

  return result;
}

type Outcome = "sent" | "skipped" | "failed";

async function recoverOne(
  session: CheckoutSession,
  shop: Shop,
  now: Date,
  roll: () => number,
): Promise<Outcome> {
  const db = getDb();

  /*
   * The plan, re-read rather than trusted. Sessions are *recorded* on every
   * plan so a seller who upgrades has history to show; only the send and the
   * discount are gated, and the gate has to be here as well as on the settings
   * form or a downgrade would keep sending.
   */
  if (!can(shop, "csvExport")) return "skipped";

  const email = session.email?.trim().toLowerCase();
  if (!email) return "skipped";

  /*
   * Everything the predicate needs, in one round trip: the product's override,
   * whether this address is suppressed, and whether the session's order — if a
   * handoff put one behind it — has since been paid.
   */
  const [product, suppressed, handoff] = await Promise.all([
    session.productId
      ? db.query.products.findFirst({
          where: eq(products.id, session.productId),
          columns: { recoveryEnabled: true, kind: true },
        })
      : Promise.resolve(null),
    db.query.emailSuppressions.findFirst({
      where: and(
        eq(emailSuppressions.shopId, shop.id),
        eq(emailSuppressions.email, email),
      ),
      columns: { reason: true },
    }),
    session.handoffOrderId
      ? db.query.orders.findFirst({
          where: eq(orders.id, session.handoffOrderId),
          columns: { paymentStatus: true, status: true },
        })
      : Promise.resolve(null),
  ]);

  /*
   * The chat-rail half. The order was persisted before the handoff, so a buyer
   * who *did* send the WhatsApp message and paid has a settled order behind
   * this session — and writing to them would be chasing a completed sale.
   */
  if (handoff && (handoff.paymentStatus === "paid" || handoff.status === "cancelled")) {
    return "skipped";
  }

  const verdict = recoveryDue(
    {
      status: session.status,
      openedAt: session.openedAt,
      recoverySentAt: session.recoverySentAt,
      orderId: session.orderId,
      enabled: recoveryEnabledFor(shop.recoveryEnabled, product?.recoveryEnabled),
      /*
       * Mailable means "we are allowed to write to this person about this
       * checkout": no suppression of any kind, and an address that was typed
       * into this very checkout. `session.email` is only ever written from the
       * checkout form or from a known client of this shop, which is what makes
       * this true by construction rather than by a second lookup.
       */
      mailable: !suppressed,
      isMembership: product?.kind === "membership",
      subtotalCents: session.subtotalCents,
    },
    now,
  );
  if (!verdict.due) return "skipped";

  /*
   * The claim, before the send. A crash between them loses one recovery email;
   * the other order sends a second one to somebody who already had it, and
   * "we don't remind 10x" makes that trade for us.
   */
  const claimed = await claimForRecovery({ sessionId: session.id, now });
  if (!claimed) return "skipped";

  const offer = recoveryOffer({
    discountBp: shop.recoveryDiscountBp,
    discountCents: shop.recoveryDiscountCents,
    oddsBp: shop.recoveryDiscountOddsBp,
    roll: roll(),
  });

  /*
   * The currency the buyer was quoted in — `subtotalCents` was recorded in it
   * (spec 53), so everything this email says about money must say it too. A
   * JPY-browsing buyer of a EUR shop abandoned ¥5,000, not €5,000.
   *
   * It also gates the offer: a fixed-amount coupon is priced in the shop's
   * currency, and the checkout's own `couponAtCurrency` refuses a fixed
   * coupon with no entry in the buyer's presentment currency — so minting one
   * here would promise a discount the resume link cannot honour. Percent
   * offers price anywhere and pass through.
   */
  const sessionCurrency = session.currency ?? shop.currency;
  const usableOffer =
    offer?.kind === "fixed" && sessionCurrency !== shop.currency ? null : offer;

  const code = usableOffer ? await mintCoupon(shop, session, usableOffer, now) : null;
  if (code) await attachDiscount(session.id, code);

  const expiresAt = session.expiresAt ?? new Date(now.getTime() + 30 * 86_400_000);
  const token = resumeToken({ sessionId: session.id, shopId: shop.id }, expiresAt);
  /*
   * No signing secret means no working resume link, and a recovery email whose
   * only call to action is dead is worse than none — it spends the shop's one
   * message on a broken button. The claim has already landed, so this session
   * will not be retried; that is the correct end of the trade rather than a
   * loop that mails on every pass once the environment is fixed.
   */
  if (!token) return "failed";

  const unsub = unsubscribeToken({ shopId: shop.id, email });
  const result = await send({
    from: sender(shop.name, ORDERS),
    to: email,
    subject: `You left something at ${shop.name}`,
    html: recoveryEmail({
      shop,
      resumeHref: resumeUrl(shop.handle, token),
      code,
      offer: usableOffer,
      subtotalCents: session.subtotalCents,
      currency: sessionCurrency,
      unsubscribeHref: unsub ? unsubscribeUrl(unsub) : null,
    }),
    replyTo: shop.contactEmail ?? undefined,
    headers: unsub
      ? {
          /*
           * RFC 8058, on a message that is transactional in substance. Carried
           * anyway, and deliberately: the buyer's own reading of "an email
           * about a thing I did not buy" is marketing, and a one-click way out
           * costs nothing and forecloses the complaint.
           */
          "List-Unsubscribe": `<${unsubscribePostUrl(unsub)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : undefined,
  });

  return result.sent ? "sent" : "failed";
}

/**
 * A real, single-use coupon through the existing `coupons` path.
 *
 * Not a special-case discount the checkout has to know about: it is an
 * ordinary code, so it prices, validates, expires and reports exactly like
 * every other one — and the seller can see it in their own coupon list.
 *
 * `onConflictDoNothing` and a code derived from the session id, so a retried
 * mint finds the existing coupon rather than making a second one for the same
 * buyer.
 */
async function mintCoupon(
  shop: Shop,
  session: CheckoutSession,
  offer: NonNullable<RecoveryOffer>,
  now: Date,
): Promise<string | null> {
  const code = recoveryCouponCode(session.id);

  await getDb()
    .insert(coupons)
    .values({
      shopId: shop.id,
      code,
      discountType: offer.kind === "percent" ? "percent" : "fixed",
      discountValue: offer.kind === "percent" ? offer.basisPoints : offer.cents,
      // One buyer, one use. The whole point of minting per session.
      maxRedemptions: 1,
      // Expires with the session, so a code dug out of an old inbox is dead.
      expiresAt: session.expiresAt ?? new Date(now.getTime() + 30 * 86_400_000),
      isActive: true,
    })
    .onConflictDoNothing();

  return code;
}

/**
 * The message.
 *
 * One button and one sentence. It carries no other offer, no product
 * recommendations and no "you might also like" — which is what keeps it
 * transactional in substance rather than a marketing email wearing a receipt's
 * clothes.
 */
function recoveryEmail(opts: {
  shop: Shop;
  resumeHref: string;
  code: string | null;
  offer: RecoveryOffer;
  subtotalCents: number | null;
  /** What the buyer was quoted in, which is what `subtotalCents` is in. */
  currency: string;
  unsubscribeHref: string | null;
}): string {
  const { shop, offer } = opts;

  const amount =
    opts.subtotalCents && opts.subtotalCents > 0
      ? formatMoney(opts.subtotalCents, opts.currency)
      : null;

  const discountLine =
    offer && opts.code
      ? para(
          `Here's <strong>${
            offer.kind === "percent"
              ? `${(offer.basisPoints / 100).toFixed(0)}%`
              : // Fixed offers are only sent when the buyer was quoted in the
                // shop's own currency, so this is the currency of both.
                esc(formatMoney(offer.cents, opts.currency))
          }</strong> off if you finish today — the code <strong>${esc(opts.code)}</strong> is already waiting at the checkout.`,
        )
      : "";

  const body = `
    ${para(
      amount
        ? `You started an order at ${esc(shop.name)} — ${esc(amount)} — and didn't finish. It's still here.`
        : `You started an order at ${esc(shop.name)} and didn't finish. It's still here.`,
    )}
    ${discountLine}
    ${button(opts.resumeHref, "Finish your order")}
    ${
      opts.unsubscribeHref
        ? mutedPara(
            `Not interested? <a href="${opts.unsubscribeHref}">Stop emails from ${esc(shop.name)}</a>.`,
          )
        : ""
    }
  `;

  return layout(shop, `You left something at ${shop.name}`, body, {
    preheader: "Your order is still waiting.",
  });
}

/** How many sessions a shop has in each status — the seller's four tiles. */
export async function recoveryStats(shopId: string) {
  const [row] = await getDb()
    .select({
      opened: sql<string>`count(*) filter (where ${checkoutSessions.status} = 'opened')`,
      recovering: sql<string>`count(*) filter (where ${checkoutSessions.status} = 'recovering')`,
      recovered: sql<string>`count(*) filter (where ${checkoutSessions.status} = 'recovered')`,
      finalized: sql<string>`count(*) filter (where ${checkoutSessions.status} = 'finalized')`,
      /*
       * Recovered funds, and it reads the *order*, not the session's subtotal.
       * The session records what the basket was worth when it was abandoned;
       * the order records what was actually paid, and a discount applied on
       * the way back means those are different numbers. Reporting the first as
       * revenue would overstate every recovery by the discount that caused it.
       */
      recoveredCents: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${checkoutSessions.status} = 'recovered'), 0)`,
    })
    .from(checkoutSessions)
    .leftJoin(orders, eq(orders.id, checkoutSessions.orderId))
    .where(eq(checkoutSessions.shopId, shopId));

  const opened = Number(row?.opened ?? 0);
  const recovering = Number(row?.recovering ?? 0);
  const recovered = Number(row?.recovered ?? 0);

  return {
    opened,
    recovering,
    recovered,
    finalized: Number(row?.finalized ?? 0),
    recoveredCents: Number(row?.recoveredCents ?? 0),
    /*
     * Of the checkouts we actually wrote to, how many came back. The
     * denominator is `recovering + recovered` and not every session ever
     * opened — a rate over sessions nobody was mailed about measures the shop's
     * conversion, not the recovery, and would fall every time the shop got
     * more traffic.
     */
    rateBp:
      recovering + recovered > 0
        ? Math.round((recovered / (recovering + recovered)) * 10_000)
        : 0,
  };
}

/** Every recoverable-but-unmailed session, so a seller can see why. */
export async function pendingRecoveries(shopId: string, limit = 100) {
  return getDb()
    .select({
      id: checkoutSessions.id,
      email: checkoutSessions.email,
      status: checkoutSessions.status,
      lastError: checkoutSessions.lastError,
      subtotalCents: checkoutSessions.subtotalCents,
      currency: checkoutSessions.currency,
      openedAt: checkoutSessions.openedAt,
      recoverySentAt: checkoutSessions.recoverySentAt,
      recoveredAt: checkoutSessions.recoveredAt,
      discountCode: checkoutSessions.discountCode,
    })
    .from(checkoutSessions)
    .where(eq(checkoutSessions.shopId, shopId))
    .orderBy(sql`${checkoutSessions.openedAt} desc`)
    .limit(limit);
}

/**
 * Announces every newly-abandoned session to the flows engine, once each.
 *
 * `enrolIfMatching` applies its own rules after this — the plan flag, the
 * suppression list and the re-entry floor are all its questions — so this
 * claims and hands over, and nothing more. Enrolment failures are logged and
 * do not unwind the claim: the stamp records "announced", and an engine that
 * refused is an answer, not an error to retry into a double send.
 */
async function announceAbandonments(now: Date, due: Date): Promise<number> {
  const db = getDb();
  /*
   * Bounded like the email half, and for the same reason: the stamp records
   * "announced" the moment it is written, so every session claimed beyond
   * what this invocation can process before the cron's 60-second ceiling is
   * an enrolment lost forever. The first pass after a deploy would otherwise
   * claim the entire 30-day backlog in one statement and then be killed
   * mid-loop. What this pass does not claim, the next one will.
   *
   * The handoff check is the email half's rule (see `sendRecovery`): a buyer
   * who sent the WhatsApp message and paid has a settled order behind this
   * session — it stays `opened` with `orderId` null because the platform
   * never sees the money — and enrolling them in "you left something behind"
   * is chasing a completed sale.
   */
  const dueIds = db
    .select({ id: checkoutSessions.id })
    .from(checkoutSessions)
    .where(
      and(
        inArray(checkoutSessions.status, ["opened", "error"]),
        lt(checkoutSessions.openedAt, due),
        isNull(checkoutSessions.flowEnrolledAt),
        isNull(checkoutSessions.orderId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(orders)
            .where(
              and(
                eq(orders.id, checkoutSessions.handoffOrderId),
                or(eq(orders.paymentStatus, "paid"), eq(orders.status, "cancelled")),
              ),
            ),
        ),
      ),
    )
    .limit(MAX_PER_PASS);

  const claimed = await db
    .update(checkoutSessions)
    .set({ flowEnrolledAt: now })
    .where(
      and(
        inArray(checkoutSessions.id, dueIds),
        // Re-checked at the write, so two overlapping crons cannot both claim.
        isNull(checkoutSessions.flowEnrolledAt),
      ),
    )
    .returning({
      id: checkoutSessions.id,
      shopId: checkoutSessions.shopId,
      email: checkoutSessions.email,
      clientId: checkoutSessions.clientId,
      productId: checkoutSessions.productId,
    });

  for (const session of claimed) {
    if (!session.email) continue;
    try {
      await enrolIfMatching({
        shopId: session.shopId,
        trigger: "checkout.abandoned",
        subject: { email: session.email, clientId: session.clientId },
        context: {
          sessionId: session.id,
          productIds: session.productId ? [session.productId] : [],
        },
        now,
      });
    } catch (error) {
      console.error("[sailo] checkout.abandoned enrolment failed", error);
    }
  }
  return claimed.length;
}
