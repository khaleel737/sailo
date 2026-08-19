import "server-only";
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  offerEvents,
  offers,
  orderItems,
  productImages,
  products,
  type Offer,
  type Product,
} from "@sailo/db/schema";
import {
  offerEligibility,
  offersForBasket,
  takeRate,
  type OfferPlacement,
} from "@sailo/core/offers";
import { variantPrice } from "@sailo/core/variants";
import { orderLines } from "./order-lines";
import type { Order } from "@sailo/db/schema";

/**
 * Reading, showing and claiming an offer — specs 36 and 08.
 *
 * WHAT THIS MODULE WILL NOT DO
 *
 * It will not price anything. The amount an offer sells at is read from the
 * seller's own row and handed to `resolveLines`, which prices it exactly as it
 * prices every other line — so a cross-sell adds no pricing trust, and a forged
 * `price_cents` from a browser is not merely rejected, it is never consulted.
 *
 * It will not charge anything. Spec 36 describes an instant one-click charge
 * against the buyer's existing Stripe customer and saved payment method, and
 * Sailo has neither: `orders` carries a session id and a payment-intent id and
 * nothing else, no Checkout Session sets `setup_future_usage`, and there is no
 * card on file anywhere in the product. Building that means consent to store a
 * card, an EU mandate, an SCA fallback when the off-session charge is refused,
 * and a surface for a buyer to see and remove a stored method — a money-path
 * release with its own scenario suite.
 *
 * The spec names the answer for exactly this case: *"Redirect to a normal
 * checkout where anything is missing — this is the honest default and it must
 * be the fallback for everything."* So a taken offer becomes an ordinary
 * re-priced checkout for a new, separately-numbered order, and
 * `offer_events.resulting_order_id` links the two when it settles.
 */

/** An offer, resolved to something a page can draw. */
export type ResolvedOffer = {
  offer: Offer;
  product: Product;
  imageUrl: string | null;
  /** What it sells at: the override, or the product's own price. */
  priceCents: number;
  /** The product's list price, when the offer undercuts it. Null otherwise. */
  compareAtCents: number | null;
};

/* -------------------------------------------------------------------------- */
/*  Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The offers that may be drawn for this basket or this order.
 *
 * Every rule is re-asked at the claim, and this decides only what renders — a
 * page can sit open for an hour, and an offer that expired in the meantime must
 * not be completable. `takeOffer` below is where that is enforced.
 *
 * `alreadyBought` is the product ids the buyer already has: the basket's on a
 * bump, the paid order's on a cross-sell. Offering somebody the thing they have
 * just bought is the most common way a cross-sell reads as broken.
 */
export async function offersFor(input: {
  shopId: string;
  placement: OfferPlacement;
  /** What is in the basket, or on the order. */
  productIds: string[];
  now: Date;
  limit?: number;
}): Promise<ResolvedOffer[]> {
  const db = getDb();

  /*
   * Shop-wide offers and product-attached ones in one query.
   *
   * `sourceProductId is null` is "every product in this shop", which is what a
   * seller with one thing to cross-sell wants and saves them attaching the same
   * offer to forty products by hand.
   */
  const rows = await db.query.offers.findMany({
    where: and(
      eq(offers.shopId, input.shopId),
      eq(offers.placement, input.placement),
      eq(offers.isActive, true),
      input.productIds.length > 0
        ? or(
            isNull(offers.sourceProductId),
            inArray(offers.sourceProductId, input.productIds),
          )
        : isNull(offers.sourceProductId),
    ),
    orderBy: [asc(offers.position), asc(offers.createdAt)],
    limit: 20,
  });
  if (rows.length === 0) return [];

  const applicable = offersForBasket(rows, input.productIds);
  if (applicable.length === 0) return [];

  const [offered, images] = await Promise.all([
    db.query.products.findMany({
      where: inArray(
        products.id,
        applicable.map((o) => o.offerProductId),
      ),
    }),
    db.query.productImages.findMany({
      where: inArray(
        productImages.productId,
        applicable.map((o) => o.offerProductId),
      ),
      orderBy: [asc(productImages.position)],
      columns: { productId: true, url: true },
    }),
  ]);

  const byId = new Map(offered.map((p) => [p.id, p]));
  const coverByProduct = new Map<string, string>();
  for (const image of images) {
    if (!coverByProduct.has(image.productId)) {
      coverByProduct.set(image.productId, image.url);
    }
  }

  const drawn: ResolvedOffer[] = [];
  for (const offer of applicable) {
    const product = byId.get(offer.offerProductId);
    const verdict = offerEligibility(offer, product, {
      now: input.now,
      alreadyBought: input.productIds,
      /*
       * A bump cannot carry a membership: a subscription Checkout Session is a
       * different Stripe mode and `resolveOrderIntent` refuses a mixed basket
       * outright. A cross-sell may offer one, because taking it routes to a
       * checkout of its own.
       */
      allowsRecurring: input.placement === "crosssell",
    });
    if (!verdict.ok || !product) continue;

    /*
     * The price, read from the seller's row and nowhere else.
     *
     * The override is the offer's; the fallback is the product's own, through
     * `variantPrice` so a specific variant's price wins where the offer names
     * one. Both are stored numbers — this function never sees a request body.
     */
    const list = variantPrice(product, null);
    const priceCents = offer.priceCents ?? list;

    drawn.push({
      offer,
      product,
      imageUrl: coverByProduct.get(product.id) ?? null,
      priceCents,
      /*
       * The struck-through number, and only where the offer genuinely undercuts
       * the list price. An offer priced *above* it would otherwise advertise a
       * saving that is a surcharge.
       */
      compareAtCents: priceCents < list ? list : null,
    });
    if (drawn.length >= (input.limit ?? 3)) break;
  }

  return drawn;
}

