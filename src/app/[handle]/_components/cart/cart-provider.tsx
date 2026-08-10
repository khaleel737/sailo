"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { addLine, cachedTotal, cartCount, cartKey, clearPendingOrder, lineKey, readCart, readPendingOrder, removeLine, setQuantity, writeCart, type CartLine } from "@/lib/cart";
import { checkoutOutcome } from "@/lib/actions/order-status";

/* -------------------------------------------------------------------------- */
/*  The store                                                                  */
/*                                                                             */
/*  localStorage is an external store, so it's read through                    */
/*  `useSyncExternalStore` rather than copied into state on mount. That keeps  */
/*  the server's empty basket and the client's real one from disagreeing       */
/*  during hydration, and makes a second tab a subscriber for free.            */
/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();
const EMPTY: CartLine[] = [];

/** Parsed lines, reused until the raw string actually changes. */
let cache: { shopId: string; raw: string | null; lines: CartLine[] } | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  // A page revived from the back/forward cache wakes with the snapshot it fell
  // asleep holding, and the missed `storage` events are not replayed — so a
  // buyer pressing Back from the invoice would see the basket that page had
  // just emptied. `pageshow` fires on every revival; re-reading is cheap.
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

function snapshot(shopId: string): CartLine[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(cartKey(shopId));
  } catch {
    return EMPTY;
  }
  // The snapshot has to be referentially stable or React re-renders forever.
  if (cache && cache.shopId === shopId && cache.raw === raw) return cache.lines;
  const lines = readCart(shopId);
  cache = { shopId, raw, lines };
  return lines;
}

type CartContext = {
  lines: CartLine[];
  /**
   * The storefront's language, so descendants can format a date or a time the
   * way this buyer reads them. It comes from the server render rather than the
   * browser: the shop may have pinned a locale, and `navigator.language` would
   * disagree with every other string on the page.
   */
  locale: string;
  count: number;
  cachedTotalCents: number;
  /** False until hydration, so nothing flashes the wrong basket. */
  ready: boolean;
  open: boolean;
  add: (line: CartLine) => void;
  setQty: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  schedule: (key: string, scheduledFor: string) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
};

const Context = createContext<CartContext | null>(null);

/** Holds the basket for one shop, across every page of it. */
export function CartProvider({
  shopId,
  locale,
  children,
}: {
  shopId: string;
  locale: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const lines = useSyncExternalStore(
    subscribe,
    () => snapshot(shopId),
    () => EMPTY,
  );
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const commit = useCallback(
    (next: CartLine[]) => {
      writeCart(shopId, next);
      emit();
    },
    [shopId],
  );

  /*
   * A card checkout leaves this page holding a full basket and a parked order
   * id, because nothing has been paid yet. Most buyers come back through the
   * invoice, which settles both. This is for the ones who did not: on the next
   * visit, ask the server what became of that order. Paid — the basket is
   * spent, empty it before the buyer buys it twice. Cancelled or gone — the
   * abandonment this exists for; the basket stays and the marker goes. Still
   * pending — Stripe may be open in another tab, so touch nothing.
   */
  useEffect(() => {
    const orderId = readPendingOrder(shopId);
    if (!orderId) return;

    let stale = false;
    void (async () => {
      try {
        const outcome = await checkoutOutcome(orderId);
        if (stale || outcome === "pending") return;
        clearPendingOrder(shopId);
        if (outcome === "settled") commit([]);
      } catch {
        // Offline, most likely. The marker keeps, and the next visit asks.
      }
    })();
    return () => {
      stale = true;
    };
  }, [shopId, commit]);

  const value = useMemo<CartContext>(
    () => ({
      lines,
      locale,
      count: cartCount(lines),
      cachedTotalCents: cachedTotal(lines),
      ready,
      open,
      // Adding does not open the basket. The buyer is still browsing; the
      // pill at the bottom is what tells them it landed.
      add: (line) => commit(addLine(lines, line)),
      setQty: (key, quantity) => commit(setQuantity(lines, key, quantity)),
      remove: (key) => commit(removeLine(lines, key)),
      schedule: (key, scheduledFor) =>
        commit(
          lines.map((line) =>
            lineKey(line) === key ? { ...line, scheduledFor } : line,
          ),
        ),
      clear: () => commit([]),
      setOpen,
    }),
    [lines, ready, open, commit, locale],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Null outside a provider, so a card can render on a page without a basket. */
export function useCart() {
  return useContext(Context);
}
