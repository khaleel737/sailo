"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { resolveOrderIntent } from "@sailo/commerce/orders/server";
import { displayCurrency } from "@/lib/regional";
import { upsertClient } from "@sailo/commerce/orders/server";
import { saveAnswers } from "@sailo/marketing/contacts/server";
import { markSessionPaid } from "@sailo/commerce/recovery/server";
import { referralFor } from "@sailo/workflows/orders";
import type {
  OrderIntentInput,
  OrderIntentResult,
  ResolvedLine,
} from "@sailo/commerce/orders";
import { firstRow } from "@sailo/core/invariant";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { liveShop } from "@/lib/shop-visibility";
import { rateLimit } from "@sailo/rate-limit";
import { isCountryBlocked } from "@sailo/commerce/tax";
import { countryGateFor } from "@sailo/commerce/tax/server";
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
import { variantLabel } from "@sailo/core/variants";
import { releaseStock, reserveStock } from "@sailo/commerce/catalog";
import { handOffSubscription, handOffToStripe } from "@sailo/commerce/orders/server";
import { checkoutLabels, toCheckoutLine } from "@sailo/commerce/orders";
import { getShopT } from "@/i18n/server";
import { intervalCountOf, intervalOf, isMembership } from "@sailo/commerce/memberships";
import { createManualSubscription } from "@sailo/commerce/memberships/server";
import { claimCouponRedemption } from "@sailo/commerce/coupons";
import { policySnapshotsForOrder } from "@sailo/commerce/disputes";
import {
  claimSlots,
  firstFreeStaff,
  releaseSlots,
  slotEnd,
} from "@sailo/commerce/booking/server";
import { downloadUrl, newDownloadToken, releasesImmediately } from "@/lib/downloads";
import { resolveDigitalDelivery } from "@sailo/commerce/orders/server";
import {
  capacityRefusal,
  claimEventCapacity,
  eventSalesOpen,
  releaseEventCapacity,
  ticketValues,
  type EventCapacityClaim,
} from "@sailo/commerce/ticketing";
import { preorderRoom } from "@sailo/commerce/catalog";
import { attributeBumps } from "@sailo/commerce/orders/server";
import { preorderExpectedAt } from "@sailo/core/preorders";
import { confirmBuyerByEmail } from "@sailo/workflows/orders";
import { notifySellerOfOrder } from "@sailo/workflows/orders";
import { notifySellerOfLowStock } from "@sailo/workflows/orders";
import { emitOrderWebhook } from "@sailo/webhooks/emit";
import { appOrigin } from "@sailo/core/origin";


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
async function releaseStockFor(lines: ResolvedLine[]): Promise<void> {
  for (const line of lines) {
    /*
     * A ticket gives back every level it took — spec 50.
     *
     * Seven call sites reach this function and all seven are an abandonment:
     * a line that sold out, a preorder ceiling, a slot lost, a coupon spent, a
     * membership that would not start, a throw between the reservation and the
     * order row. Every one of them has to undo the *whole* claim, because
     * `claimEventCapacity` took the whole claim — the band, the date and the
     * room. Releasing only the room leaves `event_tiers.sold` counting seats
     * for an order that does not exist, and there is nothing anywhere that
     * would ever notice: the band reads as sold out for good.
     *
     * Routed by the same predicate that decided the claim, so the two cannot
     * drift into a shape where one level is taken and a different set given
     * back.
     */
    const claim = eventClaimFor(line);
    if (claim) {
      await releaseEventCapacity(claim);
      continue;
    }
    await releaseStock({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
    });
  }
}

/**
 * The claim a line makes on an event's capacity, or null when it makes none.
 *
 * One predicate, read by the reservation and by every release, because the
 * failure this shape prevents is the two disagreeing: a line claimed at three
 * levels and released at one is capacity held for ever by an order that was
 * refused a second later.
 *
 * Null for every line that names neither a band nor a date, which is every line
 * in the product today — those take the ordinary `reserveStock` path unchanged,
 * and `claimEventCapacity` would do exactly that anyway. The branch exists so
 * the non-event path keeps the shape `orders.test.ts` pins by source position.
 *
 * **Takes a `ResolvedLine`, not a `QuoteLine`, and that is load-bearing.** Two
 * of the four fields come off `line.product` — whether the product counts units
 * at all, and whether a pass admits every date — and a `QuoteLine` has no
 * product. Typed loosely with an optional `product`, a caller handing over
 * `priced.lines` would compile, silently default `allAccess` to false, and
 * release a session seat an `all_access` pass never took. `taken` carries
 * resolved lines, so this is what it already is; the type now says so.
 */
