import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { productImages, productVariants, products } from "@sailo/db/schema";
import { clampQuantity, isSellable, maxOrderable } from "@sailo/core/variants";
import {
  isPwyw,
  resolvedUnitPriceCents,
  sellWindowState,
} from "@sailo/core/pricing-models";
import { isMembership, membershipSellable } from "../memberships/memberships";
import { toStripeAmount } from "@sailo/core/currency";
import { productAtCurrency, variantAtCurrency } from "@sailo/core/regional";
import type { OrderLineInput } from "./types";
import type { ResolvedLine } from "./types";
import { parseBooking } from "./booking";
import type { ProductVariant } from "@sailo/db/schema";
import { isBookable, slotOptionsFor, type BookingShop } from "../booking/availability";
import { isOfferedSlot } from "../booking/slots";

/**
 * Turns what the browser asked for into what the shop actually sells.
 *
 * Nothing the client sent is trusted: the title, the price and the stock all
 * come back from the database, so a tampered basket buys the same thing at the
 * same price as an honest one. `strict` is the difference between checkout,
 * where an unavailable line must stop the order, and the preview, where it is
 * dropped and reported so the buyer can see what changed.
 */

/** Past this a basket is a bug or a bot, not a shopping trip. */
const MAX_LINES = 50;

export async function resolveLines(
  shopId: string,
  items: OrderLineInput[],
  opts: {
    strict: boolean;
    now: Date;
    /**
     * The shop's booking settings, when the caller is committing rather than
     * quoting. Present means slots are re-derived server-side and a time that
     * is no longer offered fails the order; absent means only the notice
     * period is checked, which is all a price preview needs.
     */
    shop?: BookingShop;
    /**
     * The shop's currency, so prices come back in amounts a card can settle.
     *
     * Rounding here rather than at either caller is the point: `previewOrder`
     * and `createOrderIntent` both start from this function, and when only the
     * committing one rounded, a buyer in KWD saw one total in the basket and
     * was charged another — and qualified a coupon against the wrong subtotal
     * on the way. One place decides, so the two cannot disagree.
     */
    currency?: string;
    /**
     * The shop's own currency, when `currency` above is **not** it — spec 53.
     *
     * Present means every price on this basket comes out of `currency_prices`
     * rather than out of `price_cents`, and a product with no entry is refused
     * rather than quoted at the shop's own number with the wrong symbol on it.
     * Absent — every caller before this feature — means one currency, and the
     * two are the same value, so nothing changes.
     */
    shopCurrency?: string;
  },
): Promise<
  | { ok: true; lines: ResolvedLine[]; dropped: OrderLineInput[] }
  | { ok: false; error: string }
