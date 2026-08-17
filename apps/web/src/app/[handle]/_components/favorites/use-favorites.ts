"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createStorageStore } from "@/lib/storage-store";
import {
  favoritesKey,
  isFavorite,
  readFavorites,
  removeFavorite,
  toggleFavorite,
  writeFavorites,
  type FavoriteItem,
} from "@sailo/customers/favorites";

/*
 * localStorage read through `useSyncExternalStore`, exactly like the basket —
 * and now through the same code as the basket. "Exactly like" used to mean a
 * second copy of the listener set, the subscription and the snapshot cache, with
 * a comment pointing at the file it was copied from.
 *
 * No provider: every heart on the page subscribes on its own, and the store's
 * snapshot cache is what keeps that from re-parsing once per card.
 */

const store = createStorageStore<FavoriteItem[]>({
  key: favoritesKey,
  read: readFavorites,
  empty: [],
});

/** One shop's saved products, live across every heart and tab. */
export function useFavorites(shopId: string) {
  const items = useSyncExternalStore(
    store.subscribe,
    () => store.snapshot(shopId),
    store.serverSnapshot,
  );
  /** False until hydration, so nothing flashes the wrong hearts. */
  const ready = useSyncExternalStore(
    store.subscribe,
    () => true,
    () => false,
  );

  const commit = useCallback(
    (next: FavoriteItem[]) => {
      writeFavorites(shopId, next);
      store.emit();
    },
    [shopId],
  );

  const toggle = useCallback(
    (item: FavoriteItem) => commit(toggleFavorite(store.snapshot(shopId), item)),
    [commit, shopId],
  );

  const remove = useCallback(
    (productId: string) =>
      commit(removeFavorite(store.snapshot(shopId), productId)),
    [commit, shopId],
  );

  const has = useCallback(
    (productId: string) => isFavorite(items, productId),
    [items],
  );

  return { items, ready, count: items.length, toggle, remove, has };
}
