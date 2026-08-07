"use client";

import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { CheckoutPanel, type CheckoutDelivery, type CheckoutMethod } from "./checkout-panel";
import { useCart } from "./cart-provider";
import { SlotPicker } from "./slot-picker";
import { lineKey, toOrderItems, type CartLine } from "@/lib/cart";
import { isLowStock } from "@/lib/variants";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { formatMoney } from "@/lib/utils";
import type { PreviewLine } from "@/lib/orders/types";

/**
 * The basket, and checkout for all of it at once.
 *
 * Lines are drawn from the server's own pricing rather than the cached copy in
 * localStorage, so a price change or a sell-out between adding and paying is
 * visible before the buyer commits rather than after.
 */
export function CartSheet({
  shopId,
  shopName,
  currency,
  methods,
  deliveryOptions,
  contactEmail,
  t,
}: {
  shopId: string;
  shopName: string;
  currency: string;
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  contactEmail: string | null;
  t: Dictionary;
}) {
  const cart = useCart();
  if (!cart?.open) return null;

  const items = toOrderItems(cart.lines);

  return (
    <CheckoutPanel
      shopId={shopId}
      shopName={shopName}
      currency={currency}
      items={items}
      methods={methods}
      deliveryOptions={deliveryOptions}
      contactEmail={contactEmail}
      title={t.cart.title}
      t={t}
      onClose={() => cart.setOpen(false)}
      onPlaced={cart.clear}
      empty={
        <div className="py-8 text-center">
          <ShoppingBag className="text-muted mx-auto size-8 opacity-40" />
          <p className="mt-3 font-semibold">{t.cart.empty}</p>
          <p className="text-muted mt-1 text-sm">{t.cart.emptyBody}</p>
          <button
            type="button"
            onClick={() => cart.setOpen(false)}
            className="surface-elevated mt-5 h-11 w-full rounded-xl text-sm font-medium"
          >
            {t.cart.keepShopping}
          </button>
        </div>
      }
    >
      {(preview) => (
        <div className="space-y-3">
          {/* The header already says "Your basket"; this says how full it is. */}
          <p className="text-muted text-sm">
            {interpolate(t.cart.itemCount, { count: cart.count })}
          </p>

          {preview?.unavailable.length ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t.cart.someGone}
            </p>
          ) : null}

          <ul className="surface-border divide-y divide-black/5 border-y">
            {cart.lines.map((line) => (
              <CartRow
                key={lineKey(line)}
                line={line}
                priced={preview?.lines.find(
                  (l) =>
                    l.productId === line.productId &&
                    (l.variantId ?? null) === (line.variantId ?? null),
                )}
                // A line is only missing once the server has answered; before
                // that it's just not priced yet.
                loaded={Boolean(preview)}
                currency={currency}
                t={t}
                onQuantity={(quantity) => cart.setQty(lineKey(line), quantity)}
                onRemove={() => cart.remove(lineKey(line))}
                cartLocale={cart.locale}
                // The picker returns an ISO instant, so nothing is reinterpreted
                // in the browser's own zone on the way through.
                onSchedule={(value) => cart.schedule(lineKey(line), value)}
              />
            ))}
          </ul>
        </div>
      )}
    </CheckoutPanel>
  );
}

function CartRow({
  line,
  priced,
  loaded,
  currency,
  t,
  onQuantity,
  onRemove,
  onSchedule,
  cartLocale,
}: {
  line: CartLine;
  /** The server's version of this line, once it has answered. */
  priced?: PreviewLine;
  loaded: boolean;
  currency: string;
  t: Dictionary;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  onSchedule: (value: string) => void;
  cartLocale: string;
}) {
  const gone = loaded && !priced;
  const unitPriceCents = priced?.unitPriceCents ?? line.unitPriceCents;
  const label = priced?.label || line.label;
  const left = priced?.unitsLeft ?? null;
  const max = left === null ? 999 : Math.max(1, left);

  return (
    <li className="flex gap-3 py-3">
      {line.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={line.imageUrl}
          alt=""
          className="size-12 shrink-0 rounded-lg object-cover"
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate text-sm font-medium">
          {priced?.title ?? line.title}
          {label ? <span className="text-muted"> — {label}</span> : null}
        </p>
        <p className="text-muted text-xs tabular-nums">
          {formatMoney(unitPriceCents, currency)}
          {line.quantity > 1
            ? ` × ${line.quantity} = ${formatMoney(
                unitPriceCents * line.quantity,
                currency,
              )}`
            : ""}
        </p>

        {isLowStock(left) ? (
          <p className="mt-0.5 text-xs font-medium text-amber-600">
            {interpolate(t.checkout.onlyLeft, { count: left })}
          </p>
        ) : null}

        {/*
          A service in the basket still needs a time against it, and it is
          picked from what the shop has free rather than typed.

          This was a second `datetime-local`, which meant the picker on the
          product could be bypassed entirely by editing the time here. The
          server refuses a slot it is not offering, so that was never a way to
          book something impossible — but it was a way to be told no after
          filling in the whole checkout, which is worse than not offering it.
        */}
        {(priced?.kind ?? line.kind) === "service" && line.productId ? (
          <div className="mt-1.5">
            <SlotPicker
              productId={line.productId}
              value={line.scheduledFor ?? ""}
              onChange={onSchedule}
              locale={cartLocale}
              copy={{
                label: t.checkout.preferredTime,
                hint: "",
                loading: t.checkout.slotsLoading,
                noneToday: t.checkout.slotsNoneToday,
                noneAtAll: t.checkout.slotsNoneAtAll,
                failed: t.checkout.slotsFailed,
                clear: t.common.cancel,
              }}
            />
          </div>
        ) : null}

        <div className="mt-1.5 flex items-center gap-2">
          <div className="surface-elevated flex items-center rounded-lg">
            <button
              type="button"
              onClick={() => onQuantity(line.quantity - 1)}
              aria-label={t.checkout.decrease}
              className="flex size-7 items-center justify-center transition hover:opacity-60"
            >
              <Minus className="size-3" />
            </button>
            <span className="w-6 text-center text-xs font-semibold tabular-nums">
              {line.quantity}
            </span>
            <button
              type="button"
              disabled={line.quantity >= max}
              onClick={() => onQuantity(line.quantity + 1)}
              aria-label={t.checkout.increase}
              className="flex size-7 items-center justify-center transition hover:opacity-60 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Plus className="size-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={onRemove}
            aria-label={`${t.cart.remove} — ${line.title}`}
            className="text-muted flex size-7 items-center justify-center rounded-lg transition hover:text-red-600"
          >
            <Trash2 className="size-3.5" />
          </button>

          {gone ? (
            <span className="text-xs font-medium text-amber-600">
              {t.shop.unavailable}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
