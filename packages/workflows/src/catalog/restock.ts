import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { broadcastDeliveries, productVariants, products, type Shop } from "@sailo/db/schema";
import { isSuppressed } from "@sailo/marketing/broadcasts/server";
import { rateLimit } from "@sailo/rate-limit";
import { isSellable } from "@sailo/core/variants";
import {
  claimStockNotifications,
  owedVariants,
} from "@sailo/commerce/catalog";
import { sendBackInStock } from "@sailo/email/transactional";
import { absolute } from "@sailo/core/origin";

/**
 * Telling everybody who asked that it is back — spec 33.
 *
 * The trigger is **stock crossing zero upward**, which happens in exactly one
 * place a seller controls: them raising the count. There is no poll and no
 * cron. A queue that is checked on a schedule is a queue that tells somebody
 * four hours after the thing sold out again.
 *
 * THE CLAIM IS WHAT MAKES THIS SAFE TO CALL FREELY
 *
 * `claimStockNotifications` spends each row in the statement that reads it, so
 * this function can be called on every save, from every path, by two ticks at
 * once — and each waiting contact hears exactly once. That matters more than it
 * sounds: a seller adjusting stock in a spreadsheet-like screen crosses zero
 * several times in a minute, and messaging the same person twice in three days
 * is what gets a sending domain reported.
 *
 * SAILO DOES NOT SEND TO A PHONE
 *
 * There is no WhatsApp Business API here and no SMS provider, and pretending
 * otherwise would be a promise the platform cannot keep. A phone-only request is
 * still claimed — so it leaves the queue and appears on the seller's screen as
 * something to do — and the seller presses send themselves, from their own
 * number, through the `wa.me` link that screen renders. That reaches every
 * country, costs nothing, needs no approval, and is more likely to be read than
 * any email.
 */

/**
 * The daily backstop, separate from the claim.
 *
 * The claim already stops the same *person* being told twice. This stops one
 * shop emptying a queue of four thousand in an afternoon — a seller pasting a
 * new stock column into a spreadsheet-like screen can cross zero on a hundred
 * products in a minute, and every one of those is a real crossing that the
 * claim is right to allow. What it is not is a hundred sends' worth of
 * reputation spent in sixty seconds.
 *
 * Deliberately generous. This is a message somebody asked for by name, so the
 * cost of suppressing one is a lost sale and a buyer who thinks the shop
 * forgot them.
 */
const DAILY_CEILING = Number(process.env.RESTOCK_DAILY_CEILING ?? 500);

/**
 * Tells whoever is waiting for anything on this product that it is back.
 *
 * Called after stock has already moved, from wherever it moved: a seller
 * saving a product, a cancelled order putting units back. It re-reads
 * availability itself rather than trusting the caller to have decided, because
 * "the seller pressed save" is not the same fact as "there is something on the
 * shelf" — a save that lowered the count would otherwise send a queue's worth
 * of messages about a product that is still sold out.
 *
 * Swallows everything. By the time this runs the stock is already where the
 * seller put it, and a mail provider having a bad afternoon must never fail the
 * save that triggered it.
 */
export async function notifyBackInStock(opts: {
  shop: Shop;
  productId: string;
}): Promise<void> {
  try {
    const { shop, productId } = opts;
    const db = getDb();

    /*
     * Which combinations anybody is actually waiting for, asked first.
     *
     * A product with twelve combinations and one person waiting is one queue,
     * not twelve, and walking every combination would read the whole variant
     * table to find nothing on the other eleven.
     */
    const owed = await owedVariants(productId);
    if (owed.length === 0) return;

    const product = await db.query.products.findFirst({
      where: eq(products.id, productId),
      columns: {
        id: true,
        title: true,
        slug: true,
        inStock: true,
        trackInventory: true,
        stockQuantity: true,
      },
    });
    if (!product) return;

    const variants = await db.query.productVariants.findMany({
      where: eq(productVariants.productId, productId),
    });
    const byId = new Map(variants.map((v) => [v.id, v]));

    for (const variantId of owed) {
      const variant = variantId ? (byId.get(variantId) ?? null) : null;

      /*
       * Still nothing on the shelf, so nobody is told.
       *
       * `isSellable` is the same predicate the storefront and the checkout ask,
       * which is what stops this becoming a second opinion about availability —
       * a message saying something is back, sent about something that is not,
       * is worse than no message at all.
       *
       * A request against a variant that has since been deleted resolves to
       * `null` here and is judged on the product, which is the honest reading:
       * the seller reorganised their options and the buyer still wants the
       * thing.
       */
      if (!isSellable(product, variant)) continue;

      const claimed = await claimStockNotifications(productId, variantId);
      if (claimed.length === 0) continue;

      const url = absolute(`/${shop.handle}/p/${product.slug}`);
      const label = variant
        ? Object.values(variant.options).filter(Boolean).join(" / ")
        : null;

      for (const request of claimed) {
        /*
         * A phone-only request leaves the queue here and is not sent to.
         *
         * It is deliberately still *claimed*: the seller's screen lists it with
         * a `wa.me` link, and leaving it owed would mean the next restock
         * offered it to them a second time as though they had never seen it.
         */
        if (!request.email) continue;

        /*
         * The suppression list binds this mail like every other. A bounced or
         * complained address must never be mailed again by this shop — this
         * path skipped the check entirely, which is exactly the behaviour the
         * table exists to stop. Still claimed: the request was answered, the
         * answer is "we may not write to you".
         */
        if (await isSuppressed(shop.id, request.email)) continue;

        if (!(await underCeiling(shop.id))) return;

        const sent = await sendBackInStock({
          shop,
          to: request.email,
          productTitle: product.title,
          variantLabel: label,
          productUrl: url,
        });
        if (!sent.sent) {
          console.warn(`[sailo] back-in-stock email not sent: ${sent.reason}`);
        } else {
          /*
           * The complaint ledger — a delivery row with the provider id is the
           * only route a bounce or complaint webhook has back to this shop.
           * Without it this mail's complaints vanished: no suppression, no
           * reputation contribution.
           */
          await getDb()
            .insert(broadcastDeliveries)
            .values({
              shopId: shop.id,
              email: request.email,
              status: "sent",
              providerId: sent.id,
              sentAt: new Date(),
            });
        }
      }
    }
  } catch (error) {
    console.error("[sailo] back-in-stock notification failed", error);
  }
}

const ceilingLogged = new Set<string>();

async function underCeiling(shopId: string): Promise<boolean> {
  /*
   * Fails **open**, unlike the public write that fills this queue.
   *
   * The two are different risks. A stock request is a row anybody on the
   * internet can cause, so its ceiling is a boundary and closes when Redis
   * does. This is a message somebody already asked for by name, weeks ago; a
   * cache outage suppressing it means a buyer never hears about the thing they
   * queued for and a seller loses the sale they were holding it open for.
   */
  const verdict = await rateLimit(`restock-mail:${shopId}`, DAILY_CEILING, 86_400);
  if (!verdict.allowed && !ceilingLogged.has(shopId)) {
    ceilingLogged.add(shopId);
    console.error(
      `[sailo] restock notification ceiling hit for shop ${shopId} — ` +
        `suppressing further back-in-stock mail today`,
    );
  }
  return verdict.allowed;
}
