/**
 * Whether a buyer has agreed to a seller's marketing tags, per shop.
 *
 * Separate from `consent.ts` on purpose. That file is Sailo's own question
 * about Sailo's own pages; this one is asked on a storefront, about tools the
 * *seller* configured, where the seller — not us — is the controller. Keeping
 * the stores apart means a yes to Sailo is never read as a yes to a seller,
 * and the two banners can never answer each other's question.
 *
 * Keyed per shop for the same reason. Two storefronts share our origin but
 * not a controller: a buyer who accepted the pixels on one shop has said
 * nothing about the next shop they open, so the answer lives under that
 * shop's id and every other shop starts unasked.
 *
 * The choice is kept in `localStorage`, not a cookie — storing a consent
 * decision is itself exempt, and recording an answer about cookies should not
 * set one.
 */

/** Bumped if what the category covers changes, making old answers stale. */
export const SHOP_CONSENT_VERSION = 1;

export type ShopConsentChoice = "granted" | "denied";

export type ShopConsentRecord = {
  /** One category: every tool the seller configured is marketing to a buyer. */
  marketing: ShopConsentChoice;
  version: number;
  /** ISO date, so "when did they agree" has an answer. */
  at: string;
};

/** Fired when a choice changes, so the tags can mount without a reload. */
export const SHOP_CONSENT_EVENT = "sailo:shop-consent";

export function shopConsentKey(shopId: string): string {
  return `sailo_shop_consent:${shopId}`;
}

export function readShopConsent(shopId: string): ShopConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(shopConsentKey(shopId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("marketing" in parsed) ||
      !("version" in parsed)
    ) {
      return null;
    }
    const record = parsed as ShopConsentRecord;
    // A stored answer to a different question is not an answer.
    if (record.version !== SHOP_CONSENT_VERSION) return null;
    if (record.marketing !== "granted" && record.marketing !== "denied") {
      return null;
    }
    return record;
  } catch {
    // Private browsing, a full quota, a hand-edited value: every one of them
    // is "not asked yet", never consent.
    return null;
  }
}

export function writeShopConsent(
  shopId: string,
  marketing: ShopConsentChoice,
): void {
  if (typeof window === "undefined") return;
  const record: ShopConsentRecord = {
    marketing,
    version: SHOP_CONSENT_VERSION,
    at: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(shopConsentKey(shopId), JSON.stringify(record));
  } catch {
    // Nothing to do. The banner asks again next time, which is the safe
    // direction to fail in.
  }
  window.dispatchEvent(new CustomEvent(SHOP_CONSENT_EVENT));
}

/**
 * Forgets the answer for this shop, so its banner asks again.
 *
 * Withdrawing has to be as easy as giving. The storefront footer's cookie
 * button calls this, and the tags unmount on the same event that mounted
 * them, so nothing further is measured from the click.
 */
export function clearShopConsent(shopId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(shopConsentKey(shopId));
  } catch {
    // Nothing stored, nothing to forget.
  }
  window.dispatchEvent(new CustomEvent(SHOP_CONSENT_EVENT));
}

export function hasShopMarketingConsent(shopId: string): boolean {
  return readShopConsent(shopId)?.marketing === "granted";
}
