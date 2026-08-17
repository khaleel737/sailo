"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ShopFilters } from "@/lib/queries";
import { cn } from "@sailo/design-system/web/cn";
import { loadMoreProducts } from "../_lib/load-more-products";
import type { ShopLayout } from "../_types/shop-page.types";

/**
 * The grid, and the rest of the catalogue as the shopper reaches it.
 *
 * This owns the grid container rather than sitting under it, so a batch that
 * arrives later lands in the same grid as the first — appended below it
 * instead, each batch would start its own row and leave a ragged gap wherever
 * one ended.
 *
 * The first batch is rendered on the server and arrives as `children`. That
 * is deliberate: the shop still paints, and still has products in its HTML,
 * if this component never hydrates.
 */
export function InfiniteGrid({
  handle,
  filters,
  initialOffset,
  layout,
  labels,
  children,
}: {
  handle: string;
  filters: ShopFilters;
  /** Where batch two starts, or null when the first batch was the whole shop. */
  initialOffset: number | null;
  layout: ShopLayout;
  labels: { loadMore: string; loading: string };
  children: ReactNode;
}) {
  const [batches, setBatches] = useState<ReactNode[]>([]);
  const [offset, setOffset] = useState<number | null>(initialOffset);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  /*
   * State can't guard the request on its own. The observer can fire twice
   * before React has re-rendered with `pending` set, and both calls would ask
   * for the same offset and append the same products twice. A ref changes
   * synchronously, so the second call sees the first.
   */
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current || offset === null) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);

    try {
      const batch = await loadMoreProducts(handle, filters, offset);
      setBatches((previous) => [...previous, batch.nodes]);
      setOffset(batch.nextOffset);
    } catch {
      // Stop the observer and show the button. Retrying automatically against
      // a failing network would spend the shopper's data on nothing.
      setFailed(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [handle, filters, offset]);

  const onLoadMore = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || offset === null || failed) return;

    // Ahead of the fold, so the next batch is usually there before the
    // shopper reaches the bottom rather than after they've waited at it.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load();
      },
      { rootMargin: "600px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [load, offset, failed]);

  return (
    <>
      <div
        className={cn(
          layout === "grid"
            ? "grid grid-cols-2 gap-3 sm:gap-4"
            : "flex flex-col gap-3",
        )}
      >
        {children}
        {batches}
      </div>

      {/*
        Always a real button, not only a fallback. Scrolling alone strands
        anyone whose request failed, and gives no way back if the observer
        never fires — on an older browser, or with JavaScript still loading.
      */}
      {offset !== null ? (
        <div ref={sentinel} className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={pending}
            className="surface-card min-h-11 rounded-xl px-5 text-sm font-medium transition hover:opacity-70 disabled:opacity-50"
          >
            {pending ? labels.loading : labels.loadMore}
          </button>
        </div>
      ) : null}
    </>
  );
}
