"use client";

import { useEffect, useState } from "react";
import { Check, ShoppingBag, X } from "lucide-react";
import { useCart } from "./cart-provider";
import { OptionChips } from "../option-chips";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import { cn, formatMoney } from "@/lib/utils";
import {
  findVariant,
  isLowStock,
  retargetSelection,
  variantLabel,
  type CheckoutVariant,
} from "@sailo/core/variants";
import type { ProductOption, VariantOptions } from "@sailo/db/schema";

/**
 * The bag on a product card.
 *
 * A product sold as one thing goes straight into the basket — no sheet, no
 * navigation, a tick on the button and a heavier pill at the bottom of the
 * page. A product with options opens a small picker asking only for the
 * choice, because the old bag's answer — silently adding whichever
 * combination came first — put things in baskets nobody had picked.
 *
 * "Buy now" is deliberately not here. Checkout is a commitment to a specific
 * thing, and the card hasn't shown enough to commit to; the product page has.
 */
export function QuickAdd({
  productId,
  productTitle,
  priceCents,
  currency,
  kind,
  options,
  variants,
  unitsLeft,
  imageUrl,
  className,
  t,
}: {
  productId: string;
  productTitle: string;
  priceCents: number;
  currency: string;
  kind: string;
  options: ProductOption[];
  variants: CheckoutVariant[];
  /** Units left on the product itself, when it has no options. */
  unitsLeft: number | null;
  imageUrl: string | null;
  className?: string;
  t: Dictionary;
}) {
  const cart = useCart();

  const [open, setOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  // Open on something the buyer can actually have.
  const [selection, setSelection] = useState<VariantOptions>(
    () => (variants.find((v) => v.available) ?? variants[0])?.options ?? {},
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // The bag needs a basket to put things in.
  if (!cart) return null;

  const variant = variants.length
    ? (findVariant(variants, selection) ?? null)
    : null;
  const unitPriceCents = variant?.priceCents ?? priceCents;
  const stockLeft = variant ? variant.unitsLeft : unitsLeft;

  function add() {
    if (!cart) return;
    cart.add({
      productId,
      variantId: variant?.id ?? null,
      quantity: 1,
      title: productTitle,
      label: variant ? variantLabel(variant.options, options) : "",
      kind,
      unitPriceCents,
      imageUrl: variant?.imageUrl ?? imageUrl ?? null,
    });
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1600);
  }

  function choose(name: string, value: string) {
    const target = retargetSelection(variants, selection, name, value);
    if (target) setSelection(target.options);
  }

  return (
    <>
      <button
        type="button"
        aria-label={`${t.cart.add} — ${productTitle}`}
        onClick={() => (options.length > 0 ? setOpen(true) : add())}
        className={cn(
          "flex items-center justify-center rounded-full transition",
          justAdded
            ? "accent-bg"
            : "bg-white/90 text-black/70 shadow-sm ring-1 ring-black/10",
          "hover:scale-105 active:scale-95 motion-reduce:transform-none",
          className,
        )}
      >
        {justAdded ? (
          <Check className="size-4" />
        ) : (
          <ShoppingBag className="size-4" />
        )}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`${t.cart.add} — ${productTitle}`}
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

            <div className="space-y-4 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <div className="flex items-start gap-3 pe-8">
                {(variant?.imageUrl ?? imageUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={variant?.imageUrl ?? imageUrl ?? undefined}
                    alt=""
                    className="size-12 shrink-0 rounded-xl object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <h2 dir="auto" className="truncate font-semibold leading-tight">
                    {productTitle}
                  </h2>
                  <p className="text-muted mt-0.5 text-sm tabular-nums">
                    {unitPriceCents > 0
                      ? formatMoney(unitPriceCents, currency, cart.locale)
                      : t.common.free}
                  </p>
                </div>
              </div>

              <OptionChips
                options={options}
                variants={variants}
                selection={selection}
                onChoose={choose}
                t={t}
              />

              {isLowStock(stockLeft) ? (
                <p className="text-sm font-medium text-amber-600">
                  {interpolate(t.checkout.onlyLeft, { count: stockLeft })}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  add();
                  setOpen(false);
                }}
                className="accent-bg flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90"
              >
                <ShoppingBag className="size-4" />
                {t.cart.add}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
