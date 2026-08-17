/**
 * The products a buyer saved, kept in the browser.
 *
 * Same trust model as the basket: what a favourite really is is a product id.
 * The title, image and price ride along only so the favourites sheet can paint
 * instantly — the product page they link to is the truth, and a stale price
 * here costs nothing because nothing is ever charged from this list.
 */

export type FavoriteItem = {
  productId: string;
  /** The path back to the product, which is what a favourite is for. */
  slug: string;

  // Cached for first paint only.
  title: string;
  imageUrl: string | null;
  /** The cheapest combination at the time of saving, matching the card. */
  priceCents: number;
};

const PREFIX = "sailo:favs:";
/** More than this is a crawler, not a shopper with a long memory. */
const MAX_FAVORITES = 200;

export function favoritesKey(shopId: string) {
  return `${PREFIX}${shopId}`;
}

export function readFavorites(shopId: string): FavoriteItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(favoritesKey(shopId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFavoriteItem).slice(0, MAX_FAVORITES);
  } catch {
    // A corrupt or blocked store just means nothing saved.
    return [];
  }
}

export function writeFavorites(shopId: string, items: FavoriteItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(favoritesKey(shopId), JSON.stringify(items));
  } catch {
    // Private browsing, quota, whatever — the hearts still work in memory.
  }
}

function isFavoriteItem(value: unknown): value is FavoriteItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FavoriteItem>;
  return typeof item.productId === "string" && typeof item.slug === "string";
}

export function isFavorite(items: FavoriteItem[], productId: string) {
  return items.some((item) => item.productId === productId);
}

/**
 * The heart is one control with two meanings, so this is one function: saved
 * becomes unsaved and back. A save lands at the front — the sheet reads
 * newest-first, the way the buyer remembers saving.
 */
export function toggleFavorite(
  items: FavoriteItem[],
  incoming: FavoriteItem,
): FavoriteItem[] {
  if (isFavorite(items, incoming.productId)) {
    return items.filter((item) => item.productId !== incoming.productId);
  }
  return [incoming, ...items].slice(0, MAX_FAVORITES);
}

export function removeFavorite(
  items: FavoriteItem[],
  productId: string,
): FavoriteItem[] {
  return items.filter((item) => item.productId !== productId);
}
