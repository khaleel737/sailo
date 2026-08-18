"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { resolveOrderIntent } from "@sailo/commerce/orders/server";
import { upsertClient } from "@sailo/commerce/orders/server";
import { referralFor } from "@sailo/workflows/orders";
import type { OrderIntentInput, OrderIntentResult } from "@sailo/commerce/orders";
import { firstRow } from "@sailo/core/invariant";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { liveShop } from "@/lib/shop-visibility";
import { rateLimit } from "@sailo/rate-limit";
import { publishAffiliateEvent, publishShopEvent } from "@sailo/events";
import { headers } from "next/headers";
import { ipFromHeaders } from "@sailo/rate-limit/client-ip";
import { orderItems, orders, shops, tickets, type PaymentConfig } from "@sailo/db/schema";
import { formatAddress } from "@sailo/core/address";
import { formatMoney } from "@sailo/core/currency";
import { bankDetailLines, buildHandoff, type Handoff } from "@/lib/payments";
import { COUPON_MESSAGES, toChargeableTotals } from "@sailo/core/pricing";
import { createInvoiceForOrder, newInvoiceToken } from "@/lib/invoices";
import { can } from "@sailo/core/plans";
import { type QuoteLine } from "@sailo/core/quote";
import { variantLabel } from "@sailo/core/variants";
import { releaseStock, reserveStock } from "@sailo/commerce/catalog";
import { handOffSubscription, handOffToStripe } from "@sailo/commerce/orders/server";
import { checkoutLabels, toCheckoutLine } from "@sailo/commerce/orders";
import { getShopT } from "@/i18n/server";
import { intervalOf, isMembership } from "@sailo/commerce/memberships";
import { createManualSubscription } from "@sailo/commerce/memberships/server";
import { claimCouponRedemption } from "@sailo/commerce/coupons";
import { claimSlots, releaseSlots, slotEnd } from "@sailo/commerce/booking/server";
import { downloadUrl, newDownloadToken, releasesImmediately } from "@/lib/downloads";
import { resolveDigitalDelivery } from "@sailo/commerce/orders/server";
import { eventSalesOpen, ticketValues } from "@sailo/commerce/ticketing";
import { confirmBuyerByEmail } from "@sailo/workflows/orders";
import { notifySellerOfOrder } from "@sailo/workflows/orders";
import { emitOrderWebhook } from "@sailo/webhooks/emit";


/**
 * Puts back every unit a cart had taken off the shelf.
 *
 * A cart is all-or-nothing, so any abandonment after the first reservation has
 * to undo all of them — the line that failed and the ones already held.
  *
 * WHY THIS FUNCTION IS NOT SPLIT UP
 *
 * It is long, and it was looked at during a pass whose whole purpose was splitting long files.
 * It stays whole, and the reason is `orders.test.ts` beside it: nine tests that pin the *order*
 * of the irreversible steps by source position — the terms gate before the client upsert, the
 * stock reservation before the Stripe handoff, the coupon claim before the invoice, the
 * confirmation email last. The sequence is the correctness property, not a side effect of how
 * the code is arranged.
 *
 * Splitting it would thread nine accumulated locals through three or four functions and move
 * that guard from "positions in one file" to "positions across several", which is weaker. The
 * complexity here is in the sequence of writes, and moving it into parameter lists relocates it
 * rather than removing it — on the one path in the product where a mistake is somebody's money.
 *
 * What *did* come out during that pass is everything that was not part of the sequence: the
 * form readers are `./shop-form`, and the domain steps this calls are already packages
 * (`@sailo/commerce`, `@sailo/payments`, `@sailo/workflows`). What is left is the order they
 * happen in.
*/
async function releaseStockFor(lines: QuoteLine[]): Promise<void> {
  for (const line of lines) {
    await releaseStock({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
    });
  }
}

/**
 * A rejection handler that puts reserved stock back before rethrowing.
 *
 * Units come off the shelf before the order row is written, so everything
 * between those two points is a window where a throw strands them: no order
 * exists, so `releaseAbandonedCheckouts` has nothing to find, and nothing else
 * ever reclaims them. The shop reads as sold out for a sale that never
 * happened, and only a manual stock edit fixes it.
 *
 * Rethrows rather than swallowing — the caller still failed, and the buyer
 * still needs to hear so.
 */
function releasingStock(taken: QuoteLine[]) {
  return async (error: unknown): Promise<never> => {
    await releaseStockFor(taken);
    throw error;
  };
}

