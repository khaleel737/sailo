"use client";

import { useState } from "react";
import { MapPin, Video } from "lucide-react";
import {
  CheckoutPanel,
  type CheckoutCompliance,
  type CheckoutDelivery,
  type CheckoutMethod,
} from "./checkout-panel";
import { useCart } from "./cart-provider";
import { SlotPicker } from "./slot-picker";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import { formatMoney } from "@sailo/core/currency";
import { formatDuration } from "@sailo/core/format";
import { needsDelivery, variantLabel, type CheckoutVariant } from "@sailo/core/variants";
import type { ProductOption } from "@sailo/db/schema";

export type {
  CheckoutCompliance,
  CheckoutDelivery,
  CheckoutMethod,
} from "./checkout-panel";

/** What a service asks of the buyer, when it asks anything. */
export type CheckoutService = {
  bookingEnabled: boolean;
  bookingLeadHours: number;
  durationMinutes: number | null;
  mode: string;
};

/**
 * "Buy now": checkout for exactly one product, skipping the basket.
 *
 * Everything a buyer chooses — combination, quantity — was chosen on the
 * product page before this opened, so the sheet doesn't ask again; it shows
 * what's being bought and gets on with how. The one question that still
 * belongs here is a service's time slot, because picking a time is part of
 * ordering, not part of browsing.
 */
export function ExpressCheckout({
  shopId,
  shopName,
  productId,
  productTitle,
  currency,
  /** The combination picked on the page, or null when there are none. */
  variant,
  options,
  quantity,
  unitPriceCents,
  methods,
  deliveryOptions,
  kind,
  canPayInPerson,
  service = null,
  serviceLocation = null,
  imageUrl = null,
  hasFiles = false,
  heldUntilPaid = false,
  contactEmail,
  compliance,
  t,
  onClose,
}: {
  shopId: string;
  shopName: string;
  productId: string;
  productTitle: string;
  currency: string;
  variant: CheckoutVariant | null;
  options: ProductOption[];
  quantity: number;
  unitPriceCents: number;
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  /** physical | digital | service | event — only physical goods get delivered. */
  kind: string;
  /** Whether this product has a moment where cash can change hands. */
  canPayInPerson: boolean;
  service?: CheckoutService | null;
  serviceLocation?: string | null;
  /** The product's cover, when the combination has no photo of its own. */
  imageUrl?: string | null;
  /** True for a digital product that actually has files attached. */
  hasFiles?: boolean;
  /** True when those files wait for the seller to confirm payment. */
  heldUntilPaid?: boolean;
  contactEmail: string | null;
  compliance: CheckoutCompliance;
  t: Dictionary;
  onClose: () => void;
}) {
  /*
   * The storefront's language, for formatting money and the slot picker's
   * dates the way this buyer reads them. Optional because `useCart` is;
   * undefined reaches `Intl` as "use the visitor's own locale".
   */
  const locale = useCart()?.locale;

  const [booking, setBooking] = useState("");
  const scheduledFor = booking ? new Date(booking).toISOString() : undefined;

  const cover = variant?.imageUrl ?? imageUrl;
  const label = variant ? variantLabel(variant.options, options) : "";

  const summary = (
    <>
      <div className="flex items-start gap-3 pe-8">
        {cover ? (
          // The picked combination's own photo — the red one, not the
          // catalogue shot.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            className="size-14 shrink-0 rounded-xl object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <h2 dir="auto" className="font-semibold leading-tight">
            {productTitle}
            {label ? (
              <span className="text-muted font-normal"> — {label}</span>
            ) : null}
          </h2>
          <p className="text-muted mt-0.5 text-sm tabular-nums">
            {/* "2 × €25.00" reads the same in every locale the shop ships in. */}
            {quantity > 1 ? `${quantity} × ` : ""}
            {interpolate(t.checkout.each, {
              price: formatMoney(unitPriceCents, currency, locale),
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

      {service?.bookingEnabled ? (
        <SlotPicker
          productId={productId}
          value={booking}
          onChange={setBooking}
          locale={locale}
          copy={{
            label: t.checkout.preferredTime,
            hint: interpolate(t.checkout.bookingHint, { shop: shopName }),
            loading: t.checkout.slotsLoading,
            noneToday: t.checkout.slotsNoneToday,
            noneAtAll: t.checkout.slotsNoneAtAll,
            failed: t.checkout.slotsFailed,
            clear: t.common.cancel,
          }}
        />
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
      // One product, so its kind settles the question outright — no quote
      // needed to know that a download is not delivered.
      needsDeliveryHint={needsDelivery(kind)}
      // Already decided on the server for this one product, so the sheet opens
      // showing the rails it will still be showing a moment later.
      payInPersonHint={canPayInPerson}
      contactEmail={contactEmail}
      compliance={compliance}
      hasFiles={hasFiles}
      heldUntilPaid={heldUntilPaid}
      title={t.shop.order}
      ariaLabel={`${t.shop.order} — ${productTitle}`}
      t={t}
      onClose={onClose}
    >
      {() => summary}
    </CheckoutPanel>
  );
}
