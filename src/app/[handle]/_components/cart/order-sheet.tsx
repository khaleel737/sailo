"use client";

import { useState } from "react";
import { CalendarClock, Check, MapPin, Minus, Plus, ShoppingBag, Video } from "lucide-react";
import { CheckoutPanel, type CheckoutDelivery, type CheckoutMethod } from "./checkout-panel";
import { useCart } from "./cart-provider";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { formatDuration, formatMoney } from "@/lib/utils";
import { findVariant, isLowStock, MAX_QUANTITY, variantLabel, type CheckoutVariant } from "@/lib/variants";
import type { ProductOption, VariantOptions } from "@/db/schema";
import { isSoldOut } from "../../_lib/availability";
import { toLocalInput } from "../../_lib/local-time";


export type { CheckoutDelivery, CheckoutMethod } from "./checkout-panel";

/** What a service asks of the buyer, when it asks anything. */
export type CheckoutService = {
  bookingEnabled: boolean;
  bookingLeadHours: number;
  durationMinutes: number | null;
  mode: string;
};

/** Where the service happens, shown before the buyer commits to a slot. */
export type ServiceLocation = string | null;

export type ProductSheetProps = {
  shopId: string;
  shopName: string;
  productId: string;
  productTitle: string;
  priceCents: number;
  currency: string;
  inStock: boolean;
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  /** physical | digital | service — only physical goods get delivered. */
  kind: string;
  /** The choices the buyer makes, and what each combination costs. */
  options?: ProductOption[];
  variants?: CheckoutVariant[];
  /** Units left on the product itself, when it has no options. */
  unitsLeft?: number | null;
  service?: CheckoutService | null;
  serviceLocation?: ServiceLocation;
  /** The product's cover, so a basket line has something to show. */
  imageUrl?: string | null;
  /** True for a digital product that actually has files attached. */
  hasFiles?: boolean;
  /** True when those files wait for the seller to confirm payment. */
  heldUntilPaid?: boolean;
  contactEmail: string | null;
  className?: string;
  label?: string;
  t: Dictionary;
};

/**
 * The two ways to buy one product.
 *
 * "Buy now" opens checkout with just this item, options and all. The bag
 * beside it adds without interrupting anything: no sheet, no navigation, just
 * a tick on the button and a heavier basket at the bottom of the page.
 */
export function OrderButton({
  className,
  label,
  showAddToCart = true,
  compact = false,
  ...props
}: ProductSheetProps & { showAddToCart?: boolean; compact?: boolean }) {
  const [mode, setMode] = useState<"buy" | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const cart = useCart();

  const soldOut = isSoldOut(props);
  const noRails = props.methods.length === 0;
  const disabled = soldOut || noRails;

  const buyLabel = soldOut
    ? props.t.shop.soldOut
    : noRails
      ? props.t.shop.unavailable
      : // "Buy now" only reads as a choice when there's an "add" beside it.
        (label ?? (cart ? props.t.cart.buyNow : props.t.shop.orderNow));

  /**
   * Adds, and says so. No sheet, no interruption — the buyer keeps browsing
   * and the pill at the bottom of the page carries the running total.
   *
   * A product with options goes in as its first available combination, the
   * same one the picker would have opened on.
   */
  function addToBasket() {
    if (!cart) return;
    const variants = props.variants ?? [];
    const variant = variants.find((v) => v.available) ?? variants[0] ?? null;

    cart.add({
      productId: props.productId,
      variantId: variant?.id ?? null,
      quantity: 1,
      title: props.productTitle,
      label: variant ? variantLabel(variant.options, props.options ?? []) : "",
      kind: props.kind,
      unitPriceCents: variant?.priceCents ?? props.priceCents,
      imageUrl: variant?.imageUrl ?? props.imageUrl ?? null,
    });

    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1600);
  }

  return (
    <>
      <div className={cart && showAddToCart ? "flex gap-2" : undefined}>
        {cart && showAddToCart ? (
          <button
            type="button"
            disabled={disabled}
            aria-label={props.t.cart.add}
            onClick={addToBasket}
            className={`flex shrink-0 items-center justify-center font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              justAdded
                ? "accent-bg"
                : "surface-elevated hover:opacity-70"
            } ${compact ? "h-9 rounded-lg px-2.5" : "h-11 rounded-xl px-3.5"}`}
          >
            {justAdded ? (
              <Check className={compact ? "size-3.5" : "size-4"} />
            ) : (
              <ShoppingBag className={compact ? "size-3.5" : "size-4"} />
            )}
          </button>
        ) : null}

        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode("buy")}
          className={`${
            className ??
            "accent-bg h-11 w-full rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          }${cart && showAddToCart ? " min-w-0 flex-1" : ""}`}
        >
          {buyLabel}
        </button>
      </div>

      {mode ? (
        <ProductSheet {...props} onClose={() => setMode(null)} />
      ) : null}
    </>
  );
}

