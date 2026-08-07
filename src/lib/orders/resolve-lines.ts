import "server-only";
import { and, asc, eq } from "drizzle-orm";
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
  const dropped: OrderLineInput[] = [];

  if (items.length === 0) return { ok: false, error: "Your basket is empty." };

  const fail = (line: OrderLineInput, error: string) => {
    if (opts.strict) return { ok: false as const, error };
    dropped.push(line);
    return null;
  };

  for (const item of items.slice(0, MAX_LINES)) {
    const product = await db.query.products.findFirst({
      where: and(
        eq(products.id, item.productId),
        eq(products.shopId, shopId),
        eq(products.isPublished, true),
      ),
    });
    if (!product) {
      const stop = fail(item, "Product not available.");
      if (stop) return stop;
      continue;
    }

    const variants = await db.query.productVariants.findMany({
      where: eq(productVariants.productId, product.id),
      orderBy: [asc(productVariants.position)],
    });

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

    // A service books its own slot, against its own notice period.
    let scheduledFor: Date | null = null;
    if (product.kind === "service" && product.bookingEnabled) {
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
      if (scheduledFor && opts.shop && isBookable(product)) {
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
