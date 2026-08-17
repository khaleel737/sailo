"use client";

import { useEffect, useState } from "react";
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
import { OptionChips } from "@/app/[handle]/_components/option-chips";
import { useVariantPhoto } from "./variant-photo";
import { isSoldOut } from "@/app/[handle]/_lib/availability";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import { formatMoney } from "@sailo/core/currency";
import {
  findVariant,
  isLowStock,
  MAX_QUANTITY,
  retargetSelection,
  variantLabel,
  type CheckoutVariant,
} from "@sailo/core/variants";
import { railsForOrder } from "@/lib/payments";
import type { ProductOption, VariantOptions } from "@sailo/db/schema";

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
  billingInterval,
  canPayInPerson,
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
  /** `month` or `year` for a membership; null for everything else. */
  billingInterval?: string | null;
  /**
   * Whether a pay-in-person rail belongs on this product, decided on the
   * server by `cartCanPayInPerson` so the button, the sheet and the order all
   * answer from the same place.
   */
  canPayInPerson: boolean;
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

  /*
   * Tell the gallery which photo the buyer is looking at, so choosing
   * "Charcoal" shows the charcoal one. In an effect because the gallery is a
   * sibling component: this is a render of one telling another to update, and
   * doing it during render is the one thing React genuinely forbids.
   */
  const photo = useVariantPhoto();
  const showPhoto = photo?.show;
  const chosenPhoto = variant?.imageUrl ?? null;
  useEffect(() => {
    showPhoto?.(chosenPhoto);
  }, [showPhoto, chosenPhoto]);

  const soldOut = isSoldOut({ inStock, variants, unitsLeft });
  /*
   * The rails this product can be bought on, which is not always every rail
   * the shop runs: cash on delivery promises a moment where the money changes
   * hands, and a download and a video call have none. A shop whose only rail
   * is that one genuinely cannot sell either, and saying so on the button
   * beats opening a sheet with nothing in it.
   */
  const rails = railsForOrder(methods, canPayInPerson);
  const noRails = rails.length === 0;
  const disabled = soldOut || !salesOpen || noRails;

  function chooseOption(name: string, value: string) {
    const target = retargetSelection(variants, selection, name, value);
    if (!target) return;
    setSelection(target.options);
    // The new combination may hold fewer units than the old quantity.
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

  /*
   * A membership never joins a basket.
   *
   * The checkout it needs is a different Stripe mode, and one session cannot
   * be both — so "Add to basket" beside it would build a cart that has no way
   * to be paid for, and the buyer would only find out at the end. The button
   * says what it does instead, and goes straight to the subscribe flow.
   */
  const isMembership = kind === "membership";

  const primaryLabel = noRails
    ? t.shop.unavailable
    : soldOut
      ? t.shop.soldOut
      : !salesOpen
        ? t.shop.salesClosed
        : isMembership
          ? t.shop.subscribeNow
          : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {unitPriceCents > 0
            ? formatMoney(unitPriceCents, currency, locale)
            : t.common.free}
        </span>
        {/* The interval belongs beside the number, not in a line underneath:
            a price with no cadence is the single most misread thing on a
            membership page. */}
        {isMembership ? (
          <span className="text-muted text-sm">
            {billingInterval === "year" ? t.shop.perYear : t.shop.perMonth}
          </span>
        ) : null}
        {wasPriced !== null && wasPriced > unitPriceCents ? (
          <span className="text-muted text-sm line-through tabular-nums">
            {formatMoney(wasPriced, currency, locale)}
          </span>
        ) : null}
      </div>

      <OptionChips
        options={options}
        variants={variants}
        selection={selection}
        onChoose={chooseOption}
        t={t}
      />

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
              /* 36px, and this is the control a buyer uses to say how many
                 they want — sitting immediately beside its opposite. A miss
                 here is not a dead tap, it is one fewer or one more of
                 something they are about to pay for. */
              className="flex size-9 items-center justify-center transition pointer-coarse:size-11 hover:opacity-60"
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
              className="flex size-9 items-center justify-center transition pointer-coarse:size-11 hover:opacity-60 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex gap-2">
          {cart && !isMembership ? (
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
          {cart && !isMembership
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
          canPayInPerson={canPayInPerson}
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
