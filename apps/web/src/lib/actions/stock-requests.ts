"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { liveShop } from "@/lib/shop-visibility";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { requestStock } from "@sailo/commerce/catalog";
import {
  clientIdForEmail,
  enrolIfMatching,
} from "@sailo/marketing/automations/server";

/**
 * "Tell me when the blue medium is back" — spec 33.
 *
 * A public, unauthenticated write, and the two rules that follow from that are
 * the whole of this file.
 *
 * **It fails closed.** Decision B: a public write, and one that costs a row.
 * `{ onOutage: "closed" }` means a Redis outage refuses rather than waving
 * everything through — and the refusal is *not* an answer about the product.
 * `verdict.reason` is read so the copy can say "try again shortly" rather than
 * anything about stock, because a buyer told "you'll hear from us" when nothing
 * was written is a buyer who will wait for ever.
 *
 * **It is not an existence oracle.** "You'll hear from us" is the answer whether
 * or not the row was written, whether or not that contact was already waiting,
 * and whether or not the variant exists. A response that varied would be a way
 * to test which of a seller's variants are real and who is watching them — and
 * the second half of that is somebody else's data.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not subscribe anybody to anything. These people asked to be told
 * about one thing; rolling them into the shop's marketing contacts would be
 * consent laundering, and the suppression rules in `@sailo/marketing` exist to
 * prevent exactly it. A separate, explicit, un-ticked opt-in on the same form is
 * fine and is not this action.
 */

export type StockRequestState =
  | { ok: true }
  /** Redis is down, so nothing was written and the copy must say so. */
  | { ok: false; unavailable: true }
  /** Too many from this address. Says nothing about the product. */
  | { ok: false; unavailable: false };

export async function requestStockAlert(input: {
  shopId: string;
  productId: string;
  variantId?: string | null;
  email?: string | null;
  phone?: string | null;
  locale?: string | null;
}): Promise<StockRequestState> {
  /*
   * DECISION B — fails closed.
   *
   * Five a minute is far above anybody signing up for one thing and far below
   * what it takes to fill a seller's table. The ceiling is per address rather
   * than per product on purpose: the abuse worth stopping is one caller writing
   * thousands of rows across a catalogue, not one buyer changing their mind
   * about which size they want.
   */
  const gate = await rateLimit(`stock-request:${await callerIp()}`, 5, 60, {
    onOutage: "closed",
  });
  if (!gate.allowed) {
    return { ok: false, unavailable: gate.reason === "outage" };
  }

  const shop = await getDb().query.shops.findFirst({
    where: liveShop(eq(shops.id, input.shopId)),
    columns: { id: true },
  });

  /*
   * A shop that is not live is answered exactly like one that is.
   *
   * The alternative tells a caller which shop ids exist and which are suspended,
   * which is a fact about somebody's business that no buyer needs. Nothing is
   * written; the sentence is the same.
   */
  if (shop) {
    await requestStock({
      shopId: shop.id,
      productId: input.productId,
      variantId: input.variantId ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      locale: input.locale ?? null,
    });

    /*
     * `waitlist.signup` — spec 30's fourth trigger.
     *
     * Here rather than inside `requestStock`, because that lives in
     * `@sailo/commerce` and reaching for `@sailo/marketing` from there is the
     * sideways domain import the workflows layer exists to remove.
     *
     * Swallowed, and deliberately: this endpoint's whole design is that its
     * answer never depends on what the database contains, so a flow that
     * failed to enrol must not become the one case that answers differently.
     * The buyer is told the same sentence either way.
     */
    const email = input.email?.trim().toLowerCase();
    if (email) {
      try {
        await enrolIfMatching({
          shopId: shop.id,
          trigger: "waitlist.signup",
          subject: {
            email,
            clientId: await clientIdForEmail(shop.id, email),
          },
          context: { productId: input.productId },
        });
      } catch (error) {
        console.error("[sailo] waitlist.signup enrolment failed", error);
      }
    }
  }

  return { ok: true };
}
