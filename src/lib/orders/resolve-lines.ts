import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { productVariants, products } from "@/db/schema";
import { clampQuantity, isSellable, maxOrderable, variantPrice } from "@/lib/variants";
import type { OrderLineInput } from "./types";
import type { ResolvedLine } from "./types";
import { parseBooking } from "./booking";
import type { ProductVariant, Shop } from "@/db/schema";
import { isBookable, slotOptionsFor } from "@/lib/booking/availability";
import { isOfferedSlot } from "@/lib/booking/slots";

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
    shop?: Pick<Shop, "bookingHours" | "timeZone" | "bookingSlotMinutes">;
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
  const [found, allVariants] = await Promise.all([
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
  ]);

  const byId = new Map(found.map((p) => [p.id, p]));
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
    }

    if (!isSellable(product, variant)) {
      const stop = fail(item, `${product.title} is sold out.`);
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

    const quantity = clampQuantity(item.quantity, maxOrderable(product, variant));

    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      title: product.title,
      kind: product.kind,
      options: product.options,
      variantOptions: variant?.options ?? null,
      sku: variant?.sku ?? null,
      imageUrl: variant?.imageUrl ?? null,
      // The price the buyer is charged comes from the variant they picked.
      unitPriceCents: variantPrice(product, variant),
      quantity,
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