/** Everything the buyer already has, so nothing is offered to them twice. */
export async function boughtProductIds(order: Order): Promise<string[]> {
  const lines = await orderLines(order);
  return [
    ...new Set(lines.map((line) => line.productId).filter((id): id is string => !!id)),
  ];
}

/* -------------------------------------------------------------------------- */
/*  Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Records that an offer was drawn.
 *
 * The denominator. Take-rate is `taken / shown`, so this has to be written when
 * the offer *renders* or a seller is reading a rate against a guess. Deliberately
 * not unique on (offer, order): a buyer who reloads the thank-you page saw it
 * twice, and swallowing the second impression would inflate the rate.
 *
 * Best-effort. This is analytics attached to a page that has already rendered a
 * receipt, and a failed insert must never be able to break it.
 */
export async function recordShown(
  offerIds: string[],
  orderId: string | null,
): Promise<void> {
  if (offerIds.length === 0) return;
  try {
    await getDb()
      .insert(offerEvents)
      .values(
        offerIds.map((offerId) => ({ offerId, orderId, outcome: "shown" as const })),
      );
  } catch (error) {
    console.error("[sailo] offer impression not recorded", error);
  }
}

export async function recordSkipped(offerId: string, orderId: string): Promise<void> {
  try {
    await getDb()
      .insert(offerEvents)
      .values({ offerId, orderId, outcome: "skipped" });
  } catch (error) {
    console.error("[sailo] offer skip not recorded", error);
  }
}

export type TakeOfferResult =
  | { ok: true; offer: Offer; product: Product; priceCents: number }
  | { ok: false; reason: "not_found" | "expired" | "unavailable" | "already_taken" };

/**
 * Claims an offer for one order, and answers what to sell.
 *
 * WHY THE CLAIM COMES FIRST
 *
 * One-click means double-click. The unique index on (offer, order) for `taken`
 * is the whole of the idempotency, and it is taken **before** the checkout is
 * built — the shape the refund race fix used. The loser gets `already_taken`
 * rather than a second order, and a caller that then fails to build the
 * checkout releases it explicitly.
 *
 * WHY EXPIRY IS RE-ASKED HERE
 *
 * Theirs is explicit and it is the right rule: *"if a customer opens a
 * cross-sell checkout that has a time-limited offer, they won't be able to
 * complete the purchase once the offer expires — even if the page is still
 * open."* The render-time check decides what is drawn; this one decides what
 * can be bought, and only the second one is a rule.
 */
export async function takeOffer(input: {
  shopId: string;
  offerId: string;
  orderId: string;
  now: Date;
}): Promise<TakeOfferResult> {
  const db = getDb();

  const offer = await db.query.offers.findFirst({
    where: and(eq(offers.id, input.offerId), eq(offers.shopId, input.shopId)),
  });
  if (!offer) return { ok: false, reason: "not_found" };

  const product = await db.query.products.findFirst({
    where: eq(products.id, offer.offerProductId),
  });

  const verdict = offerEligibility(offer, product, {
    now: input.now,
    // Nothing is excluded here: the buyer is deliberately taking this one, and
    // the "already bought" rule is about what to *draw*, not what to refuse.
    alreadyBought: [],
    allowsRecurring: offer.placement === "crosssell",
  });
  if (!verdict.ok) {
    if (verdict.reason === "expired") {
      /*
       * Written down rather than merely refused. A seller whose window was too
       * tight sees the count of buyers who reached the button and could not
       * press it, which is the one number that would otherwise be invisible.
       */
      await db
        .insert(offerEvents)
        .values({ offerId: offer.id, orderId: input.orderId, outcome: "expired" });
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "unavailable" };
  }
  if (!product) return { ok: false, reason: "unavailable" };

  /*
   * The claim. `onConflictDoNothing` against the partial unique index means the
   * second of two simultaneous taps writes nothing and is told so — rather than
   * building a second checkout for an offer already taken.
   */
  const claimed = await db
    .insert(offerEvents)
    .values({ offerId: offer.id, orderId: input.orderId, outcome: "taken" })
    .onConflictDoNothing()
    .returning({ id: offerEvents.id });
  if (claimed.length === 0) return { ok: false, reason: "already_taken" };

  return {
    ok: true,
    offer,
    product,
    priceCents: offer.priceCents ?? variantPrice(product, null),
  };
}