function eventClaimFor(line: ResolvedLine): EventCapacityClaim | null {
  if (!line.tierId && !line.sessionId) return null;
  return {
    productId: line.productId,
    tierId: line.tierId ?? null,
    sessionId: line.sessionId ?? null,
    variantId: line.variantId,
    quantity: line.quantity,
    /*
     * True when the product row is not to hand — `QuoteLine` does not carry
     * one, and `releaseStockFor` is given the priced lines rather than the
     * resolved ones. Harmless in both directions: `releaseStock` refuses to
     * add units to a product that is not tracking, and `reserveStock` is only
     * ever called from here with the real row, in `createOrderIntent` below.
     */
    trackInventory: line.product.trackInventory,
    /*
     * A pass claims the room, not a day of it — and it never carries a session
     * id, so this is belt and braces on a line that already cannot name one.
     */
    allAccess: line.product.sessionMode === "all_access",
  };
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
function releasingStock(taken: ResolvedLine[]) {
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

/**
 * The client's own durable browser id, if it sent one worth keeping.
 *
 * Visa requires `customer_device_fingerprint` to be **at least 20 characters**,
 * and a shorter one is not merely weak — it is a data point submitted to an
 * issuer that the network will not count, which makes the submission look
 * complete when it is not. So a short value is dropped rather than stored.
 *
 * Capped at 200 because it is client-supplied text on a public write, and
 * nothing else about it is trusted: it is evidence of a returning browser, never
 * identity and never a gate.
 */
function deviceFingerprintOf(input: OrderIntentInput): string | null {
  const raw = input.deviceFingerprint?.trim();
  if (!raw || raw.length < 20) return null;
  return raw.slice(0, 200);
}

/**
 * The last of several promised dates, ignoring the ones nobody gave.
 *
 * The order is complete when its *last* line arrives, so a basket holding a
 * two-week preorder and a six-week one is a six-week order. Quoting the sooner
 * date would be telling the buyer something the order cannot meet, on the one
 * field this whole feature exists to get right.
 */
function latestOf(dates: (Date | null)[]): Date | null {
  const real = dates.filter((d): d is Date => d !== null);
  if (real.length === 0) return null;
  return real.reduce((latest, d) => (d > latest ? d : latest));
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
    /*
     * DECISION B — deliberately stays open.
     *
     * This is the checkout. Failing it closed means a cache outage stops every
     * shop on the platform from taking an order, which is the exact trade the
     * default was chosen against — more damage than the traffic it stops. Ten a
     * minute from one address is a runaway-client guard, not a security
     * boundary, and the things that *are* boundaries on this path (stock claims,
     * coupon budgets, ownership checks) are all in Postgres and unaffected by
     * Redis being down.
     */
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

  /*
   * The country gate, beside the terms gate and for the same reason.
   *
   * Spec 38's country control is enforced here because a client-side list is a
   * suggestion: the storefront leaves a switched-off country out of the picker,
   * and this is a server action, so a hand-rolled POST carries whatever the
   * caller wants. Both read the same rows through `countryGateFor`, so the
   * picker and the refusal cannot drift — the guard at one sink and not its
   * twin is the second of the six recurring bug shapes, and here it would mean
   * a buyer choosing a country and being refused after typing a card number.
   *
   * Above every write for the same reason the terms gate is: past this line
   * `upsertClient` creates the buyer and stock comes off the shelf, and
   * refusing after a reservation holds units for an order that was never
   * allowed to exist.
   *
   * A renewal never reaches this function. That is deliberate and it is spec
   * 38's rule: a member in a country the seller later switched off keeps
   * renewing, because the switch governs new checkouts. Otherwise a compliance
   * toggle silently cancels paying members.
   */
  if (input.country) {
    const countries = await countryGateFor(shop);
    if (isCountryBlocked(countries, input.country)) {
      return {
        ok: false,
        error: "This shop isn't taking orders for that country right now.",
      };
    }
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
  /*
   * What this order is priced and charged in — spec 53.
   *
   * Re-derived from this request's own geography and cookie, not taken from
   * the body: the client sends a basket, and a currency in a request body is a
   * price in a request body one step removed. `displayCurrency` answers with a
   * currency the shop can actually quote — its own, if this visit matched
   * nothing — so there is no path from here to an order in a currency the
   * seller never priced.
   */
  const { currency } = await displayCurrency(shop);

  const resolvedIntent = await resolveOrderIntent(shop, input, now, currency);
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
    trial,
    buyer: { name, email, phone, note, address },
  } = resolvedIntent.intent;

  // A ticket sold after the doors open is one for an event already happening.
  // Judged here, before any stock is taken, so refusing costs nothing.
  /*
   * …unless the buyer picked a date, in which case that date is the doors —
   * spec 50.
   *
   * `eventSalesOpen` reads `products.eventStartsAt`, which on a multi-session
   * event describes the *first* date and nothing else. A weekly class whose
   * first Tuesday has been and gone would otherwise refuse every ticket for
   * every remaining week, which is the whole feature broken by a column that
   * predates it. `resolveLines` has already refused a session in the past, so
   * a line that names one names a future one.
   */
  const closedEvent = lines.find(
    (line) => !line.sessionId && !eventSalesOpen(line.product, now),
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
  const totals = toChargeableTotals(priced.totals, currency, shop.taxInclusive);

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

  /*
   * The shop's own checkout questions, validated against the rows that define
   * them and written to the contact — spec 34.
   *
   * Above the stock claim for the same reason the terms and country gates are:
   * a refusal past this line holds units for an order that was never allowed
   * to exist, and only the hourly sweep hands them back.
   *
   * `scope: "checkout"` is not decoration. A field the seller marked
   * contact-only is one the checkout never renders, and a hand-rolled POST
   * naming it must not be able to write it — this is a server action, so the
   * body is whatever the caller composed. Nothing about a field's type,
   * options or required-ness is read from the request either; all of it comes
   * from `contact_fields`.
   */
  const answers = await saveAnswers({
    shopId: shop.id,
    clientId,
    answers: Object.entries(input.customFields ?? {}).map(([key, raw]) => ({ key, raw })),
    scope: "checkout",
    now,
  });
  if (answers.refused.length > 0) {
    /*
     * One sentence for every reason, naming the field and not the rule it
     * broke. "Size must be one of the options" tells an honest buyer with a
     * stale form what to do, and tells somebody probing the endpoint nothing
     * about which of the eight types they hit.
     */
    return {
      ok: false,
      error: `Please check the answers on this form and try again.`,
    };
  }

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
  /*
   * …and a ticket claims three of them at once — spec 50.
   *
   * A room of 200 with 30 VIP seats is a product stock of 200 **and** a tier
   * capacity of 30, and both have to hold or thirty-one people arrive holding a
   * VIP ticket for thirty seats. `claimEventCapacity` takes the narrowest level
   * first, gives back what it took if a later one refuses, and reports which
   * level said no — see the three rules at the head of `capacity.ts`.
   *
   * The ordinary `reserveStock` call is still here, and still the whole of the
   * claim for every line that names no band and no date. That is not only
   * caution: one stock claim in the codebase is the property this file has been
   * defending since the first double-booking defect, and `claimEventCapacity`
   * ends at the same function rather than beside it.
   */
  const reservations = await Promise.all(
    lines.map(async (line) => {
      const claim = eventClaimFor(line);
      if (claim) {
        const took = await claimEventCapacity({
          ...claim,
          trackInventory: line.product.trackInventory,
          allAccess: line.product.sessionMode === "all_access",
        });
        return { line, ok: took.ok, level: took.ok ? null : took.level };
      }

      return {
        line,
        ok: await reserveStock({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          trackInventory: line.product.trackInventory,
        }),
        level: "product" as const,
      };
    }),
  );

  const taken: ResolvedLine[] = reservations.filter((r) => r.ok).map((r) => r.line);

  /*
   * A failed reservation on a preorder line is the expected outcome, not a
   * shortfall — spec 33.
   *
   * This is the whole of "do not bypass `reserveStock`". The claim ran exactly
   * as it always has, against the same guarded UPDATE, and came back false
   * because there is nothing on the shelf; `resolveLines` already decided that
   * this product's seller takes orders anyway. So one stock claim remains in
   * the codebase and the preorder path is a decision about its answer rather
   * than a second way of asking.
   *
   * A preorder line takes nothing off the shelf and so gives nothing back —
   * it is not in `taken`, and `releaseStockFor` must not "return" units that
   * were never held, which would drift the count upward on every abandonment.
   */
  const shortfall = reservations.find((r) => !r.ok && !r.line.preorder);

  if (shortfall) {
    await releaseStockFor(taken);
    /*
     * Told which level refused, because the buyer's next move differs — spec 50.
     *
     * "VIP is sold out" sends them to General and the shop keeps the sale;
     * "this event is sold out" sends them away from a room with a hundred and
     * seventy empty seats in it. The sentence lives in `capacityRefusal` so a
     * scenario can assert the one a losing buyer actually receives, which is
     * the only way this is ever checked under contention.
     */
    return {
      ok: false,
      error: capacityRefusal(shortfall.level ?? "product", shortfall.line),
    };
  }

  /*
   * Which lines this order is actually taking on trust.
   *
   * A line marked `preorder` whose reservation *succeeded* is not one: the
   * seller left stock on a preorder-enabled product, so the buyer is getting a
   * real unit and must not be shown a six-week date for it.
   */
  const preordered = reservations
    .filter((r) => !r.ok && r.line.preorder)
    .map((r) => r.line);
  const isPreorderOrder = preordered.length > 0;

  /**
   * Lines that hold no capacity, because their claim was refused.
   *
   * Only a preorder reaches here — every other refusal returned above — and a
   * preorder is precisely a line that took nothing. `releaseStockFor` already
   * knows: such a line is absent from `taken`, so it gives nothing back.
   *
   * **`restoreStock` cannot know, and that is what this set is for.** It reads
   * `order_items` months later, and a row carrying `tier_id` is indistinguishable
   * from one whose seat was actually claimed — so a cancelled preorder would
   * decrement `event_tiers.sold` for a seat this order never held, handing the
   * band a seat belonging to somebody who did. Every cancelled preorder drifts
   * the counter down by one and the band oversells by that many on the night.
   *
   * Stock drift a seller can see and correct; `sold` drift is invisible until
   * the door. So the columns are left null for these lines — which is what the
   * comment on `order_items.tier_id` already asks for, since it names the
   * restock path as their reason for existing. Which band was preordered is not
   * lost: the ticket carries it, both as its `tier` snapshot and its `tier_id`.
   */
  const unclaimed = new Set(reservations.filter((r) => !r.ok).map((r) => r.line));

  /*
   * The ceiling on preorders, before anything irreversible.
   *
   * Cheap and racy on its own, which is why it is not the only check: the claim
   * that decides is re-taken after the order row exists, below, where the n+1th
   * buyer's own order is inside the count that refuses it. This one stops the
   * ordinary case — a seller who can make fifty and has already sold fifty —
   * without writing anything.
   */
  for (const line of preordered) {
    const room = await preorderRoom({
      productId: line.productId,
      variantId: line.variantId,
      product: line.product,
      variant: line.variant,
    });
    if (room.limited) {
      await releaseStockFor(taken);
      return {
        ok: false,
        error: `${line.title} can't be preordered right now.`,
      };
    }
  }

  /* ---- Digital delivery ------------------------------------------------ */

  // Reads the products' files, so it can fail — and the stock is already off
  // the shelf by here, which is why it hands the units back on the way out.
  const digital = await resolveDigitalDelivery({
    lines,
    totalCents: totals.totalCents,
    now,
  }).catch(releasingStock(taken));
  const { deliversFiles, deliversAccess, downloadExpiresAt, downloadLimit } = digital;

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

  /*
   * An order that costs nothing does not go to a payment processor — spec 43.
   *
   * Reachable two ways now. A pay-what-you-want product with a floor of zero is
   * the deliberate one: a donation, a name-your-price download, a buyer who
   * chose nothing. A coupon that takes the whole basket off is the accidental
   * one, and it has always been reachable.
   *
   * Stripe refuses a Checkout Session whose line items add to zero, so before
   * this the card rail answered a free order with a raw gateway error the buyer
   * could do nothing about. Taking the same path a manual rail takes is the
   * honest shape: there is no payment step to wait for, so the invoice, the
   * confirmation and the files all happen here rather than on a webhook that is
   * never coming.
   *
   * `paid`, not `unpaid`, and it is not cosmetic. `releaseAbandonedCheckouts`
   * sweeps unpaid *card* orders after 24 hours — so a free order left `unpaid`
   * would be cancelled and restocked the next day, taking back a download the
   * buyer already has. Nothing is owed on it, so nothing is outstanding, and
   * revenue is unaffected because the arithmetic sums a zero.
   *
   * A membership can never land here: `saveProduct` refuses one priced at
   * nothing and `resolveLines` refuses a PWYW one, so its first period is
   * always a real charge. A manual *trial* signup is the deliberate exception
   * and is priced to zero further down, where it can be said out loud.
   */
  const isFreeOrder = totals.totalCents === 0;

  /*
   * The one free order that must not be invoiced — spec 43.
   *
   * `resolveOrderIntent` re-priced this basket to nothing because the seller
   * offers a trial on a rail Sailo runs itself, so the member has bought
   * nothing yet: they pay for their first real period when the trial lapses and
   * the renewal cron raises that order. Claiming an invoice number for this one
   * would spend one out of a sequence a tax authority expects unbroken, on a
   * document reading "total 0.00" that answers no question anybody has.
   *
   * Derived from `trial` rather than from `totalCents === 0`, and the
   * difference matters: a name-your-price download taken for nothing is also a
   * zero-value order, and that one *is* a completed sale and *does* get a
   * receipt. One flag says which is which.
   */
  const isTrialSignup = trial !== null;

  const downloadToken =
    digital.downloadToken ??
    (sellsTickets || isMembershipOrder ? newDownloadToken() : null);
  const unlockNow =
    (deliversFiles || deliversAccess ? digital.unlockNow : true) &&
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

  /*
   * Which policy text this buyer is agreeing to, resolved before the insert.
   *
   * Two indexed reads against snapshots that already exist — never a fetch. A
   * checkout that waited on a seller's own web host would fail whenever that
   * host did, which is a real outage traded for a hypothetical dispute. The
   * scheduled refresh is what keeps the snapshots current.
   */
  const policySnapshotIds = await policySnapshotsForOrder(shop);

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
      /*
       * The band's name when the first line is a ticket — spec 50.
       *
       * This column is what the seller's order list, their notification and
       * every export print beside the title, and a tier is not a variant, so
       * without the fallback an order for VIP read as "Rooftop Show" with a
       * price nobody could account for.
       */
      variantLabel: head.variantOptions
        ? variantLabel(head.variantOptions, head.options)
        : (head.tierName ?? null),
      variantSku: head.sku,
      productKind: head.kind,
      unitPriceCents: head.unitPriceCents,
      quantity: priced.unitCount,
      itemCount: lines.length,
      currency,

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
       * The answers as they were asked, not a join.
       *
       * `[]` and not null when the shop asks nothing: null on this column means
       * an order placed before it existed, and the two read differently on an
       * invoice. Blank is not absent — the same distinction rule 5 turns on.
       */
      customFields: answers.written,
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
      /*
       * A durable browser id for CE3.0's `customer_device_fingerprint`, when the
       * client offered one.
       *
       * Visa counts it as one of the two matching data points, and an order that
       * carries it *plus* an IP address qualifies on its own — which is the
       * whole of a 10.4 defence. Null for most orders and that is expected:
       * Sailo redirects to Stripe Checkout and runs no fingerprinting script, so
       * this is filled only where a caller already had a durable id. Read from
       * the same parsed input as the rest; never generated here, because an id
       * we minted per request would match nothing four months later and would be
       * a data point asserted to an issuer that means nothing.
       */
      buyerDeviceFingerprint: deviceFingerprintOf(input),
      /*
       * *What* they agreed to, beside the `termsAcceptedAt` above that records
       * when. Spec 44.
       *
       * `shops.termsUrl` is a URL whose contents the seller controls, so an
       * issuer following it four months later reads today's policy rather than
       * the one that was on screen — a URL that changed is not evidence. These
       * point at the text as it stood.
       *
       * Resolved from snapshots that already exist and never fetched here: a
       * checkout must not wait on a seller's own web host, and a scheduled
       * refresh is what keeps them current. Null is the ordinary case for a shop
       * that has written no policy, and the readiness panel reports it as
       * `missing`, which is the truth.
       */
      ...policySnapshotIds,
      /*
       * Taken against stock that does not exist yet, and what the buyer was
       * told about it — spec 33.
       *
       * The *latest* of the promised dates, not the earliest: the order is
       * complete when its last line arrives, and quoting the soonest one on a
       * basket holding two preorders would tell the buyer a date the order
       * cannot meet. Null when no date was given, which is honest and renders
       * as that.
       *
       * Snapshotted rather than joined, for the reason `0035` gives about
       * `shops.termsUrl`: a seller who slips their date next month must not
       * change what this buyer was promised today. A `product_not_received`
       * case turns on what was promised, not on what was hoped.
       */
      isPreorder: isPreorderOrder,
      preorderExpectedAt: latestOf(
        preordered.map((line) => preorderExpectedAt(line.product, line.variant)),
      ),
      paymentMethod: method.type,
      // COD is collected on delivery; transfers are owed until confirmed.
      // Nothing is owed on a free order, so nothing is outstanding — and
      // leaving one `unpaid` would have the 24-hour sweep cancel it.
      paymentStatus: isFreeOrder ? "paid" : "unpaid",
    })
    .returning({ id: orders.id }),

  // The authoritative list of what was sold, in the same transaction as the
  // header so nothing can ever read the order in a one-line-only state.
  db.insert(orderItems).values(
    priced.lines.map((line, position) => {
      /*
       * The resolved line behind this priced one. `quote` maps its input 1:1,
       * so the index pairs — the same pairing `scheduledFor` below already
       * relies on.
       */
      const resolved = lines[position];
      const heldNothing = resolved ? unclaimed.has(resolved) : false;
      return {
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
        /*
         * Which band and which date this line bought — spec 50, and the two
         * columns that have been on this table since the wave landed with nothing
         * writing them.
         *
         * Not decoration and not analytics: `restoreStock` reads them to know
         * which band to give the seat back to. Without them a refunded VIP ticket
         * returns a unit to the room and leaves `event_tiers.sold` at thirty for
         * ever, so the band is sold out and the room is not — which is the
         * failure nobody sees until the next on-sale.
         *
         * Null for a line that never claimed — see `unclaimed` above. Writing them
         * for a preorder would make the restock give away a seat this order never
         * held.
         */
        tierId: heldNothing ? null : (line.tierId ?? null),
        sessionId: heldNothing ? null : (line.sessionId ?? null),
        position,
      };
    }),
  ),
  // Admissions, one row each, valid only once the release timestamp is set.
  ...(ticketRows.length ? [db.insert(tickets).values(ticketRows)] : []),

  // Every statement is the window that opened when the stock was reserved.
  // If the transaction fails, the units go back on the shelf on the way out.
  ]).catch(releasingStock(taken));

  const order = firstRow(inserted, "order");

  /*
   * Which of these lines came from an in-cart bump — spec 08's attribution.
   *
   * **Decided server-side, from the offers this shop actually has**, never from
   * a flag the browser sent: a client saying "this line was a bump" is a client
   * telling us its own conversion rate, and the spec says so in as many words.
   *
   * After the lines exist because it is a fact *about* them — a line counts as
   * a bump when its product is the offered side of an active `bump` offer whose
   * source is somewhere else in this same order. Awaited rather than deferred,
   * because Income reads it and a seller opening their dashboard a second later
   * should not see a sale that becomes attributed while they watch.
   */
  await attributeBumps({ shopId: shop.id, orderId: order.id, now });

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
  const slots = await Promise.all(
    lines
      /*
       * The position is carried through the filter, because the order line
       * this slot belongs to has to be findable again once a person has been
       * chosen — `orderItems.position` is the index into `lines`, which is
       * what the insert above wrote.
       */
      .map((line, position) => ({ line, position }))
      .filter(({ line }) => line.scheduledFor && line.productId)
      .map(async ({ line, position }) => {
        const startsAt = line.scheduledFor as Date;
        const endsAt = slotEnd(startsAt, line.product.durationMinutes);
        /*
         * Who the appointment is with — spec 51.
         *
         * Asked at the moment the claim is taken rather than when the calendar
         * was rendered, because those are different instants and the second is
         * the one that has to be true. It is a *read* and not the guard: two
         * buyers racing for the last stylist can both be told "Sam is free"
         * here, and the exclusion constraint hands the slot to exactly one of
         * them.
         *
         * Null for a shop with no staff rows, which is every shop today, and
         * that null is what the constraint's `COALESCE(staff_id, product_id)`
         * falls back on — so nothing about this path changes for them.
         */
        const staff = await firstFreeStaff({
          shopId: shop.id,
          productId: line.productId as string,
          startsAt,
          endsAt,
        });

        return {
          position,
          productId: line.productId as string,
          startsAt,
          // The range, not just the start: two appointments that overlap are
          // as double-booked as two that begin together.
          endsAt,
          staffId: staff?.id ?? null,
          /*
           * A class takes seats rather than the whole slot — spec 51. Null or
           * one is an ordinary appointment, which is every service today, and
           * the two paths are chosen by this number alone.
           */
          seats: line.quantity,
          capacity: line.product.bookingCapacity,
        };
      }),
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

  /*
   * And the appointment says who it is with — spec 51.
   *
   * The claim already carries the person; that is what the exclusion
   * constraint keys on and it is the guarantee. This copies the answer onto
   * the order line as well, which is what `busyFor`'s staff-keyed read looks
   * at and what a seller opening an order needs to see. Written after the
   * claim rather than with the insert, because who is free is only settled at
   * the moment the claim is taken.
   *
   * No rows for a shop with no roster, so nothing about today's checkout
   * changes. Best-effort: a failure here loses a label, and undoing a paid
   * booking over a label would be the worse trade.
   */
  const assigned = slots.filter((slot) => slot.staffId);
  if (assigned.length > 0) {
    await Promise.all(
      assigned.map((slot) =>
        db
          .update(orderItems)
          .set({ staffId: slot.staffId })
          .where(
            and(
              eq(orderItems.orderId, order.id),
              eq(orderItems.position, slot.position),
            ),
          ),
      ),
    ).catch((error: unknown) => {
      console.error("[sailo] could not record who took the appointment:", error);
    });
  }

  /*
   * The preorder ceiling, re-taken now that this order is a row — spec 33.
   *
   * This is the claim, and the check before the insert was only the cheap half.
   * Two buyers arriving in the same second both read the same count there and
   * both passed; here each one's own order is inside the count, so of any burst
   * exactly `limit` orders survive and the rest are rolled back — the same
   * shape the coupon claim below uses, and rolled back the same way, because
   * this is still before anything irreversible.
   *
   * `exceptOrderId` is not passed: this order *must* be counted, or the n+1th
   * buyer would see the same `n` the nth did.
   */
  if (isPreorderOrder) {
    for (const line of preordered) {
      const room = await preorderRoom({
        productId: line.productId,
        variantId: line.variantId,
        product: line.product,
        variant: line.variant,
      });
      if (room.limited) {
        await releaseStockFor(taken);
        await releaseSlots(order.id);
        await db.delete(orders).where(eq(orders.id, order.id));
        return {
          ok: false,
          error: `${line.title} can't be preordered right now.`,
        };
      }
    }
  }

  const base = appOrigin();

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
        /*
         * What the *membership* is worth, which on a trial is not what this
         * order is worth.
         *
         * The signup order is zero — nothing has been bought yet — and this
         * used to copy that total straight onto the subscription, which would
         * have set a trialling member's recurring price to nothing and gone on
         * asking them for nothing every month for ever. `trial.priceCents`
         * carries the product's real price through the re-pricing that made
         * the order free.
         */
        totalCents: trial?.priceCents ?? totals.totalCents,
        currency,
      },
      interval: intervalOf(head.product),
      intervalCount: intervalCountOf(head.product),
      /*
       * And the trial itself, which is what opens the door before any money
       * arrives — spec 43. Absent on every other manual signup, where the
       * subscription stays `incomplete` until the seller confirms the payment.
       */
      trialDays: trial?.days ?? null,
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
  } else if (method.type === "card" && !isFreeOrder) {
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
            // And on Stripe's own page, which is the last thing a buyer reads
            // before their card is charged — spec 50.
            variantLabel: line.variantOptions
              ? variantLabel(line.variantOptions, line.options)
              : (line.tierName ?? null),
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
   *
   * A free order settles here too, on every rail including card — spec 43.
   * There is no Checkout Session for it and none is coming, so deferring its
   * invoice and its confirmation would defer them for ever: the buyer would
   * have a download and no receipt, and the seller an order that never
   * appeared to complete.
   */
  const settlesAtCheckout = method.type !== "card" || isFreeOrder;

  /*
   * The invoice, except for the one order that must not have one.
   *
   * A manual trial's signup order is zero-value and exists only to carry the
   * subscription — the member has bought nothing yet and pays for their first
   * real period when the trial lapses. Giving it a number would spend one out
   * of a sequence a tax authority expects unbroken, on a document reading
   * "total: 0.00" that answers no question anybody has. `trialSignupOrder`
   * states the rule once so this sink and the seller's own screens cannot
   * disagree about which orders it covers.
   *
   * Every *other* free order still gets one. A name-your-price download that
   * somebody took for nothing is a completed sale, and a buyer who paid zero
   * on purpose is exactly as entitled to a receipt as one who paid twenty.
   */
  const invoice =
    settlesAtCheckout && !isTrialSignup
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
        delivery: { deliversFiles, deliversAccess, unlockNow, downloadToken },
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
   * And whether that order has just emptied a shelf — spec 51.
   *
   * On every rail, not only the ones that settle here, and that is the
   * difference from the notification above it. The units came off the shelf
   * when this order was written — before the card was charged, so that two
   * buyers racing for the last one cannot both be told yes — so the shortage is
   * real the moment the order exists, whatever Stripe goes on to say about the
   * money. A card checkout that is then abandoned puts them back through the
   * sweep, which re-arms the alert on its way past.
   *
   * One call per distinct product rather than per line: a basket holding two
   * variants of the same shirt is one stockroom question, and the mail names
   * which combinations are short.
   *
   * Inside `after()` and best-effort, like every other notification here: this
   * reports on something that has already happened and must never be able to
   * fail it.
   */
  for (const productId of new Set(lines.map((line) => line.productId))) {
    after(() => notifySellerOfLowStock({ shop, productId }));
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

  /*
   * The checkout session this order came from — spec 32.
   *
   * `viaResumeLink` is a report from the browser and it decides nothing on its
   * own: `markSessionPaid` re-reads the session's own status, and
   * `statusAfterPayment` requires it to have actually been `recovering`, which
   * only the recovery cron can make it. So a forged flag turns nothing into a
   * recovered sale — it can only fail to claim one that was.
   *
   * Deferred, because it is bookkeeping: a seller's recovery rate must never
   * be between a buyer and their order confirmation.
   */
  if (input.checkoutSessionId) {
    const sessionId = input.checkoutSessionId;
    const viaResumeLink = input.viaResumeLink === true;
    after(async () => {
      try {
        await markSessionPaid({
          shopId: shop.id,
          sessionId,
          orderId: order.id,
          viaResumeLink,
        });
      } catch (error) {
        console.error("[sailo] checkout session attribution failed", error);
      }
    });
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
    priceLabel: formatMoney(totals.totalCents, currency),
    // Venmo and PayPal put the amount inside the URL, and neither accepts a
    // formatted one. Same number as `priceLabel`, from the same totals.
    totalCents: totals.totalCents,
    currency,
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
        ? `${coupon.code} (−${formatMoney(totals.discountCents, currency)})`
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
    currency,
    invoiceUrl: invoice && base ? `${base}/invoice/${invoice.token}` : null,
    invoiceNumber: invoice?.number ?? null,
    downloadUrl:
      unlockNow && downloadToken ? downloadUrl(downloadToken, base) : null,
    downloadPending: (deliversFiles || deliversAccess) && !unlockNow,
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
