/**
 * `localStorage` as an external store React can subscribe to.
 *
 * WHY THIS EXISTS
 *
 * The basket and the saved-products list each had their own copy — the same
 * `listeners` set, the same `emit`, the same `subscribe` registering `storage` and
 * `pageshow`, and the same snapshot cache keyed on the raw string. Byte for byte
 * identical in the parts that matter, and one of the two comments said *"see
 * cart-provider"*, which is the tell: the second was written by copying the first.
 *
 * A third such store — a recently-viewed list, a saved address — would have been
 * written the same way, and the three would have drifted the way they always do.
 *
 * WHY THE SEAMS ARE INJECTABLE
 *
 * `apps/web` has no jsdom and no `@testing-library/react`, and vitest runs in a
 * node environment. So the code below was, in both of its copies, **untestable** —
 * which is why neither copy had a test, on the path a buyer's basket lives on.
 *
 * Taking the storage and the event target as arguments (defaulting to the real
 * ones) makes every rule here checkable in plain node: that a snapshot is
 * referentially stable, that it re-parses when and only when the raw string
 * changes, that a `pageshow` wakes a subscriber, that a thrown `localStorage`
 * degrades to empty instead of taking the page down. `./storage-store.test.ts`
 * does that. It needed no new dependency — only a function that accepts its world
 * instead of reaching for it.
 */

/** The part of `Storage` this needs, so a test can pass an object literal. */
type ReadableStorage = Pick<Storage, "getItem">;

/** The part of `window` this needs. */
type Subscribable = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export type StorageStore<T> = {
  /** For `useSyncExternalStore`'s first argument. */
  subscribe: (onChange: () => void) => () => void;
  /** For its second: the client snapshot, referentially stable between changes. */
  snapshot: (scope: string) => T;
  /** For its third: what the server renders, which must be the same object each time. */
  serverSnapshot: () => T;
  /** Called after a write, because a same-tab write fires no `storage` event. */
  emit: () => void;
};

export function createStorageStore<T>(options: {
  /** Where this scope's value is kept, e.g. `cartKey(shopId)`. */
  key: (scope: string) => string;
  /** Parses the stored value. Called only when the raw string has changed. */
  read: (scope: string) => T;
  /**
   * The empty value, as one shared object.
   *
   * A fresh `[]` per call would make `useSyncExternalStore` re-render forever,
   * because it compares snapshots by reference.
   */
  empty: T;
  storage?: () => ReadableStorage;
  target?: () => Subscribable;
}): StorageStore<T> {
  const { key, read, empty } = options;
  const storage = options.storage ?? (() => window.localStorage);
  const target = options.target ?? (() => window);

  const listeners = new Set<() => void>();
  let cache: { scope: string; raw: string | null; value: T } | null = null;

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      const events = target();
      events.addEventListener("storage", onChange);
      /*
       * A page revived from the back/forward cache wakes with the snapshot it fell
       * asleep holding, and the missed `storage` events are not replayed — so a
       * buyer pressing Back from the invoice would see the basket that page had
       * just emptied. `pageshow` fires on every revival; re-reading is cheap.
       */
      events.addEventListener("pageshow", onChange);
      return () => {
        listeners.delete(onChange);
        events.removeEventListener("storage", onChange);
        events.removeEventListener("pageshow", onChange);
      };
    },

    snapshot(scope) {
      let raw: string | null = null;
      try {
        raw = storage().getItem(key(scope));
      } catch {
        /*
         * Safari in private mode, and any browser with storage denied, throws on
         * read. An empty basket is a survivable answer; an exception here would
         * take down the page that renders it.
         */
        return empty;
      }
      // Referentially stable, or React re-renders forever.
      if (cache && cache.scope === scope && cache.raw === raw) return cache.value;
      const value = read(scope);
      cache = { scope, raw, value };
      return value;
    },

    serverSnapshot() {
      return empty;
    },

    emit() {
      for (const listener of listeners) listener();
    },
  };
}