/**
 * Hands a claim back, for a caller whose checkout then failed to build.
 *
 * Without it a buyer whose payment page failed to open could never take that
 * offer again — the claim is what stops a double tap, and a claim that outlives
 * the thing it was guarding is a permanently refused offer.
 */
export async function releaseOfferClaim(
  offerId: string,
  orderId: string,
): Promise<void> {
  await getDb()
    .delete(offerEvents)
    .where(
      and(
        eq(offerEvents.offerId, offerId),
        eq(offerEvents.orderId, orderId),
        eq(offerEvents.outcome, "taken"),
      ),
    );
}

/** Links the order a taken offer produced, once it exists. */
export async function linkResultingOrder(input: {
  offerId: string;
  orderId: string;
  resultingOrderId: string;
}): Promise<void> {
  await getDb()
    .update(offerEvents)
    .set({ resultingOrderId: input.resultingOrderId })
    .where(
      and(
        eq(offerEvents.offerId, input.offerId),
        eq(offerEvents.orderId, input.orderId),
        eq(offerEvents.outcome, "taken"),
      ),
    );
}

/* -------------------------------------------------------------------------- */
/*  What the seller reads                                                      */
/* -------------------------------------------------------------------------- */

export type OfferPerformance = {
  offer: Offer;
  shown: number;
  taken: number;
  /** Null where nothing has been shown — see `takeRate`. */
  rate: number | null;
};

export async function offerPerformance(shopId: string): Promise<OfferPerformance[]> {
  const db = getDb();

  const rows = await db.query.offers.findMany({
    where: eq(offers.shopId, shopId),
    orderBy: [asc(offers.placement), asc(offers.position)],
  });
  if (rows.length === 0) return [];

  const counts = await db
    .select({
      offerId: offerEvents.offerId,
      outcome: offerEvents.outcome,
      total: count(),
    })
    .from(offerEvents)
    .where(
      inArray(
        offerEvents.offerId,
        rows.map((o) => o.id),
      ),
    )
    .groupBy(offerEvents.offerId, offerEvents.outcome);

  const tally = new Map<string, { shown: number; taken: number }>();
  for (const row of counts) {
    const entry = tally.get(row.offerId) ?? { shown: 0, taken: 0 };
    if (row.outcome === "shown") entry.shown = row.total;
    if (row.outcome === "taken") entry.taken = row.total;
    tally.set(row.offerId, entry);
  }

  return rows.map((offer) => {
    const entry = tally.get(offer.id) ?? { shown: 0, taken: 0 };
    return { offer, ...entry, rate: takeRate(entry) };
  });
}

/**
 * Marks the lines an order took from a bump — spec 08's attribution.
 *
 * **Decided server-side, from the offers this shop actually has.** A client flag
 * saying "this line was a bump" is a client telling us its own conversion rate,
 * and the spec says so in as many words.
 *
 * Called after the lines are written, because it is a fact *about* them: a line
 * counts as a bump when its product is the offered side of an active `bump`
 * offer whose source is somewhere else in the same order.
 */
export async function attributeBumps(input: {
  shopId: string;
  orderId: string;
  now: Date;
}): Promise<void> {
  const db = getDb();

  const lines = await db.query.orderItems.findMany({
    where: eq(orderItems.orderId, input.orderId),
    columns: { id: true, productId: true },
  });
  const productIds = lines
    .map((l) => l.productId)
    .filter((id): id is string => Boolean(id));
  if (productIds.length < 2) return;

  const candidates = await db.query.offers.findMany({
    where: and(
      eq(offers.shopId, input.shopId),
      eq(offers.placement, "bump"),
      eq(offers.isActive, true),
      inArray(offers.offerProductId, productIds),
    ),
  });

  for (const offer of candidates) {
    /*
     * The source has to be in the basket too — that is what makes this line a
     * *bump* rather than a product somebody happened to buy. A shop-wide bump
     * has no source, and any second line qualifies.
     */
    if (offer.sourceProductId && !productIds.includes(offer.sourceProductId)) continue;
    if (offer.validUntil && input.now >= offer.validUntil) continue;
    if (offer.validFrom && input.now < offer.validFrom) continue;

    await db
      .update(orderItems)
      .set({ viaBump: true, viaOfferId: offer.id })
      .where(
        and(
          eq(orderItems.orderId, input.orderId),
          eq(orderItems.productId, offer.offerProductId),
          /*
           * Never the source's own line, even where a shop-wide bump offers a
           * product that is also in the basket on its own account. Without it a
           * one-line order for the bumped product would attribute itself.
           */
          sql`${orderItems.productId} <> coalesce(${offer.sourceProductId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        ),
      );
  }
}
