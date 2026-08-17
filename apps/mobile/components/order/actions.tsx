/**
 * The only part of the phone that writes to an order.
 *
 * Status changes and refunds, with the optimistic cache patch that makes the list agree with
 * the detail screen before the server has answered. `refundError` turns a tRPC failure into
 * something a seller standing in a shop can act on.
 */

import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { formatMoney } from "@sailo/core/currency";
import { TRPCClientError } from "@trpc/client";
import { interpolate } from "@sailo/i18n/native";
import { Banner, Button, Sheet, TextField, haptics } from "@sailo/design-system/native";
import type { OrderDetail } from "../../lib/models";
import { textToPrice } from "@sailo/core/currency";
import { useT } from "../../lib/i18n";
import { useTRPC } from "../../lib/query";
import { errorMessage } from "../states";

/* -------------------------------------------------------------------------- */
/*  Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The money breakdown, as the order stored it.
 *
 * Every number here is a column, not a calculation. The order was priced once,
 * at checkout, by `@sailo/core/pricing`, and those totals were snapshotted —
 * including the tax rate and name, so a later rate change cannot rewrite what a
 * past buyer was charged. Recomputing any of it on the phone would risk showing
 * a total the buyer was never charged.
 */
/**
 * Refunding, and recording dispatch.
 *
 * Both were web-only until `@sailo/email` existed, and neither was blocked on
 * the money or the row — a refund that moves money while telling nobody is
 * worse than no button, and a shipping notice with no email is a tracking
 * number the buyer never sees.
 *
 * WHAT THE SELLER IS TOLD AFTERWARDS
 *
 * More than "done". A refund on a bank transfer or a cash sale settles between
 * two people, so `reversed` decides between "the money is on its way back" and
 * "pay them back yourself" — a seller who assumed Stripe had done it would
 * leave a buyer waiting for money nobody sent. A shipping notice reports
 * whether the email actually left, because an order taken over the counter has
 * no address and a seller who believes their buyer has tracking will not chase
 * it.
 */
export function OrderActions({ order, locale }: { order: OrderDetail; locale: string }) {
  const { a, t } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [sheet, setSheet] = useState<"refund" | "ship" | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [carrier, setCarrier] = useState(order.trackingCarrier ?? "");
  const [tracking, setTracking] = useState(order.trackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? "");

  const invalidate = useCallback(
    () => queryClient.invalidateQueries(trpc.orders.pathFilter()),
    [queryClient, trpc],
  );

  const refund = useMutation(
    trpc.orders.refund.mutationOptions({
      onSuccess: async (result) => {
        haptics.success();
        setSheet(null);
        Alert.alert(
          a.orders.recordRefund,
          result.reversed ? a.orders.refundSent : a.orders.refundManual,
        );
        await invalidate();
      },
      onError: (error) => {
        haptics.error();
        captureError(error, { scope: "mobile:orders:refund" });
      },
    }),
  );

  const ship = useMutation(
    trpc.orders.markShipped.mutationOptions({
      onSuccess: async (result) => {
        haptics.success();
        setSheet(null);
        /* Whether the buyer was actually told. `null` means we did not ask;
           `sent: false` with a reason means we did and it did not go. */
        if (result.notified && !result.notified.sent) {
          Alert.alert(a.orders.markShipped, a.orders.shippedNotEmailed);
        }
        await invalidate();
      },
      onError: (error) => {
        haptics.error();
        captureError(error, { scope: "mobile:orders:ship" });
      },
    }),
  );

  /* Nothing left to give back is not a refund waiting to happen. */
  const refundable = order.totalCents - order.refundedCents;

  return (
    <>
      <View style={styles.actions}>
        {refundable > 0 ? (
          <Button
            label={a.orders.recordRefund}
            variant="secondary"
            onPress={() => {
              setAmount("");
              setReason("");
              setSheet("refund");
            }}
            testID="order-refund"
          />
        ) : null}
        {order.status !== "cancelled" && order.status !== "refunded" ? (
          <Button
            label={a.orders.markShipped}
            icon="package"
            variant="secondary"
            onPress={() => setSheet("ship")}
            testID="order-ship"
          />
        ) : null}
      </View>

      <Sheet
        visible={sheet === "refund"}
        onClose={() => setSheet(null)}
        title={a.orders.recordRefund}
        closeLabel={a.common.cancel}
        dismissible={false}
      >
        <View style={styles.form}>
          {refund.error ? (
            <Banner tone="danger" message={refundError(refund.error, a, t)} />
          ) : null}

          <TextField
            label={interpolate(a.productForm.price, { currency: order.currency })}
            /* Blank refunds whatever is left, never the whole order again —
               the server decides that, so the hint says it rather than the
               field pre-filling a number the seller did not choose. */
            hint={`${a.orders.refundAmountHint} · ${formatMoney(refundable, order.currency, locale)}`}
            value={amount}
            onChangeText={setAmount}
            keyboard="decimal"
          />
          <TextField
            label={a.orders.refundReason}
            placeholder={a.orders.refundReasonPlaceholder}
            value={reason}
            onChangeText={setReason}
          />
          <Button
            label={a.orders.recordRefund}
            variant="danger"
            loading={refund.isPending}
            onPress={() =>
              refund.mutate({
                id: order.id,
                amountCents: amount.trim()
                  ? textToPrice(amount, order.currency, locale)
                  : null,
                reason: reason.trim() || null,
              })
            }
            fullWidth
          />
        </View>
      </Sheet>

      <Sheet
        visible={sheet === "ship"}
        onClose={() => setSheet(null)}
        title={a.orders.markShipped}
        closeLabel={a.common.cancel}
        dismissible={false}
      >
        <View style={styles.form}>
          {ship.error ? (
            <Banner tone="danger" message={errorMessage(ship.error, t.errors.body)} />
          ) : null}

          <TextField label={a.orders.carrier} value={carrier} onChangeText={setCarrier} />
          <TextField
            label={a.orders.trackingNumber}
            placeholder={a.orders.trackingNumberPlaceholder}
            value={tracking}
            onChangeText={setTracking}
          />
          <TextField
            label={a.orders.trackingLink}
            placeholder={a.orders.trackingLinkPlaceholder}
            value={trackingUrl}
            onChangeText={setTrackingUrl}
            keyboard="url"
          />
          <Button
            label={a.orders.markShipped}
            loading={ship.isPending}
            onPress={() =>
              ship.mutate({
                id: order.id,
                carrier: carrier.trim() || null,
                trackingNumber: tracking.trim() || null,
                trackingUrl: trackingUrl.trim() || null,
              })
            }
            fullWidth
          />
        </View>
      </Sheet>
    </>
  );
}

/**
 * A refund refusal, in the seller's words.
 *
 * `raced` is the one worth spelling out: another refund on this order claimed
 * the balance first, which means the amount on screen is stale rather than
 * anything having gone wrong.
 */
export function refundError(
  error: unknown,
  a: ReturnType<typeof useT>["a"],
  t: ReturnType<typeof useT>["t"],
): string {
  const code = error instanceof TRPCClientError ? String(error.message ?? "") : "";
  if (code === "raced") return a.orders.refundRaced;
  if (code === "reversal_failed") return a.orders.refundFailed;
  if (code === "exceeds_remaining") return a.orders.refundTooMuch;
  return errorMessage(error, t.errors.body);
}

const styles = StyleSheet.create({
  /* Side by side while both fit, wrapping rather than shrinking — a refund button narrow
     enough to read as an icon is one nobody presses on purpose. */
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  form: { gap: 16 },
});
