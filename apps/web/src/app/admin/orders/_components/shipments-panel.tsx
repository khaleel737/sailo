"use client";

import { startTransition, useActionState } from "react";
import { Box, Check, Loader2 } from "lucide-react";
import { recordOrderShipment } from "@/lib/actions/order-admin";
import { Alert, Button, Card, Field, Input } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import type { LineCoverage } from "@sailo/commerce/orders";

/**
 * A three-item order going out in two boxes — spec 51.
 *
 * Only rendered where it earns its place: an order with more than one thing
 * that travels, on a plan that bought multi-shipment. Everything else keeps the
 * three-field "mark as shipped" button, and that is deliberate — the one-box
 * case is most orders, and making every seller pick lines before they can type
 * a tracking number would tax the common case to serve the rare one.
 *
 * WHAT THE FORM POSTS, AND WHY IT IS SHAPED LIKE THIS
 *
 * One quantity field per line, named for the line — `shipQty:<id>` — rather
 * than parallel arrays. A seller who leaves one box empty posts nothing for
 * that line and shifts nothing; with parallel arrays the empty field would
 * silently move every later quantity onto the wrong item, which is the same
 * defect the variant editor's JSON-per-row shape exists to prevent.
 *
 * The quantities are pre-filled with what is left and capped by `max`, which is
 * the polite half. The server re-reads coverage as it stands and refuses an
 * over-ship, because this screen is a snapshot: two tabs open on one order both
 * render a remainder that was true when they loaded.
 */
export function ShipmentsPanel({
  orderId,
  coverage,
  shipments,
  complete,
}: {
  orderId: string;
  coverage: LineCoverage[];
  shipments: {
    id: string;
    carrier: string | null;
    trackingNumber: string | null;
    shippedAt: Date;
    deliveredAt: Date | null;
    items: { orderItemId: string; quantity: number }[];
  }[];
  complete: boolean;
}) {
  const a = useAdminT();
  const [state, action, pending] = useActionState(recordOrderShipment, {
    ok: false,
  });

  const outstanding = coverage.filter((line) => line.remaining > 0);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500"
        >
          <Box className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-900">
            {a.delivery.shipmentsTitle}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            {complete ? a.delivery.shipmentsAllSent : a.delivery.shipmentsBody}
          </p>
        </div>
      </div>

      {/* What has already gone. Ordered oldest first, so the list reads as the
          history it is rather than as a queue. */}
      {shipments.length > 0 ? (
        <ul className="space-y-2">
          {shipments.map((shipment, index) => (
            <li
              key={shipment.id}
              className="flex items-baseline justify-between gap-3 rounded-lg bg-ink-50 px-3 py-2 text-xs"
            >
              <span className="font-medium text-ink-900">
                {interpolate(a.delivery.boxNumber, { n: index + 1 })}
                {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}
              </span>
              <span className="text-ink-500 tabular-nums">
                {shipment.deliveredAt
                  ? a.delivery.boxDelivered
                  : a.delivery.inTransit}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      {outstanding.length === 0 ? (
        <p className="flex items-center gap-2 text-xs font-medium text-emerald-700">
          <Check className="size-4" />
          {a.delivery.nothingLeft}
        </p>
      ) : (
        <form
          /*
           * Dispatched by hand for the reason the product form's own note
           * gives: React resets an uncontrolled form once an action completes,
           * whether or not it succeeded — so a seller told "only 2 left to
           * ship" would watch their tracking number empty itself at the same
           * moment.
           */
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => action(data));
          }}
          className="space-y-4 border-t border-ink-100 pt-4"
        >
          <input type="hidden" name="id" value={orderId} />

          <div className="space-y-2">
            {outstanding.map((line) => (
              <div
                key={line.orderItemId}
                className="flex items-center justify-between gap-3"
              >
                <input type="hidden" name="shipItemId" value={line.orderItemId} />
                <span className="min-w-0 truncate text-sm">
                  {line.title}
                  {line.variantLabel ? (
                    <span className="text-ink-500"> · {line.variantLabel}</span>
                  ) : null}
                  <span className="text-ink-500">
                    {" "}
                    {interpolate(a.delivery.leftOf, {
                      remaining: line.remaining,
                      ordered: line.ordered,
                    })}
                  </span>
                </span>
                <Input
                  name={`shipQty:${line.orderItemId}`}
                  type="number"
                  min={0}
                  max={line.remaining}
                  inputMode="numeric"
                  aria-label={interpolate(a.delivery.quantityFor, {
                    item: line.title,
                  })}
                  defaultValue={line.remaining}
                  className="w-20 shrink-0"
                />
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={a.orders.carrier} htmlFor={`carrier-${orderId}`}>
              <Input
                id={`carrier-${orderId}`}
                name="trackingCarrier"
                maxLength={80}
                placeholder="Royal Mail"
              />
            </Field>
            <Field label={a.orders.trackingNumber} htmlFor={`tracking-${orderId}`}>
              <Input
                id={`tracking-${orderId}`}
                name="trackingNumber"
                maxLength={120}
              />
            </Field>
          </div>

          <Field
            label={a.delivery.trackingUrlLabel}
            htmlFor={`tracking-url-${orderId}`}
            hint={a.common.optional}
          >
            <Input
              id={`tracking-url-${orderId}`}
              name="trackingUrl"
              maxLength={500}
              placeholder="royalmail.com/track/…"
            />
          </Field>

          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {a.delivery.recordBox}
          </Button>
        </form>
      )}
    </Card>
  );
}
