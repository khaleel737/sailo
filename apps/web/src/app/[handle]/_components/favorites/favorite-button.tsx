"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FavoriteItem } from "@/lib/favorites";
import { useFavorites } from "./use-favorites";

/**
 * The heart on a product — card corner and product page alike.
 *
 * One label either way: the control is "save to favourites" and
 * `aria-pressed` carries whether it currently is, which is how a toggle
 * introduces itself to a screen reader without renaming itself mid-press.
 *
 * The filled heart is red on every shop rather than the seller's accent: a
 * seller whose accent *is* red would otherwise sell hearts that never visibly
 * fill, and the red heart is the one piece of e-commerce vocabulary every
 * buyer already reads on sight.
 */
export function FavoriteButton({
  shopId,
  item,
  label,
  look = "overlay",
  className,
}: {
  shopId: string;
  item: FavoriteItem;
  /** `t.shop.saveToFavorites`, passed as a string to keep the bundle lean. */
  label: string;
  /**
   * "overlay" floats on a photo, so it brings its own white ground;
   * "flat" sits on the page and wears the shop's surface like any control.
   */
  look?: "overlay" | "flat";
  className?: string;
}) {
  const { ready, has, toggle } = useFavorites(shopId);
  const saved = ready && has(item.productId);

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={saved}
      onClick={() => toggle(item)}
      className={cn(
        "flex items-center justify-center transition",
        look === "overlay"
          ? "rounded-full bg-white/90 text-black/70 shadow-sm ring-1 ring-black/10 hover:scale-105 active:scale-95 motion-reduce:transform-none"
          : "surface-elevated rounded-xl hover:opacity-70",
        className,
      )}
    >
      <Heart
        className={cn(
          "size-4 transition-colors",
          saved && "fill-red-500 text-red-500",
        )}
      />
    </button>
  );
}
