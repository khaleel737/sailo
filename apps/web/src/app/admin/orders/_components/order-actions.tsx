"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, PackageCheck, RotateCcw, Truck } from "lucide-react";
import {
  markOrderDelivered,
  markOrderShipped,
  refundOrder,
} from "@/lib/actions/order-admin";
import { Alert, Button, Field, Input } from "@sailo/design-system/web";
import { centsToAmount, formatMoney } from "@sailo/core/currency";
import type { Order } from "@sailo/db/schema";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function OrderActions({ order }: { order: Order }) {
  const a = useAdminT();
  const locale = useAdminLocale();

  /*
   * The promoted form — spec 04's literal complaint. An unfulfilled parcel's
   * next step is recording the shipment, so the carrier/number/link fields
   * arrive already open as the card's primary act rather than waiting behind
   * a quiet toggle nobody found. Once it has shipped, the panel folds back
   * to a toggle for edits.
   */
  const promoteShip = Boolean(
    (order.deliveryMethod === "shipping" ||
      (order.deliveryMethod === null && order.productKind === "physical")) &&
      !order.shippedAt &&
      !order.trackingNumber,
  );
  const [panel, setPanel] = useState<"ship" | "refund" | null>(
    promoteShip ? "ship" : null,
  );
  const [shipState, shipAction] = useActionState(markOrderShipped, {
    ok: false,
  });
  const [refundState, refundAction] = useActionState(refundOrder, { ok: false });
  const [deliveredState, deliveredAction] = useActionState(markOrderDelivered, {
    ok: false,
  });

  /*
   * A parcel is a parcel even when no delivery method says so. Orders written
   * before delivery methods existed — and shops that never configured one —
   * carry `deliveryMethod = null` on physical goods, and the old strict
   * equality left those sellers with no way to record a shipment at all.
   * Explicit collection stays excluded: a pickup does not ship.
   */
  const isShipping =
    order.deliveryMethod === "shipping" ||
    (order.deliveryMethod === null && order.productKind === "physical");
  const canRefund = order.refundedCents === 0 && order.status !== "cancelled";

  /*
   * Offered once it has been sent and not yet confirmed. Spec 44: on
   * `product_not_received` the whole case turns on arrival, and this is the
   * cheapest way for the slot to stop being empty. Optimistic against the
   * server's own claim — `confirmDelivery` puts the ceiling in the WHERE, so a
   * double click cannot move the date.
   */
  const canConfirmArrival = Boolean(order.shippedAt) && !order.deliveredAt;

  /** Who said it arrived. The three are not equally persuasive and it shows. */
  const deliveredBy =
    order.deliveredSource === "buyer_confirmed"
      ? a.orders.deliveredByBuyer
      : order.deliveredSource === "carrier"
        ? a.orders.deliveredByCarrier
        : a.orders.deliveredBySeller;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {isShipping ? (
          <Button
            variant={promoteShip ? "primary" : "secondary"}
            size="sm"
            type="button"
            aria-expanded={panel === "ship"}
            onClick={() => setPanel(panel === "ship" ? null : "ship")}
          >
            <Truck className="size-4" />
            {order.trackingNumber ? a.orders.editTracking : a.orders.addTracking}
          </Button>
        ) : null}

        {canConfirmArrival ? (
          <form action={deliveredAction} className="contents">
            <input type="hidden" name="id" value={order.id} />
            <Button variant="secondary" size="sm" type="submit">
              <PackageCheck className="size-4" />
              {a.orders.markDelivered}
            </Button>
          </form>
        ) : null}

        {order.deliveredAt ? (
          <span className="text-ink-500 inline-flex items-center gap-1.5 text-xs">
            <Check className="size-3.5" />
            {deliveredBy}
          </span>
        ) : null}

        {canRefund ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setPanel(panel === "refund" ? null : "refund")}
            className="text-ink-500"
          >
            <RotateCcw className="size-4" />
          {a.orders.refund}
          </Button>
        ) : null}

        {/* The evidence pack moved to the header's ⋯ menu — an act about
            the record, not a fulfilment step. */}
      </div>

      {deliveredState.error ? (
        <Alert className="mt-2">{deliveredState.error}</Alert>
      ) : null}

      {/*
        The nudge, not a silent hole. A shipped order nobody has confirmed is a
        gap somebody can still close, and it closes only while the seller
        remembers — four months later, when the chargeback lands, nobody does.
      */}
      {canConfirmArrival ? (
        <p className="text-ink-500 mt-2 text-xs leading-relaxed">
          {a.orders.confirmArrival}
        </p>
      ) : null}

      {panel === "ship" ? (
        <form
          action={shipAction}
          className="mt-2 space-y-3 rounded-xl border border-ink-200 bg-ink-50 p-3"
        >
          <input type="hidden" name="id" value={order.id} />
          {shipState.error ? <Alert>{shipState.error}</Alert> : null}
          {shipState.ok && shipState.message ? (
            <Alert tone="success">{shipState.message}</Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={a.orders.carrier} htmlFor={`${order.id}-carrier`}>
              <Input
                id={`${order.id}-carrier`}
                name="trackingCarrier"
                defaultValue={order.trackingCarrier ?? ""}
                placeholder="DHL"
              />
            </Field>
            <Field label={a.orders.trackingNumber} htmlFor={`${order.id}-number`}>
              <Input
                id={`${order.id}-number`}
                name="trackingNumber"
                defaultValue={order.trackingNumber ?? ""}
                placeholder={a.orders.trackingNumberPlaceholder}
              />
            </Field>
          </div>

          <Field
            label={a.orders.trackingLink}
            htmlFor={`${order.id}-url`}
            hint={a.common.optional}
          >
            <Input
              id={`${order.id}-url`}
              name="trackingUrl"
              defaultValue={order.trackingUrl ?? ""}
              placeholder={a.orders.trackingLinkPlaceholder}
            />
          </Field>

          <p className="text-xs text-ink-500">
            {order.customerEmail
              ? `Saving emails ${order.customerEmail} with the details.`
              : "No email on file, so nothing will be sent."}
          </p>

          <Submit label={a.orders.markShipped} />
        </form>
      ) : null}

      {panel === "refund" ? (
        <form
          action={refundAction}
          className="mt-2 space-y-3 rounded-xl border border-red-200 bg-red-50 p-3"
        >
          <input type="hidden" name="id" value={order.id} />
          {refundState.error ? <Alert>{refundState.error}</Alert> : null}
          {refundState.ok && refundState.message ? (
            <Alert tone="success">{refundState.message}</Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={`Amount (${order.currency})`}
              htmlFor={`${order.id}-amount`}
              hint={a.orders.refundAmountHint}
            >
              <Input
                id={`${order.id}-amount`}
                name="amount"
                inputMode="decimal"
                placeholder={centsToAmount(order.totalCents, order.currency)}
              />
            </Field>
            <Field label={a.orders.refundReason} htmlFor={`${order.id}-reason`} hint={a.common.optional}>
              <Input
                id={`${order.id}-reason`}
                name="reason"
                placeholder={a.orders.refundReasonPlaceholder}
              />
            </Field>
          </div>

          {/*
            Does it go back on the shelf — spec 51.

            Ticked, because that is what every refund did before this column
            existed and it is what a return usually means. Unticking is the
            seller saying the item is damaged, lost or thrown away, and it is an
            answer only they have — `refundReason` is free text and nothing can
            read a decision out of it. Asked here because this is the moment
            they know.

            Only shown on a refund that would actually restock. A partial refund
            is a price adjustment rather than a return and never restocks, so
            offering the choice there would be a control with no effect.
          */}
          {order.status !== "refunded" ? (
            <label className="flex items-start gap-2 text-xs text-red-800">
              <input
                type="checkbox"
                name="restock"
                defaultChecked
                className="mt-0.5 size-4 shrink-0 rounded border-red-300"
              />
              <span>
                {a.products.restockOnRefund}
                <span className="block text-red-700/80">
                  {a.products.restockOnRefundHint}
                </span>
              </span>
            </label>
          ) : null}

          <p className="text-xs text-red-700">
            Comes straight off your revenue. Max{" "}
            {formatMoney(order.totalCents, order.currency, locale)}.
            {order.customerEmail ? " The buyer is emailed." : ""}
          </p>

          <Submit label={a.orders.recordRefund} />
        </form>
      ) : null}
    </div>
  );
}