> {
  const db = getDb();
  const lines: ResolvedLine[] = [];
  /** Slots this basket has already taken, which no committed order can show. */
  const claimedSlots = new Set<string>();
  const dropped: OrderLineInput[] = [];

  if (items.length === 0) return { ok: false, error: "Your basket is empty." };

  const fail = (line: OrderLineInput, error: string) => {
    if (opts.strict) return { ok: false as const, error };
    dropped.push(line);
    return null;
  };

  const wanted = items.slice(0, MAX_LINES);

  /*
   * Two queries for the whole basket, not two per line.
   *
   * This ran a `products` lookup and then a `productVariants` lookup inside
   * the loop, sequentially — so a five-line cart was ten round trips to Neon,
   * and it is not only the checkout that pays: `previewOrder` calls this on
   * every basket change, every delivery choice and every coupon attempt, so a
   * shopper adjusting quantities paid it over and over.
   *
   * The `shopId` and `isPublished` constraints stay in the query rather than
   * being filtered afterwards. They are the reason a buyer cannot order
   * another shop's product, or a draft, by editing the payload — a rule worth
   * keeping in the WHERE where it cannot be forgotten.
   */
  const ids = [...new Set(wanted.map((i) => i.productId))];
  const [found, allVariants, allImages] = await Promise.all([
    ids.length > 0
      ? db.query.products.findMany({
          where: and(
            inArray(products.id, ids),
            eq(products.shopId, shopId),
            eq(products.isPublished, true),
          ),
        })
      : Promise.resolve([]),
    ids.length > 0
      ? db.query.productVariants.findMany({
          where: inArray(productVariants.productId, ids),
          orderBy: [asc(productVariants.position)],
        })
      : Promise.resolve([]),
    /*
     * The gallery, for the line's picture.
     *
     * A third batched query rather than a `with:` on the products one, because
     * `ResolvedLine.product` is typed as the plain row and joining images onto
     * it would change that type for all forty of its readers to serve one.
     *
     * Ordered by position and deduplicated below to the first per product,
     * which is the same "first image is the cover" rule the storefront card,
     * the broadcast email and the export all use.
     */
    ids.length > 0
      ? db.query.productImages.findMany({
          where: inArray(productImages.productId, ids),
          orderBy: [asc(productImages.position)],
          columns: { productId: true, url: true },
        })
      : Promise.resolve([]),
  ]);

  /*
   * Every product re-read in the currency this order is priced in — spec 53.
   *
   * Done once, here, rather than at the price line four hundred characters
   * down: `isSellable`, `maxOrderable`, `variantPrice` and the membership
   * checks all take the product row, and a row swapped in one place and not
   * another is the half-updated-pair shape this repo keeps a list of.
   *
   * A product with no price in this currency is **dropped from the map**, so
   * it fails exactly as an unpublished or deleted product does — one code
   * path, one message, and no branch that could quote it at the shop's own
   * number with the wrong symbol on it.
   */
  const regional = Boolean(
    opts.shopCurrency &&
      opts.currency &&
      opts.currency.toUpperCase() !== opts.shopCurrency.toUpperCase(),
  );
  const priced = regional
    ? found
        .map((row) =>
          productAtCurrency(row, opts.currency ?? "", opts.shopCurrency ?? ""),
        )
        .filter((row) => row !== null)
    : found;

  const byId = new Map(priced.map((p) => [p.id, p]));
  const coverByProduct = new Map<string, string>();
  for (const image of allImages) {
    if (!coverByProduct.has(image.productId)) {
      coverByProduct.set(image.productId, image.url);
    }
  }
  /*
   * Every variant, unswapped, and that is deliberate after getting it wrong.
   *
   * The first version dropped a variant with no price in this currency from
   * this map, on the reasoning that a combination which cannot be priced is a
   * combination that cannot be picked. It is — but dropping the *only* variant
   * left the list empty, and an empty list is how `resolveLines` says "this
   * product has no options", so the line fell straight through to the
   * product's own price. A euro order for a variant that had never been priced
   * in euros went through at the product's euro price. The scenario suite
   * caught it; nothing else would have.
   *
   * So the map holds what the shop actually has, and the currency is applied
   * to the one combination the buyer picked, below, where a null can be
   * refused rather than mistaken for an absence.
   */
  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const v of allVariants) {
    const list = variantsByProduct.get(v.productId);
    if (list) list.push(v);
    else variantsByProduct.set(v.productId, [v]);
  }

  for (const item of wanted) {
    const product = byId.get(item.productId);
    if (!product) {
      const stop = fail(item, "Product not available.");
      if (stop) return stop;
      continue;
    }

    const variants = variantsByProduct.get(product.id) ?? [];

    let variant: ProductVariant | null = null;
    if (variants.length > 0) {
      variant = variants.find((v) => v.id === item.variantId) ?? null;
      if (!variant) {
        const what = product.options[0]?.name?.toLowerCase() ?? "option";
        const stop = fail(item, `Choose a ${what} for ${product.title}.`);
        if (stop) return stop;
        continue;
      }

      /*
       * And now in the currency this order is priced in — spec 53.
       *
       * A variant that inherits the product's price passes through untouched
       * in every currency. One that overrides it and has no entry cannot be
       * quoted at all, and the line is refused rather than falling back to
       * anything: the product's own euro price is a price for a *different*
       * combination, and charging it would sell the large one at the small
       * one's price.
       *
       * `liveCurrencies` makes this unreachable from the storefront — a shop
       * with a gap like this is not offered the currency in the first place —
       * so this is the guard for the window between two caches.
       */
      if (regional) {
        const priced = variantAtCurrency(
          variant,
          opts.currency ?? "",
          opts.shopCurrency ?? "",
        );
        if (!priced) {
          const stop = fail(item, `${product.title} isn't available right now.`);
          if (stop) return stop;
          continue;
        }
        variant = priced;
      }
    }

    if (!isSellable(product, variant)) {
      const stop = fail(item, `${product.title} is sold out.`);
      if (stop) return stop;
      continue;
    }

    /*
     * The sell window closes the sale, not just the page — spec 43.
     *
     * A product page opened at ten to five must not complete at five past, and
     * hiding the button is no answer at all: the checkout is a server action a
     * browser can call directly, and a cached page can outlive its own window
     * by design (`cacheLife("max")` never expires on a clock). So the refusal
     * is here, where every rail and every surface passes through, rather than
     * anywhere it could be skipped.
     *
     * Two sentences, not one, because the buyer's options genuinely differ:
     * something that has not opened yet is worth waiting for and something
     * that has closed is not. Neither leaks anything — both are true of a
     * product the caller can already see.
     *
     * The variant's own window narrows the product's; `sellWindowState` is
     * where that is decided, so no caller can widen one by asking the pair
     * separately.
     */
    const window = sellWindowState(product, variant, opts.now);
    if (window !== "open") {
      const stop = fail(
        item,
        window === "early"
          ? `${product.title} isn't on sale yet.`
          : `${product.title} is no longer available.`,
      );
      if (stop) return stop;
      continue;
    }

    /*
     * A membership that cannot be billed is not for sale.
     *
     * A seller can save a membership with no interval chosen, or priced at
     * nothing, and both are configuration mistakes rather than states Stripe
     * can be asked to handle: it will not create a recurring price for zero,
     * and it has no idea how often to charge without an interval. Refusing
     * here turns a Stripe error the buyer cannot act on into an ordinary
     * "not available" — and leaves the seller's own product form to say what
     * is missing, which it does.
     */
    if (isMembership(product) && !membershipSellable(product)) {
      const stop = fail(item, `${product.title} isn't available right now.`);
      if (stop) return stop;
      continue;
    }

    /*
     * A membership may not be pay-what-you-want — spec 43.
     *
     * A recurring buyer-chosen amount is a Stripe Price per buyer: Prices are
     * immutable and per-amount, so a hundred members choosing a hundred
     * numbers is a hundred objects on the seller's account to find again at
     * every renewal. `saveProduct` already refuses the combination, so this is
     * the second lock rather than the first — and it is the one that holds for
     * a row that predates the rule or was written by a route that forgot it.
     *
     * Refused with a sentence rather than silently priced at the list amount,
     * the same way coupons on memberships are: a seller who set it and was
     * never told would believe they were selling something they are not.
     */
    if (isMembership(product) && isPwyw(product)) {
      const stop = fail(item, `${product.title} isn't available right now.`);
      if (stop) return stop;
      continue;
    }

    /*
     * A service books its own slot, against its own notice period.
     *
     * `isBookable`, not `bookingEnabled` alone. A product with booking turned
     * on but no duration set is misconfigured — it can offer no slots, because
     * the generator needs a length — and the re-derivation below is skipped
     * for exactly that reason. Entering this branch on `bookingEnabled` meant
     * such a product still accepted whatever `scheduledFor` the client sent,
     * checked against nothing but `parseBooking`'s year-wide window. Nobody
     * could reach that by using the shop; it was only reachable by forging the
     * payload, which is who the check is for.
     */
    let scheduledFor: Date | null = null;
    if (isBookable(product)) {
      scheduledFor = parseBooking(
        item.scheduledFor,
        product.bookingLeadHours,
        opts.now,
      );
      if (item.scheduledFor?.trim() && !scheduledFor) {
        const stop = fail(
          item,
          `Pick a time for ${product.title} at least ${product.bookingLeadHours} hours from now.`,
        );
        if (stop) return stop;
        continue;
      }

      /*
       * The slot is re-derived here, not taken on trust.
       *
       * The browser was handed a list of free times, but a list is a snapshot:
       * by the time this order arrives the slot may have been booked by
       * somebody else, the seller may have changed their hours, or the value
       * may never have come from the list at all — it is a client payload.
       * Asking the same question again, against the same rules and the
       * bookings as they stand now, is the only answer that cannot be argued
       * with.
       */
      if (scheduledFor && opts.shop) {
        const slotOptions = await slotOptionsFor(
          opts.shop,
          product,
          {
            from: new Date(scheduledFor.getTime() - 24 * 3_600_000),
            to: new Date(scheduledFor.getTime() + 24 * 3_600_000),
          },
          opts.now,
        );

        if (!isOfferedSlot(scheduledFor, slotOptions)) {
          const stop = fail(
            item,
            `That time for ${product.title} has just been taken. Pick another.`,
          );
          if (stop) return stop;
          continue;
        }

        /*
         * And against the rest of this basket.
         *
         * `busyFor` reads committed orders, and none of these lines is one
         * yet — so two lines asking for the same product at the same time both
         * passed, and the shop owed one slot to two appointments in a single
         * order. Every other line-level rule here re-reads the database; this
         * is the one question the database cannot answer.
         */
        const key = `${product.id}@${scheduledFor.getTime()}`;
        if (claimedSlots.has(key)) {
          const stop = fail(
            item,
            `${product.title} is already booked for that time in this order.`,
          );
          if (stop) return stop;
          continue;
        }
        claimedSlots.add(key);
      }
    }

    /*
     * A membership is always one.
     *
     * Not a clamp for tidiness: the Checkout Session sends `quantity: 1`
     * against a recurring price, so a line claiming two would have priced the
     * basket at double what Stripe then billed every month — an order row and
     * a card statement disagreeing forever, on the one kind of sale where the
     * disagreement repeats. Nobody subscribes to the same gym twice.
     */
    const quantity = isMembership(product)
      ? 1
      : clampQuantity(item.quantity, maxOrderable(product, variant));

    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      title: product.title,
      kind: product.kind,
      options: product.options,
      variantOptions: variant?.options ?? null,
      /*
       * The variant's code when the buyer picked a combination, the product's
       * own otherwise.
       *
       * It used to be the variant's alone, which is null for every product
       * sold without options — so the column that exists on the order line to
       * carry a code carried one only for shops that use variants. The same
       * fallback the cover image gets two lines down, for the same reason.
       */
      sku: variant?.sku ?? product.sku ?? null,
      /*
       * The variant's own photo when the buyer picked one, the product's cover
       * otherwise.
       *
       * It used to be `variant?.imageUrl ?? null` alone, which is null for
       * every product sold without options — most of them. That null is copied
       * onto `orderItems.imageUrl` and read by everything downstream, so a
       * seller's order list, their emails and the Stripe checkout page all
       * showed a placeholder for a product that has had a photo all along.
       */
      imageUrl: variant?.imageUrl ?? coverByProduct.get(product.id) ?? null,
      // The price the buyer is charged comes from the variant they picked.
      /*
       * …or, on a pay-what-you-want product, from what they typed — clamped.
       *
       * This is the only line in the checkout where a number from the request
       * survives, and `resolvedUnitPriceCents` is the whole of the reason it
       * is safe to. It reads the mode from the *database row*, so a forged
       * `priceCents` against a fixed-price product is ignored rather than
       * validated, and on a PWYW one it is floored at the seller's minimum
       * with `NaN`, `Infinity`, negatives and fractional minor units all
       * refused on the way through.
       *
       * Here rather than at the two callers, and that is the point.
       * `previewOrder` and `createOrderIntent` are both built on this
       * function, so the amount the basket quotes and the amount the card is
       * asked for are the same clamp applied once — the recurring
       * "guard applied at one sink not its twin" shape has no room to happen
       * on this path because there is only one place the guard lives.
       *
       * Rounded to what this currency can actually settle. A no-op for
       * sixty-six of the seventy-one; for KWD, BHD, JOD, OMR and TND — quoted
       * to three decimals, settled to two — it is what stops Stripe refusing
       * the charge and what keeps the quote and the order the same number. It
       * matters more here than anywhere: a buyer typing 12.345 KWD into an
       * amount field is naming a number their own card cannot pay.
       */
      unitPriceCents: toStripeAmount(
        resolvedUnitPriceCents(product, variant, item.priceCents),
        opts.currency ?? "USD",
      ),
      quantity,
      /*
       * What one of these weighs, for a rate priced by weight — spec 51.
       *
       * The variant's, falling back to the product's, which is the same rule
       * its price and its photo already follow: a large weighs more than a
       * small and that is most of what a size *is*, but a shirt in three
       * colours weighs the same in all of them and its seller should not have
       * to type it three times.
       *
       * Set here rather than at either sink, for the reason every other number
       * on this line is: `previewOrder` and `createOrderIntent` are both built
       * on this function, so the weight the basket is quoted against and the
       * weight the order is charged against cannot be two different additions.
       */
      weightGrams: variant?.weightGrams ?? product.weightGrams ?? null,
      product,
      variant,
      scheduledFor,
    });
  }

  if (lines.length === 0) {
    return { ok: false, error: "Nothing in your basket is available right now." };
  }
  return { ok: true, lines, dropped };
}
