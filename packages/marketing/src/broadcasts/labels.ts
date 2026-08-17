/**
 * The words around a broadcast that are ours rather than the seller's.
 *
 * A broadcast's body is written by the seller in their own words. The chrome — the
 * unsubscribe line, the "sent by" footer — is ours, and it is rendered in the *shop's*
 * language rather than the recipient's, because that is the only language we know the
 * shop actually speaks. A buyer on an English device receiving a French shop's newsletter
 * gets French chrome, which reads as intentional; the alternative is guessing from a
 * header we do not have.
 */

import { getDictionary } from "@sailo/i18n";
import type { Shop } from "@sailo/db/schema";
import type { BroadcastLabels } from "./render";

export /** The shop's own language, for the one line of chrome we own. */
function shopDictionary(shop: Shop) {
  return { t: getDictionary(shop.locale ?? "en") };
}

export type ShopDictionary = ReturnType<typeof getDictionary>;

/** The chrome's words, in the shop's language. The body is the seller's. */
export function broadcastLabels(t: ShopDictionary): BroadcastLabels {
  return {
    unsubscribe: t.unsubscribe.link,
    amountOff: t.mailing.amountOff,
    useCode: t.mailing.useCode,
    endsOn: t.mailing.endsOn,
    minSpend: t.mailing.minSpend,
    shopNow: t.mailing.shopNow,
    friend: t.mailing.friend,
  };
}