/**
 * Everything one product needs answered — which combination, how many, and for
 * a service, when — sitting above the shared checkout panel.
 */
function ProductSheet({
  onClose,
  ...props
}: ProductSheetProps & { onClose: () => void }) {
  const {
    shopId,
    shopName,
    productId,
    productTitle,
    priceCents,
    currency,
    methods,
    deliveryOptions,
    kind,
    options = [],
    variants = [],
    unitsLeft = null,
    service = null,
    serviceLocation = null,
    hasFiles = false,
    heldUntilPaid = false,
    contactEmail,
    t,
  } = props;

  // Open on something the buyer can actually have.
  const [selection, setSelection] = useState<VariantOptions>(
    () => (variants.find((v) => v.available) ?? variants[0])?.options ?? {},
  );
  const variant = variants.length
    ? (findVariant(variants, selection) ?? null)
    : null;

  const unitPriceCents = variant?.priceCents ?? priceCents;
  const stockLeft = variant ? variant.unitsLeft : unitsLeft;
  const maxQuantity = stockLeft === null ? MAX_QUANTITY : Math.max(1, stockLeft);

  const [quantity, setQuantity] = useState(1);
  const [booking, setBooking] = useState("");
  // The clock is read once, when the sheet mounts. A lazy initialiser keeps
  // "now" out of the render path, where re-reading it would move the floor of
  // the picker underneath whatever the buyer had already chosen.
  const [earliestBooking] = useState(() =>
    toLocalInput(
      new Date(Date.now() + (service?.bookingLeadHours ?? 0) * 3_600_000),
    ),
  );

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

  const scheduledFor = booking ? new Date(booking).toISOString() : undefined;

  const chooser = (
    <>
      <div className="flex items-start gap-3 pe-8">
        {variant?.imageUrl ? (
          // The picked combination's own photo — the red one, not the
          // catalogue shot.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={variant.imageUrl}
            alt=""
            className="size-14 shrink-0 rounded-xl object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <h2 dir="auto" className="font-semibold leading-tight">
            {productTitle}
            {variant ? (
              <span className="text-muted font-normal">
                {" "}
                — {variantLabel(variant.options, options)}
              </span>
            ) : null}
          </h2>
          <p className="text-muted mt-0.5 text-sm">
            {interpolate(t.checkout.each, {
              price: formatMoney(unitPriceCents, currency),
            })}
            {service?.durationMinutes
              ? ` · ${interpolate(t.checkout.duration, {
                  duration: formatDuration(service.durationMinutes),
                })}`
              : ""}
            {kind === "service" && service
              ? ` · ${service.mode === "online" ? t.checkout.online : t.checkout.inPerson}`
              : ""}
          </p>
        </div>
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

      {isLowStock(stockLeft) ? (
        <p className="text-sm font-medium text-amber-600">
          {interpolate(t.checkout.onlyLeft, { count: stockLeft })}
        </p>
      ) : null}

      {/*
        A booking is answered by "when", not "how many" — so the slot comes
        first and the quantity stepper sits under it.
      */}
      {service?.bookingEnabled ? (
        <div className="surface-elevated rounded-xl p-3">
          <label
            htmlFor="scheduledFor"
            className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"
          >
            <CalendarClock className="size-4" />
            {t.checkout.preferredTime}
          </label>
          <input
            id="scheduledFor"
            type="datetime-local"
            value={booking}
            min={earliestBooking}
            onChange={(e) => setBooking(e.target.value)}
            className="surface-card h-11 w-full rounded-lg px-3 text-sm outline-none"
          />
          <p className="text-muted mt-1.5 text-xs leading-relaxed">
            {interpolate(t.checkout.bookingHint, { shop: shopName })}
          </p>
        </div>
      ) : null}

      {/* Where to turn up, or how the call is joined. */}
      {kind === "service" && serviceLocation ? (
        <p className="text-muted flex items-start gap-2 text-xs leading-relaxed">
          {service?.mode === "online" ? (
            <Video className="mt-0.5 size-3.5 shrink-0 opacity-70" />
          ) : (
            <MapPin className="mt-0.5 size-3.5 shrink-0 opacity-70" />
          )}
          {serviceLocation}
        </p>
      ) : null}

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
    </>
  );

  return (
    <CheckoutPanel
      shopId={shopId}
      shopName={shopName}
      currency={currency}
      items={[
        {
          productId,
          variantId: variant?.id,
          quantity,
          // Sent as an absolute instant: the buyer picked a time in their own
          // timezone, and the server has no idea what that is.
          scheduledFor,
        },
      ]}
      methods={methods}
      deliveryOptions={deliveryOptions}
      contactEmail={contactEmail}
      hasFiles={hasFiles}
      heldUntilPaid={heldUntilPaid}
      title={t.shop.order}
      ariaLabel={`${t.shop.order} — ${productTitle}`}
      t={t}
      onClose={onClose}
    >
      {() => chooser}
    </CheckoutPanel>
  );
}