/**
 * What can be observed about the buyer's connection, for dispute evidence.
 *
 * One read of the header bag, serving both the rate-limit key and the two columns
 * a chargeback is answered from. Truncated, because a user-agent string is
 * attacker-controlled and unbounded — and because Stripe's evidence fields share
 * a 20,000-character budget that a 4KB header would eat into for no benefit.
 */
async function buyerFingerprint(): Promise<{ ip: string; userAgent: string | null }> {
  const bag = await headers();
  return {
    ip: ipFromHeaders(bag),
    userAgent: bag.get("user-agent")?.slice(0, 400) ?? null,
  };
}

export async function createOrderIntent(
  input: OrderIntentInput,
): Promise<OrderIntentResult> {
  /*
   * Public and unauthenticated, and it reserves stock. Without a ceiling one
   * caller can hold a shop's entire inventory in unpaid orders faster than
   * the hourly sweep releases it, and the shop reads as sold out to everyone
   * else. Ten a minute is far above any real buyer.
   *
   * Fails open, like the rest: a limiter that blocks real orders when its own
   * backend is down costs more than the traffic it stops.
   */
  const db = getDb();

  /*
   * The ceiling and the shop read, at the same time.
   *
   * Neither needs the other's answer, and on this driver every statement is
   * its own request — so waiting for Redis before starting the database costs
   * a full round trip for nothing. Measured against the real database from
   * across an ocean, six sequential statements take 704ms and the same six
   * concurrently take 127ms; that ratio is the whole reason this function is
   * shaped the way it is.
   *
   * Reading the shop for a caller who turns out to be rate-limited is a wasted
   * query, but a cached one and far cheaper than the trip it saves everyone
   * else.
   */
  /*
   * Read once, used twice: the rate-limit key and the order's dispute evidence.
   *
   * This was `callerIp()` inline. Reading the header bag once and passing both
   * values down means the throttling key and the address written on the order
   * cannot disagree about what "the caller" means — which would be a quiet way
   * for a fraud rebuttal to cite an address that was never rate-limited.
   */
  const buyer = await buyerFingerprint();

  const [gate, shop] = await Promise.all([
    rateLimit(`order:${buyer.ip}`, 10, 60),
    db.query.shops.findFirst({
      where: liveShop(eq(shops.id, input.shopId)),
    }),
  ]);

  if (!gate.allowed) {
    return { ok: false, error: "Too many attempts. Wait a moment and try again." };
  }
  if (!shop) return { ok: false, error: "Shop not found." };

  /*
   * The terms gate, before anything at all is written.
   *
   * The checkbox on the panel is `required`, which stops an honest buyer from
   * missing it and does nothing whatsoever about a hand-rolled POST — a server
   * action takes what the client sends, and "the form wouldn't submit" is not
   * a property of the request. So the shop's own switch is what decides, read
   * from the row rather than from the body.
   *
   * Here rather than lower down because everything below this line writes:
   * `upsertClient` creates the buyer, and past that stock comes off the shelf.
   * Refusing after a reservation would hold units for an order that was never
   * allowed to exist, and only the hourly sweep would hand them back.
   */
  if (shop.requireTerms && !input.acceptedTerms) {
    return {
      ok: false,
      error: "Please agree to the terms and conditions to place this order.",
    };
  }

  const now = new Date();

  /*
   * Everything this order is, worked out before anything is written down.
   *
   * The seam is not the line count — it is that nothing in there touches a
   * row. Which products at which prices, on which rail, with which delivery,
   * coupon and affiliate, for which buyer: each can fail, and failing costs
   * nothing, because no stock has been taken and no order written. Past this
   * point every failure needs an undo, and the undos are what the hardest bugs
   * in this file have been about.
   */
  const resolvedIntent = await resolveOrderIntent(shop, input, now);
  if (!resolvedIntent.ok) return { ok: false, error: resolvedIntent.error };
  const {
    lines,
    head,
    method,
    def,
    delivery,
    coupon,
    affiliate,
    priced,
    buyer: { name, email, phone, note, address },
  } = resolvedIntent.intent;

  // A ticket sold after the doors open is one for an event already happening.
  // Judged here, before any stock is taken, so refusing costs nothing.
  const closedEvent = lines.find(
    (line) => !eventSalesOpen(line.product, now),
  );
  if (closedEvent) {
    return {
      ok: false,
      error: `Ticket sales for ${closedEvent.title} have closed.`,
    };
  }
  /*
   * Rounded to what the shop's currency can actually settle.
   *
   * A no-op for sixty-six of the seventy-one. For KWD, BHD, JOD, OMR and TND
   * it is the difference between an invoice and a card statement that agree
   * and two that do not: those settle to two places, so a total of 12.345 KWD
   * is not a chargeable amount and Stripe refuses it outright. Rounding here,
   * before anything is written down, is what makes the order, the invoice and
   * the charge the same number.
   */
  const totals = toChargeableTotals(priced.totals, shop.currency, shop.taxInclusive);

  /*
   * Consent is only ever *taken* from a shop that asked for it.
   *
   * Reading `input.marketingOptIn` on its own would let a request opt a buyer
   * in to a shop whose checkout never showed the box — the client composes the
   * body, so a flag that nobody was offered is a flag anyone can set. Gating on
   * the shop's own switch means the record can only say what the buyer was
   * actually asked.
   */
  const marketingConsentAt =
    shop.askMarketingConsent && input.marketingOptIn ? now : null;

  const clientId = await upsertClient(
    shop.id,
    {
      name,
      email,
      phone,
      ...address,
    },
    { marketingConsentAt },
  );

  /* ---- Stock ----------------------------------------------------------- */

  // Taken before the row is written: an order that can't be fulfilled is worse
  // than one that was never placed, and each guard is atomic so the last unit
  // can only be sold once. A cart is all-or-nothing — if the third line has
  // just sold out, the first two go back on the shelf.
  /*
   * Every line at once, not one after another.
   *
   * Each guard is a self-contained conditional UPDATE — it decrements only if
   * enough is on the shelf, and it does that in the statement that reads the
   * count, so nothing about its correctness depends on the others having
   * finished. Sequentially a five-line basket paid five round trips; together
   * they cost one. Two lines naming the *same* product still serialise inside
   * Postgres on the row lock, which is where that has to happen anyway.
   *
   * All-or-nothing is unchanged, only later: whatever succeeded goes back on
   * the shelf if anything failed.
   */
  const reservations = await Promise.all(
    lines.map(async (line) => ({
      line,
      ok: await reserveStock({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        trackInventory: line.product.trackInventory,
      }),
    })),
  );

  const taken: QuoteLine[] = reservations.filter((r) => r.ok).map((r) => r.line);
  const shortfall = reservations.find((r) => !r.ok)?.line;

  if (shortfall) {
    await releaseStockFor(taken);
    return {
      ok: false,
      error:
        shortfall.quantity > 1
          ? `There isn't that much ${shortfall.title} left. Try a smaller quantity.`
          : `${shortfall.title} just sold out.`,
    };
  }

  /* ---- Digital delivery ------------------------------------------------ */

  // Reads the products' files, so it can fail — and the stock is already off
  // the shelf by here, which is why it hands the units back on the way out.
  const digital = await resolveDigitalDelivery({
    lines,
    totalCents: totals.totalCents,
    now,
  }).catch(releasingStock(taken));
  const { deliversFiles, downloadExpiresAt, downloadLimit } = digital;

  /*
   * Tickets ride the same token and the same release timestamp as files.
   * An event order therefore mints a token even with no file behind it —
   * the delivery page it opens shows admissions instead of downloads — and
   * "unlock now" must be agreed by *every* gated line across both kinds,
   * because one token cannot be half-open.
   */
  const sellsTickets = lines.some(
    (line) => line.kind === "event" && line.quantity > 0,
  );
  const eventsUnlockNow = lines
    .filter((line) => line.kind === "event")
    .every((line) =>
      releasesImmediately(line.product, {
        totalCents: totals.totalCents,
        paymentStatus: "unpaid",
      }),
    );
  /*
   * A membership always gets a token, whether or not it delivers a file.
   *
   * The token is what addresses the member's own page, and that page is where
   * cancelling lives. Without one there is no link to put in the welcome
   * email, and a member who cannot find how to stop paying rings their bank
   * instead — a chargeback costs the seller the month, the card fee, a
   * dispute fee and a mark against their Stripe account.
   */
  const isMembershipOrder = isMembership(head.product);
  const downloadToken =
    digital.downloadToken ??
    (sellsTickets || isMembershipOrder ? newDownloadToken() : null);
  const unlockNow =
    (deliversFiles ? digital.unlockNow : true) &&
    (sellsTickets ? eventsUnlockNow : true) &&
    Boolean(downloadToken);

  /*
   * The order id is minted here rather than by the database.
   *
   * That is what lets the header and its lines go in one `db.batch()`, which
   * on neon-http is a single non-interactive transaction: both statements
   * commit or neither does. Previously the lines were a second round trip with
   * nothing to undo it, so a failure between them left a header row with no
   * lines — and `stockLinesFor` falls back to the header's own quantity when
   * it finds none, which attributes every unit in the basket to the first
   * product. The sweep then restocked a product that had never held them.
   *
   * This driver cannot open an interactive transaction at all
   * (`db.transaction()` throws), so a batch is the only atomicity available.
   */
  const orderId = crypto.randomUUID();

  // One row per admission, coded and countersigned by the same transaction
  // that writes the order — a ticket cannot exist without its order, nor an
  // event order without its tickets.
  const ticketRows = ticketValues(lines, { orderId, shopId: shop.id });

  const [inserted] = await db.batch([
    db
    .insert(orders)
    .values({
      id: orderId,
      shopId: shop.id,
      productId: head.productId,
      variantId: head.variantId,
      clientId,
      productTitle: head.title,
      variantLabel: head.variantOptions
        ? variantLabel(head.variantOptions, head.options)
        : null,
      variantSku: head.sku,
      productKind: head.kind,
      unitPriceCents: head.unitPriceCents,
      quantity: priced.unitCount,
      itemCount: lines.length,
      currency: shop.currency,

      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      deliveryFeeCents: totals.deliveryFeeCents,
      // Snapshot, not a reference: changing the shop's rate tomorrow must not
      // rewrite what this buyer was charged today.
      taxCents: totals.taxCents,
      /*
       * Zero under Stripe Tax, where the rate is not ours to snapshot.
       *
       * `shop.taxRateBp` is very likely still holding whatever flat rate the
       * seller used before they switched, and copying it here would put a rate
       * on an order that was never charged at it: the card rail overwrites both
       * figures from the settled session, and every other rail computes no tax
       * at all under this mode. `taxLabel` prints a bare "VAT" at zero rather
       * than "VAT (20%)", which is the honest label for an untaxed line.
       */
      taxRateBp:
        shop.taxEnabled && shop.taxMode !== "stripe" ? shop.taxRateBp : 0,
      taxName: shop.taxEnabled ? shop.taxName : null,
      taxInclusive: shop.taxInclusive,
      totalCents: totals.totalCents,

      deliveryMethodId: delivery?.id ?? null,
      deliveryMethod: delivery?.type ?? null,
      deliveryLabel: delivery?.name ?? null,
      pickupLocation:
        delivery?.type === "collection"
          ? (delivery.config.address ?? null)
          : null,

      // Services: what was booked, and where it happens. Snapshotted so a
      // later edit to the product can't move an appointment already agreed.
      // Each line keeps its own; the header repeats the first booked one so a
      // list can show a time without a join.
      scheduledFor: lines.find((l) => l.scheduledFor)?.scheduledFor ?? null,
      serviceMode: head.kind === "service" ? head.product.serviceMode : null,
      serviceLocation:
        head.kind === "service" ? head.product.serviceLocation : null,

      // Digital: the token exists from the start; the release timestamp is
      // what actually opens the files.
      downloadToken,
      downloadReleasedAt: unlockNow ? now : null,
      downloadExpiresAt,
      downloadLimit,

      couponId: coupon?.id ?? null,
      couponCode: coupon?.code ?? null,

      affiliateId: affiliate?.id ?? null,
      affiliateCode: affiliate?.code ?? null,
      commissionCents: totals.commissionCents,

      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      ...address,
      note,
      /*
       * The server's clock, not the client's claim — and only when the shop
       * was asking. `input.acceptedTerms` was already the difference between
       * this order existing and being refused above; what gets written down is
       * the moment the server agreed, which is the only part an audit can
       * lean on.
       */
      termsAcceptedAt: shop.requireTerms ? now : null,
      /*
       * Where the buyer was, recorded so a chargeback can be answered.
       *
       * The single highest-value column on this table for a fraud dispute, and it
       * does nothing at all for this order. Every fraud rebuttal rests on it, and
       * Visa's Compelling Evidence 3.0 — the only mechanism that wins a 10.4
       * outright — needs it on the disputed order *and* on two prior orders from
       * the same buyer, 120 to 365 days earlier. So the value is realised four
       * months after capture, and it cannot be backfilled: the buyer's connection
       * existed for the length of this request.
       *
       * Free, because `buyerFingerprint()` was already read at the top of this
       * function for the rate-limit key. Explicitly not identity and never a gate — every
       * value here is a header the client can set — which is fine as evidence,
       * where an issuer is being told what we observed, and worthless as an
       * access control. See `packages/rate-limit/src/client-ip.ts`.
       */
      buyerIp: buyer.ip,
      buyerUserAgent: buyer.userAgent,
      paymentMethod: method.type,
      // COD is collected on delivery; transfers are owed until confirmed.
      paymentStatus: "unpaid",
    })
    .returning({ id: orders.id }),

  // The authoritative list of what was sold, in the same transaction as the
  // header so nothing can ever read the order in a one-line-only state.
  db.insert(orderItems).values(
    priced.lines.map((line, position) => ({
      orderId,
      productId: line.productId,
      variantId: line.variantId,
      title: line.title,
      variantLabel: line.label || null,
      sku: line.sku,
      kind: line.kind,
      imageUrl: line.imageUrl,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      subtotalCents: line.subtotalCents,
      scheduledFor: lines[position]?.scheduledFor ?? null,
      serviceMode:
        line.kind === "service"
          ? (lines[position]?.product.serviceMode ?? null)
          : null,
      serviceLocation:
        line.kind === "service"
          ? (lines[position]?.product.serviceLocation ?? null)
          : null,
      position,
    })),
  ),
  // Admissions, one row each, valid only once the release timestamp is set.
  ...(ticketRows.length ? [db.insert(tickets).values(ticketRows)] : []),

  // Every statement is the window that opened when the stock was reserved.
  // If the transaction fails, the units go back on the shelf on the way out.
  ]).catch(releasingStock(taken));

  const order = firstRow(inserted, "order");

  /*
   * The appointments, claimed the way the stock was.
   *
   * `resolveLines` re-derived every slot against the shop's hours and its
   * existing bookings, but that is a read: two buyers asking for the same time
   * in the same second both passed it, and the shop owed one appointment to
   * two people with nothing anywhere to notice. The unique index behind
   * `claimSlots` is what actually decides, and it decides once.
   *
   * After the insert because the claim carries a foreign key to the order, and
   * before the coupon because losing a slot must not also burn a discount.
   */
  const slots = lines.flatMap((line) =>
    line.scheduledFor && line.productId
      ? [
          {
            productId: line.productId,
            startsAt: line.scheduledFor,
            // The range, not just the start: two appointments that overlap are
            // as double-booked as two that begin together.
            endsAt: slotEnd(line.scheduledFor, line.product.durationMinutes),
          },
        ]
      : [],
  );
  const gotSlots = await claimSlots(order.id, slots).catch(async (error: unknown) => {
    /*
     * A throw here, not just a `false`, has to undo the same things.
     *
     * `claimSlots` talks to the database, so it can fail rather than merely
     * refuse — and an unhandled throw at this point leaves the order row and
     * its reserved stock behind with nothing to reclaim them: the sweep only
     * looks at card orders, so a manual-rail order would sit there for good.
     * The batch above already routes its failures through `releasingStock`;
     * this had no such path.
     */
    console.error("[sailo] slot claim failed:", error);
    return false;
  });

  if (!gotSlots) {
    await releaseStockFor(taken);
    await releaseSlots(order.id);
    await db.delete(orders).where(eq(orders.id, order.id));
    return {
      ok: false,
      error: "That time has just been taken. Pick another and try again.",
    };
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

  /*
   * The invoice's public token, minted before the invoice exists.
   *
   * Stripe's success URL has to name the invoice, but claiming an invoice
   * number is one of the things that must not happen until the payment handoff
   * has succeeded — so the token is generated here, spent in the success URL
   * below, and only written to a row once Stripe has accepted the session.
   * Nothing resolves it until the buyer comes back from paying.
   */
  const invoiceToken = newInvoiceToken();

  /* ---- Card: hand the buyer to Stripe --------------------------------- */

  /*
   * Before the coupon, the invoice and the email, all of which this used to
   * run first.
   *
   * A failure here rolls the order and its stock reservation back, and those
   * are the only two things that *can* be rolled back. A redemption already
   * counted is a discount the buyer paid for and cannot use again; an invoice
   * number already claimed leaves a gap in a sequence a tax authority expects
   * to be unbroken; and an email already sent cannot be recalled — it told the
   * buyer their order was confirmed and linked them to an invoice that the
   * rollback then deleted. Stripe is the step most likely to fail of all of
   * them, so it goes first and everything irreversible waits behind it.
   */
  /*
   * The coupon is the exception to "nothing irreversible before the payment".
   *
   * A cap has to be enforced *before* the buyer pays — taking money on a
   * discount that was already exhausted is worse than either failure it sits
   * between. So it is claimed here, and given back explicitly if the handoff
   * then fails, which is the undo that did not exist when this ran first.
   */
  if (coupon && !(await claimCouponRedemption(coupon))) {
    await releaseStockFor(taken);
    // The delete cascades to `booking_claims`, but saying so here rather than
    // relying on it keeps the undo readable next to the thing it undoes.
    await releaseSlots(order.id);
    await db.delete(orders).where(eq(orders.id, order.id));
    return { ok: false, error: COUPON_MESSAGES.used_up };
  }

  let cardHandoff: Handoff | null = null;

  /*
   * A membership is handed to a different kind of session.
   *
   * Everything above this line was the same for it as for any other order —
   * the buyer, the order row, the totals — and that is on purpose: a
   * membership's *first* payment is an ordinary sale, and every renewal after
   * it writes an ordinary order too. Only the handoff differs, because a
   * recurring charge is a Stripe subscription rather than a one-off payment
   * intent, and only one of the two modes can exist on a session.
   *
   * `resolveOrderIntent` has already refused a mixed basket, a non-card rail
   * and a coupon, so by here `head` is the only line and it is the membership.
   */
  /*
   * A membership on a manual rail: the arrangement is recorded now, and starts
   * when the seller says the money arrived.
   *
   * `incomplete` until then, which means no access — somebody who has *said*
   * they will pay by bank transfer has not paid, and letting them in on the
   * promise is how a gym ends up with members it is not being paid for. The
   * order itself is an ordinary unpaid order on their chosen rail, so the
   * buyer gets the same handoff and the seller the same dropdown as for
   * anything else they sell.
   */
  if (isMembershipOrder && method.type !== "card") {
    const subscription = await createManualSubscription({
      shop,
      order: {
        id: order.id,
        clientId,
        productId: head.productId,
        paymentMethod: method.type,
        totalCents: totals.totalCents,
        currency: shop.currency,
      },
      interval: intervalOf(head.product),
    });

    /*
     * No subscription row, no membership. `createManualSubscription` returns
     * null only when the insert comes back empty — rare, but if the order were
     * allowed to stand it would take the buyer's money (invoice and "we have
     * your order" are both issued below) for an arrangement that never starts:
     * `extendForPaidOrder` needs `subscriptionId` and no-ops forever without
     * it. Rolled back like the coupon claim above, and for the same reason —
     * this is still before anything irreversible.
     */
    if (!subscription) {
      await releaseStockFor(taken);
      await releaseSlots(order.id);
      await db.delete(orders).where(eq(orders.id, order.id));
      return { ok: false, error: "Couldn't start the membership. Try again." };
    }

    await db
      .update(orders)
      .set({ subscriptionId: subscription.id, updatedAt: new Date() })
      .where(eq(orders.id, order.id));
  }

  /*
   * And on a card, where Stripe runs the cycle instead. The two are mutually
   * exclusive by rail, not by preference: a subscription-mode Checkout Session
   * needs a card, and a shop with no Stripe connection has none to offer.
   */
  if (isMembershipOrder && method.type === "card") {
    const member = await handOffSubscription({
      shop,
      orderId: order.id,
      product: head.product,
      imageUrl: head.imageUrl,
      successUrl: `${base}/${shop.handle}/p/${head.product.slug}?subscribed=1`,
      cancelUrl: `${base}/${shop.handle}/p/${head.product.slug}?cancelled=1`,
    });
    if (!member.ok) return { ok: false, error: member.error };
    cardHandoff = member.handoff;
  } else if (method.type === "card") {
    /*
     * The shop's own language and clock, for the line subtitles.
     *
     * Read here rather than inside the session builder because this is the
     * only place that has both the resolved product rows and the shop, and
     * because a dictionary lookup on the money path should happen once for the
     * basket rather than once per line.
     */
    const { locale, t } = await getShopT(shop.locale);
    const labels = checkoutLabels(t, locale, shop.timeZone);

    const card = await handOffToStripe({
      shop,
      orderId: order.id,
      /*
       * Stripe's page itemises the basket — picture, name, and a line saying
       * what the thing actually is — rather than lumping it under the first
       * product's name. Everything `toCheckoutLine` needs was already resolved
       * here; it simply never travelled.
       */
      /*
       * From `lines` rather than `priced.lines`, which is the same basket in
       * the same order but without the product rows — `quote` spreads each
       * line and adds money, so the prices here are the priced ones. Taking
       * the label from `variantLabel` rather than reaching across to
       * `priced.lines[i].label` avoids pairing two arrays by index, which is
       * a correctness bug waiting for the day one of them is filtered.
       */
      items: lines.map((line) =>
        toCheckoutLine(
          {
            title: line.title,
            variantLabel: line.variantOptions
              ? variantLabel(line.variantOptions, line.options)
              : null,
            kind: line.kind,
            sku: line.sku,
            imageUrl: line.imageUrl,
            description: line.product.description,
            durationMinutes: line.product.durationMinutes,
            // The variant is not asked about here: options change what a thing
            // costs and what it is called, never where it happens or how long
            // it takes.
            serviceMode: line.product.serviceMode,
            serviceLocation: line.product.serviceLocation,
            scheduledFor: line.scheduledFor,
            eventStartsAt: line.product.eventStartsAt,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
          },
          labels,
        ),
      ),
      successUrl: `${base}/invoice/${invoiceToken}?paid=1`,
      invoiceToken,
      cancelUrl:
        lines.length === 1
          ? `${base}/${shop.handle}/p/${head.product.slug}?cancelled=1`
          : `${base}/${shop.handle}?cancelled=1`,
    });

    // The handoff abandons the order on failure — stock and coupon both — so
    // there is nothing to undo here, only a message to pass on.
    if (!card.ok) return { ok: false, error: card.error };
    cardHandoff = card.handoff;
  }

  /* ---- Past here the order stands -------------------------------------- */

  /*
   * Whether the money is settled by the time this function returns.
   *
   * On every rail but card it is, in the only sense that matters: there is no
   * payment step to wait for. A bank transfer or a cash-on-delivery order is a
   * commitment the moment it is placed, the seller confirms the money later by
   * hand, and no webhook is ever coming — so the invoice and the confirmation
   * email have to be issued here or they never will be.
   *
   * A card order is the opposite. `handOffToStripe` has only created a
   * Checkout Session; the buyer has not paid and may never. Issuing an invoice
   * number now leaves a hole in the sequence when they abandon, and sending
   * "we have your order" hands them something un-recallable for an order the
   * sweep will cancel in 24 hours. Both move to
   * `checkout.session.completed`, which is where the money actually arrives.
   */
  /*
   * The card rail is the only one that defers, membership or not.
   *
   * A manual membership signup is an ordinary manual order: the order *is* the
   * commitment, the seller confirms the money later by hand, and no webhook is
   * ever coming — so its invoice and its "we have your order" have to be
   * issued here or they never will be. Deferring them because it happens to be
   * a membership would leave a bank-transfer member with no invoice to pay
   * against and nothing in their inbox saying how.
   */
  const settlesAtCheckout = method.type !== "card";

  const invoice = settlesAtCheckout
    ? await createInvoiceForOrder(shop.id, order.id, invoiceToken)
    : null;

  /*
   * Best effort, never fails the checkout — and no longer part of it.
   *
   * This was awaited, which put an HTTP call to Resend on the buyer's critical
   * path: they sat on a spinner while we talked to a mail provider about an
   * email whose result nothing here reads. `after()` runs it once the response
   * has gone, which is where work nobody is waiting for belongs.
   *
   * On the card rail the buyer has not paid yet — only the Checkout Session
   * exists — so this says "we have your order", not "we have your money". A
   * buyer who then abandons Stripe keeps an email for an order the sweep will
   * cancel, which is a real remaining gap: closing it means moving the send
   * onto the payment webhook, not reordering this function again.
   */
  if (email && settlesAtCheckout) {
    // `confirmBuyerByEmail` already logs its own failures, which is what makes
    // it safe to stop waiting for: nothing here read the result anyway.
    after(() =>
      confirmBuyerByEmail({
        shop,
        orderId: order.id,
        invoice,
        delivery: { deliversFiles, unlockNow, downloadToken },
        base,
      }),
    );
  }

  /*
   * The seller's copy, on the same discriminator as the buyer's: the rails
   * that settle at checkout notify here, and the card rail notifies from the
   * Connect webhook when the money actually lands — exactly one of the two
   * fires per order. Subject to the shop's notification prefs, best-effort,
   * and off the buyer's critical path.
   */
  if (settlesAtCheckout) {
    after(() => notifySellerOfOrder({ shop, orderId: order.id }));
  }

  /*
   * The same discriminator again, and for the same reason.
   *
   * On the rails that settle here, this order *is* the commitment and nothing
   * else is coming, so `order.created` belongs at this moment. On the card
   * rail the buyer has only opened a Stripe session — a third of which are
   * abandoned and swept — and emitting here would fire every seller's Zap for
   * checkouts that never became orders. That rail's `order.created` is
   * published by the Connect webhook alongside `order.paid`, so a consumer
   * subscribing to `order.created` gets exactly one event per real order
   * whichever way the shop takes money.
   *
   * Inside `after()`, like the mail above: the row is committed by the time it
   * runs, and a webhook for an order that failed to commit would be a lie
   * already delivered to somebody's CRM.
   *
   * No `order.paid` alongside it. Every order this function writes is
   * `paymentStatus: "unpaid"` — even a cash sale, because on these rails the
   * money arrives after the order and the seller confirming it in the admin is
   * the event that means it came. That confirmation is where `order.paid` is
   * emitted, in `updatePaymentStatus`.
   */
  if (settlesAtCheckout) {
    after(() =>
      emitOrderWebhook({ shop, event: "order.created", orderId: order.id }),
    );
  }

  // Buyers who leave an email can be offered their own referral link.
  const referral =
    shop.affiliatesEnabled && can(shop, "affiliates") && email
      ? await referralFor(shop, name, email, base)
      : null;

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  // No `/admin/invoices` — there is no such route. Invoices are shown on the
  // order, and revalidating a path nothing serves is a line that reads like
  // cache invalidation while invalidating nothing.

  /*
   * Tell the seller's open dashboard, after the buyer has their answer —
   * this is the buyer's request, and none of its latency belongs to the
   * seller's convenience. One hint covers the order, the client upsert and
   * any booking on it: the dashboard re-reads everything either way. The
   * affiliate hears too, if this sale carried their code — on the card rail
   * their commission still says "pending" until the webhook settles it,
   * which is exactly what their portal shows for it.
   */
  after(() => publishShopEvent(shop.id, "order"));
  if (affiliate) {
    after(() => publishAffiliateEvent(affiliate.id, "order"));
  }

  // A card buyer's handoff is Stripe's redirect, settled above. Every other
  // rail builds a message for the seller, and that message carries the invoice
  // number — which is why it is built here rather than before the payment.
  const handoff = cardHandoff ?? buildHandoff(method.type, method.config, {
    shopName: shop.name,
    // The seller reads this in a chat app, so every line goes in it — a cart
    // summarised to its first item would have them ringing back to ask.
    productTitle: priced.lines
      .map(
        (line) =>
          `${line.title}${line.label ? ` — ${line.label}` : ""}${
            line.quantity > 1 ? ` ×${line.quantity}` : ""
          }`,
      )
      .join("\n"),
    // Already spelled out per line above; repeating it would read as double.
    quantity: lines.length > 1 ? 1 : head.quantity,
    priceLabel: formatMoney(totals.totalCents, shop.currency),
    // Venmo and PayPal put the amount inside the URL, and neither accepts a
    // formatted one. Same number as `priceLabel`, from the same totals.
    totalCents: totals.totalCents,
    currency: shop.currency,
    productUrl:
      base && lines.length === 1
        ? `${base}/${shop.handle}/p/${head.product.slug}`
        : base
          ? `${base}/${shop.handle}`
          : undefined,
    customerName: name ?? undefined,
    note: note ?? undefined,
    address: formatAddress(address) || undefined,
    delivery: delivery
      ? `${delivery.name}${
          delivery.type === "collection" && delivery.config.address
            ? ` — ${delivery.config.address}`
            : ""
        }`
      : undefined,
    discount:
      totals.discountCents > 0 && coupon
        ? `${coupon.code} (−${formatMoney(totals.discountCents, shop.currency)})`
        : undefined,
    invoiceNumber: invoice?.number,
  });

  const config = method.config as PaymentConfig;
  const deliveryInstructions = delivery
    ? [
        delivery.config.estimate,
        delivery.config.address,
        delivery.config.hours,
        delivery.config.instructions,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return {
    ok: true,
    orderId: order.id,
    handoff,
    methodName: def.name,
    totals,
    currency: shop.currency,
    invoiceUrl: invoice && base ? `${base}/invoice/${invoice.token}` : null,
    invoiceNumber: invoice?.number ?? null,
    downloadUrl:
      unlockNow && downloadToken ? downloadUrl(downloadToken, base) : null,
    downloadPending: deliversFiles && !unlockNow,
    referral,
    bankDetails:
      method.type === "bank_transfer" ? bankDetailLines(config) : undefined,
    instructions:
      [
        config.instructions?.trim(),
        deliveryInstructions.trim(),
        // Each service tells the buyer where to be, or how to join.
        ...new Set(
          lines.flatMap((l) =>
            l.kind === "service" && l.product.serviceLocation
              ? [l.product.serviceLocation.trim()]
              : [],
          ),
        ),
      ]
        .filter(Boolean)
        .join("\n\n") || undefined,
  };
}
