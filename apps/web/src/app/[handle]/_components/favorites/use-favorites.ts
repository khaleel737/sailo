"use client";

import { useCallback, useSyncExternalStore } from "react";
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
 * localStorage read through `useSyncExternalStore`, exactly like the basket:
 * the server's empty list and the client's real one never disagree during
 * hydration, and a second tab is a subscriber for free. No provider — every
 * heart on the page subscribes on its own, and the snapshot cache below keeps
 * that from re-parsing the store once per card.
 */

const listeners = new Set<() => void>();
const EMPTY: FavoriteItem[] = [];

/** Parsed items, reused until the raw string actually changes. */
let cache: {
  shopId: string;
  raw: string | null;
  items: FavoriteItem[];
} | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  // Back/forward-cache revivals miss their `storage` events; see cart-provider.
  window.addEventListener("pageshow", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("pageshow", onChange);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

function snapshot(shopId: string): FavoriteItem[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(favoritesKey(shopId));
  } catch {
    return EMPTY;
  }
  if (cache && cache.shopId === shopId && cache.raw === raw) return cache.items;
  const items = readFavorites(shopId);
  cache = { shopId, raw, items };
  return items;
}

/** One shop's saved products, live across every heart and tab. */
export function useFavorites(shopId: string) {
  const items = useSyncExternalStore(
    subscribe,
    () => snapshot(shopId),
    () => EMPTY,
  );
  /** False until hydration, so nothing flashes the wrong hearts. */
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const commit = useCallback(
    (next: FavoriteItem[]) => {
      writeFavorites(shopId, next);
      emit();
    },
    [shopId],
  );

  const toggle = useCallback(
    (item: FavoriteItem) => commit(toggleFavorite(snapshot(shopId), item)),
    [commit, shopId],
  );

  const remove = useCallback(
    (productId: string) =>
      commit(removeFavorite(snapshot(shopId), productId)),
    [commit, shopId],
  );

  const has = useCallback(
    (productId: string) => isFavorite(items, productId),
    [items],
  );

  return { items, ready, count: items.length, toggle, remove, has };
}
