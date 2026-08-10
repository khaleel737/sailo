"use client";

import { useState } from "react";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import {
  ExpressCheckout,
  type CheckoutCompliance,
  type CheckoutDelivery,
  type CheckoutMethod,
  type CheckoutService,
} from "@/app/[handle]/_components/cart/express-checkout";
import { useCart } from "@/app/[handle]/_components/cart/cart-provider";
import { FavoriteButton } from "@/app/[handle]/_components/favorites/favorite-button";
import { isSoldOut } from "@/app/[handle]/_lib/availability";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { formatMoney } from "@/lib/utils";
import {
  findVariant,
  isLowStock,
  MAX_QUANTITY,
  variantLabel,
  type CheckoutVariant,
} from "@/lib/variants";
import type { ProductOption, VariantOptions } from "@/db/schema";

/**
 * The buying half of the product page: price, choices, quantity, and the two
 * ways out — into the basket, or straight through checkout.
 *
 * This is where the choosing happens now. The card sends every buyer here,
 * the price on screen is always the price of the exact combination picked,
 * and "Buy now" carries that combination into checkout without asking again.
 * The old page showed options as a read-only list and made the buyer pick
 * them inside a sheet that covered the photos they were picking from.
 */
export function BuyBox({
  shopId,
  shopName,
  productId,
  slug,
  productTitle,
  priceCents,
  compareAtCents,
  currency,
  inStock,
  salesOpen,
  methods,
  deliveryOptions,
  kind,
  options,
  variants,
  unitsLeft,
  service = null,
  serviceLocation = null,
  imageUrl = null,
  hasFiles = false,
  heldUntilPaid = false,
  contactEmail,
  compliance,
  t,
}: {
  shopId: string;
  shopName: string;
  productId: string;
  slug: string;
  productTitle: string;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
  inStock: boolean;
  /** False once an event's start time has passed. */
  salesOpen: boolean;
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  kind: string;
  options: ProductOption[];
  variants: CheckoutVariant[];
  /** Units left on the product itself, when it has no options. */
  unitsLeft: number | null;
  service?: CheckoutService | null;
  serviceLocation?: string | null;
  imageUrl?: string | null;
  hasFiles?: boolean;
  heldUntilPaid?: boolean;
  contactEmail: string | null;
  compliance: CheckoutCompliance;
  t: Dictionary;
}) {
  const cart = useCart();
  const locale = cart?.locale;

  // Open on something the buyer can actually have.
  const [selection, setSelection] = useState<VariantOptions>(
    () => (variants.find((v) => v.available) ?? variants[0])?.options ?? {},
  );
  const variant = variants.length
    ? (findVariant(variants, selection) ?? null)
    : null;

  const unitPriceCents = variant?.priceCents ?? priceCents;
  const wasPriced = variant ? variant.compareAtCents : compareAtCents;
  const stockLeft = variant ? variant.unitsLeft : unitsLeft;
  const maxQuantity =
    stockLeft === null ? MAX_QUANTITY : Math.max(1, stockLeft);

  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const [buying, setBuying] = useState(false);

  const soldOut = isSoldOut({ inStock, variants, unitsLeft });
  const noRails = methods.length === 0;
  const disabled = soldOut || !salesOpen || noRails;

  /**
   * Picking a value keeps the rest of the selection when that combination
   * exists, and otherwise jumps to the nearest one that's actually for sale —
   * so a buyer who picks "red" on a sold-out large lands on a red that exists.
   */
  function chooseOption(name: string, value: string) {
    const next = { ...selection, [name]: value };
    const exact = findVariant(variants, next);
    const target =
      exact && exact.available
        ? exact
        : (variants.find((v) => v.available && v.options[name] === value) ??
          exact ??
          null);

    if (!target) return;
    setSelection(target.options);
    const left = target.unitsLeft;
    if (left !== null) setQuantity((q) => Math.min(q, Math.max(1, left)));
  }

  function addToBasket() {
    if (!cart) return;
    cart.add({
      productId,
      variantId: variant?.id ?? null,
      quantity,
      title: productTitle,
      label: variant ? variantLabel(variant.options, options) : "",
      kind,
      unitPriceCents,
      imageUrl: variant?.imageUrl ?? imageUrl ?? null,
    });
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1600);
  }

  const primaryLabel = noRails
    ? t.shop.unavailable
    : soldOut
      ? t.shop.soldOut
      : !salesOpen
        ? t.shop.salesClosed
        : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {unitPriceCents > 0
            ? formatMoney(unitPriceCents, currency, locale)
            : t.common.free}
        </span>
        {wasPriced !== null && wasPriced > unitPriceCents ? (
          <span className="text-muted text-sm line-through tabular-nums">
            {formatMoney(wasPriced, currency, locale)}
          </span>
        ) : null}
      </div>

      {options.map((option) => (
        <fieldset key={option.name}>
          <legend className="mb-1.5 text-sm font-medium">
            {interpolate(t.checkout.choose, { option: option.name })}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {option.values.map((value) => {
              const active = selection[option.name] === value;
              // Grey out a value only when nothing sellable carries it
              // alongside what's already picked.
              const reachable = variants.some(
                (v) =>
                  v.available &&
                  v.options[option.name] === value &&
                  options.every(
                    (o) =>
                      o.name === option.name ||
                      v.options[o.name] === selection[o.name],
                  ),
              );
              const anywhere = variants.some(
                (v) => v.available && v.options[option.name] === value,
              );

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => chooseOption(option.name, value)}
                  disabled={!anywhere}
                  title={anywhere ? undefined : t.shop.soldOut}
                  aria-pressed={active}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                    active ? "accent-bg" : "surface-elevated hover:opacity-70"
                  } ${
                    !anywhere
                      ? "cursor-not-allowed line-through opacity-40"
                      : !reachable
                        ? "opacity-60"
                        : ""
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {salesOpen && isLowStock(stockLeft) ? (
        <p className="text-sm font-medium text-amber-600">
          {interpolate(t.checkout.onlyLeft, { count: stockLeft })}
        </p>
      ) : null}

      {!disabled ? (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t.checkout.quantity}</span>
          <div className="surface-elevated flex items-center rounded-lg">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label={t.checkout.decrease}
              className="flex size-9 items-center justify-center transition hover:opacity-60"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums">
              {quantity}
            </span>
            <button
              type="button"
              disabled={quantity >= maxQuantity}
              onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              aria-label={t.checkout.increase}
              className="flex size-9 items-center justify-center transition hover:opacity-60 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex gap-2">
          {cart ? (
            <button
              type="button"
              disabled={disabled}
              onClick={addToBasket}
              className="accent-bg flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {justAdded ? (
                <>
                  <Check className="size-4" />
                  {t.cart.added}
                </>
              ) : (
                <>
                  <ShoppingBag className="size-4" />
                  {primaryLabel ?? t.cart.add}
                </>
              )}
            </button>
          ) : null}

          <FavoriteButton
            shopId={shopId}
            item={{
              productId,
              slug,
              title: productTitle,
              imageUrl: imageUrl ?? null,
              priceCents: unitPriceCents,
            }}
            label={t.shop.saveToFavorites}
            look="flat"
            className="size-12 shrink-0"
          />
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={() => setBuying(true)}
          className={`h-12 w-full rounded-xl text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            cart
              ? "surface-elevated hover:opacity-70"
              : "accent-bg hover:opacity-90"
          }`}
        >
          {cart
            ? t.cart.buyNow
            : (primaryLabel ?? t.shop.orderNow)}
        </button>
      </div>

      {buying ? (
        <ExpressCheckout
          shopId={shopId}
          shopName={shopName}
          productId={productId}
          productTitle={productTitle}
          currency={currency}
          variant={variant}
          options={options}
          quantity={quantity}
          unitPriceCents={unitPriceCents}
          methods={methods}
          deliveryOptions={deliveryOptions}
          kind={kind}
          service={service}
          serviceLocation={serviceLocation}
          imageUrl={imageUrl}
          hasFiles={hasFiles}
          heldUntilPaid={heldUntilPaid}
          contactEmail={contactEmail}
          compliance={compliance}
          t={t}
          onClose={() => setBuying(false)}
        />
      ) : null}
    </div>
  );
}
