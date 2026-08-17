"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, RotateCcw, Truck } from "lucide-react";
import { markOrderShipped, refundOrder } from "@/lib/actions/order-admin";
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
  const [panel, setPanel] = useState<"ship" | "refund" | null>(null);
  const [shipState, shipAction] = useActionState(markOrderShipped, {
    ok: false,
  });
  const [refundState, refundAction] = useActionState(refundOrder, { ok: false });

  const isShipping = order.deliveryMethod === "shipping";
  const canRefund = order.refundedCents === 0 && order.status !== "cancelled";

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {isShipping ? (
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setPanel(panel === "ship" ? null : "ship")}
          >
            <Truck className="size-4" />
            {order.trackingNumber ? a.orders.editTracking : a.orders.addTracking}
          </Button>
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
      </div>

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
