"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  addLine,
  cachedTotal,
  cartCount,
  cartKey,
  lineKey,
  readCart,
  removeLine,
  setQuantity,
  writeCart,
  type CartLine,
} from "@/lib/cart";

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
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
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
  children,
}: {
  shopId: string;
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

  const value = useMemo<CartContext>(
    () => ({
      lines,
      count: cartCount(lines),
      cachedTotalCents: cachedTotal(lines),
      ready,
      open,
      add: (line) => {
        commit(addLine(lines, line));
        setOpen(true);
      },
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
    [lines, ready, open, commit],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Null outside a provider, so a card can render on a page without a basket. */
export function useCart() {
  return useContext(Context);
}
