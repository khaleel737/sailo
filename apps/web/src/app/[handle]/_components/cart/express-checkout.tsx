"use client";

import { useState } from "react";
import type { CheckoutField } from "@/app/[handle]/_components/cart/custom-fields";
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
  tierId = null,
  tierName = null,
  sessionId = null,
  quantity,
  unitPriceCents,
  pwywCents,
  methods,
  deliveryOptions,
  blockedCountries,
  kind,
  canPayInPerson,
  service = null,
  serviceLocation = null,
  imageUrl = null,
  hasFiles = false,
  heldUntilPaid = false,
  contactEmail,
  compliance,
  customFields,
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
  /**
   * The band and the date picked on the page — spec 50.
   *
   * Ids, and a name only so the sheet can say which ticket is being bought:
   * the price comes back out of `event_tiers` in `resolveLines`, exactly as
   * the product's does. Null for everything that is not an event with bands,
   * which is every product today.
   *
   * They travel here for the same reason `variant` does. "Buy now" skips the
   * basket, so a choice that stops at the product page is a choice the express
   * path never makes — and this one decides what the buyer is charged.
   */
  tierId?: string | null;
  tierName?: string | null;
  sessionId?: string | null;
  quantity: number;
  unitPriceCents: number;
  /**
   * What the buyer named, on a pay-what-you-want product — spec 43.
   *
   * Undefined on every fixed-price product, and that is not the same as zero:
   * the server ignores this field outright unless the product's stored
   * `pricing_mode` says otherwise, so sending it where it does not belong buys
   * nothing and sending it where it does is the only way the amount can travel.
   */
  pwywCents?: number;
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  blockedCountries: string[];
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
  customFields: CheckoutField[];
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
  // The band's name where a variant's label would be: an event with bands has
  // no variant, and a sheet that named neither would ask a buyer to confirm
  // "Rooftop Show" at a price they cannot check against anything.
  const label = variant ? variantLabel(variant.options, options) : (tierName ?? "");

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
          // Which band and which date — spec 50. Ids only; `resolveLines`
          // reads the price, the seats and the name from the rows.
          tierId: tierId ?? undefined,
          sessionId: sessionId ?? undefined,
          quantity,
          // Sent as an absolute instant: the buyer picked a time in their own
          // timezone, and the server has no idea what that is.
          scheduledFor,
          // The one price the browser is allowed to name, clamped server-side.
          priceCents: pwywCents,
        },
      ]}
      methods={methods}
      deliveryOptions={deliveryOptions}
      blockedCountries={blockedCountries}
      // One product, so its kind settles the question outright — no quote
      // needed to know that a download is not delivered.
      needsDeliveryHint={needsDelivery(kind)}
      // Already decided on the server for this one product, so the sheet opens
      // showing the rails it will still be showing a moment later.
      payInPersonHint={canPayInPerson}
      contactEmail={contactEmail}
      compliance={compliance}
      customFields={customFields}
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
