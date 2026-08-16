"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, X } from "lucide-react";
import type { Dictionary } from "@sailo/i18n";
import { formatMoney } from "@/lib/utils";
import { useFavorites } from "./use-favorites";

/**
 * The buyer's saved products: the heart beside the share button, and the
 * sheet it opens.
 *
 * It renders even when nothing is saved yet — a control that only exists
 * after you've used it can never be discovered — and the empty sheet says
 * where the hearts are. Each row is the road back to its product page; the
 * sheet is a shortlist, not a second basket, so there is nothing to buy here.
 */
export function FavoritesButton({
  shopId,
  handle,
  currency,
  locale,
  t,
}: {
  shopId: string;
  handle: string;
  currency: string;
  locale: string;
  t: Dictionary;
}) {
  const { items, ready, count, remove } = useFavorites(shopId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.shop.favorites}
        className="surface-card text-muted relative inline-flex size-10 items-center justify-center rounded-full pointer-coarse:size-11 transition hover:opacity-70"
      >
        <Heart className="size-4.5" aria-hidden />
        {ready && count > 0 ? (
          <span className="accent-bg absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={t.shop.favorites}
        >
          <button
            type="button"
            aria-label={t.common.close}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          <div className="surface-card animate-rise relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.common.close}
              className="text-muted absolute end-4 top-4 z-10 grid place-items-center transition pointer-coarse:-m-3 pointer-coarse:size-11 hover:opacity-70"
            >
              <X className="size-5" />
            </button>

            <div className="overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <h2 className="pe-8 text-base font-semibold">
                {t.shop.favorites}
              </h2>

              {items.length === 0 ? (
                <div className="py-8 text-center">
                  <Heart className="text-muted mx-auto size-8 opacity-40" />
                  <p className="mt-3 font-semibold">{t.shop.favoritesEmpty}</p>
                  <p className="text-muted mt-1 text-sm">
                    {t.shop.favoritesEmptyBody}
                  </p>
                </div>
              ) : (
                <ul className="surface-border mt-4 divide-y divide-black/5 border-y">
                  {items.map((item) => (
                    <li key={item.productId} className="flex items-center gap-3 py-3">
                      <Link
                        href={`/${handle}/p/${item.slug}`}
                        className="flex min-w-0 flex-1 items-center gap-3 transition hover:opacity-70"
                      >
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="size-12 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <span className="surface-elevated flex size-12 shrink-0 items-center justify-center rounded-lg">
                            <Heart className="text-muted size-4 opacity-40" />
                          </span>
                        )}
                        <span className="min-w-0">
                          <span
                            dir="auto"
                            className="block truncate text-sm font-medium"
                          >
                            {item.title}
                          </span>
                          <span className="text-muted block text-xs tabular-nums">
                            {item.priceCents > 0
                              ? formatMoney(item.priceCents, currency, locale)
                              : t.common.free}
                          </span>
                        </span>
                      </Link>

                      <button
                        type="button"
                        onClick={() => remove(item.productId)}
                        aria-label={`${t.cart.remove} — ${item.title}`}
                        className="text-muted flex size-8 shrink-0 items-center justify-center rounded-lg transition hover:text-red-600"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
