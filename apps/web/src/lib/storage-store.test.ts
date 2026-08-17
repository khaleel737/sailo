import { describe, expect, it, vi } from "vitest";
import { createStorageStore } from "./storage-store";

/**
 * The store behind the basket and the saved-products list.
 *
 * Both of those had this code and neither had a test, because in its old shape it
 * reached for `window` directly and `apps/web` runs vitest in node. The rules below
 * are the ones a buyer notices when they break:
 *
 * - a snapshot that is not referentially stable re-renders forever
 * - a snapshot that never re-parses shows a stale basket after a write
 * - a `pageshow` that is not subscribed shows an emptied basket on Back
 * - a `getItem` that throws takes down the page instead of showing an empty basket
 */

/** A `localStorage` whose contents a test can set. */
const fakeStorage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => map.set(k, v),
  };
};

/** A `window` that records what subscribed to it. */
const fakeTarget = () => {
  const handlers = new Map<string, Set<EventListener>>();
  return {
    addEventListener: (type: string, fn: EventListener) => {
      const set = handlers.get(type) ?? new Set();
      set.add(fn);
      handlers.set(type, set);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      handlers.get(type)?.delete(fn);
    },
    fire: (type: string) => {
      for (const fn of handlers.get(type) ?? []) fn(new Event(type));
    },
    count: (type: string) => handlers.get(type)?.size ?? 0,
  };
};

type Line = { id: string };

const build = (initial: Record<string, string> = {}) => {
  const storage = fakeStorage(initial);
  const target = fakeTarget();
  const read = vi.fn((scope: string): Line[] =>
    JSON.parse(storage.getItem(`cart:${scope}`) ?? "[]") as Line[],
  );
  const store = createStorageStore<Line[]>({
    key: (scope) => `cart:${scope}`,
    read,
    empty: [],
    storage: () => storage,
    target: () => target,
  });
  return { store, storage, target, read };
};

describe("snapshot stability", () => {
  it("returns the same object until the stored string changes", () => {
    const { store } = build({ "cart:shop-1": '[{"id":"a"}]' });

    const first = store.snapshot("shop-1");
    const second = store.snapshot("shop-1");

    // Not `toEqual`: React compares by reference, so equal-but-new re-renders.
    expect(second).toBe(first);
  });

  it("parses once for repeated reads, which is why a card grid is cheap", () => {
    const { store, read } = build({ "cart:shop-1": '[{"id":"a"}]' });

    for (let i = 0; i < 10; i++) store.snapshot("shop-1");

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("re-parses when the stored string changes", () => {
    const { store, storage } = build({ "cart:shop-1": '[{"id":"a"}]' });
    const before = store.snapshot("shop-1");

    storage.set("cart:shop-1", '[{"id":"a"},{"id":"b"}]');
    const after = store.snapshot("shop-1");

    expect(after).not.toBe(before);
    expect(after).toHaveLength(2);
  });

  /*
   * One module-level cache, more than one shop on the origin — a buyer can have
   * two storefronts open. Keying the cache on the scope is what stops shop B's
   * basket being served from shop A's parse.
   */
  it("does not serve one shop's basket from another's cache", () => {
    const { store } = build({
      "cart:shop-1": '[{"id":"a"}]',
      "cart:shop-2": '[{"id":"b"},{"id":"c"}]',
    });

    expect(store.snapshot("shop-1")).toHaveLength(1);
    expect(store.snapshot("shop-2")).toHaveLength(2);
    expect(store.snapshot("shop-1")).toHaveLength(1);
  });

  /*
   * An unstored basket still goes through `read`, which parses `"[]"` into a fresh
   * array — so it is *not* the same object as the server snapshot, and does not need
   * to be. What matters is that it is stable from the second call onwards, which is
   * what the cache gives it. This is the behaviour both copies already had.
   */
  it("is empty and stable for a shop with nothing stored", () => {
    const { store } = build();

    const first = store.snapshot("shop-1");
    expect(first).toEqual([]);
    expect(store.snapshot("shop-1")).toBe(first);
  });
});

describe("when storage is denied", () => {
  /*
   * Safari in private mode throws on read rather than returning null. An empty
   * basket is survivable; an exception in a snapshot function is a blank page.
   */
  it("degrades to empty instead of throwing", () => {
    const target = fakeTarget();
    const store = createStorageStore<Line[]>({
      key: (scope) => `cart:${scope}`,
      read: () => [{ id: "never" }],
      empty: [],
      storage: () => ({
        getItem: () => {
          throw new Error("The operation is insecure.");
        },
      }),
      target: () => target,
    });

    expect(() => store.snapshot("shop-1")).not.toThrow();
    expect(store.snapshot("shop-1")).toEqual([]);
  });
});

describe("subscription", () => {
  it("wakes on another tab's write", () => {
    const { store, target } = build();
    const onChange = vi.fn();
    store.subscribe(onChange);

    target.fire("storage");

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  /*
   * The back/forward cache case, and the reason `pageshow` is subscribed at all: a
   * revived page missed the `storage` events that fired while it was frozen, so
   * without this a buyer pressing Back from the invoice sees the basket they
   * already checked out with.
   */
  it("wakes on a back/forward-cache revival", () => {
    const { store, target } = build();
    const onChange = vi.fn();
    store.subscribe(onChange);

    target.fire("pageshow");

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("notifies a same-tab write, which fires no storage event of its own", () => {
    const { store } = build();
    const onChange = vi.fn();
    store.subscribe(onChange);

    store.emit();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes both listeners, so an unmounted component stops being woken", () => {
    const { store, target } = build();
    const onChange = vi.fn();

    const unsubscribe = store.subscribe(onChange);
    expect(target.count("storage")).toBe(1);
    expect(target.count("pageshow")).toBe(1);

    unsubscribe();

    expect(target.count("storage")).toBe(0);
    expect(target.count("pageshow")).toBe(0);
    store.emit();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wakes every subscriber, because each price and heart subscribes on its own", () => {
    const { store } = build();
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe(first);
    store.subscribe(second);

    store.emit();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("the server snapshot", () => {
  /*
   * Hydration: the server has no storage, so it renders empty. Returning a fresh
   * `[]` here is the classic infinite-render bug, so it has to be the same object
   * every time.
   */
  it("is the same object on every call", () => {
    const { store } = build({ "cart:shop-1": '[{"id":"a"}]' });

    expect(store.serverSnapshot()).toBe(store.serverSnapshot());
    expect(store.serverSnapshot()).toEqual([]);
  });
});
