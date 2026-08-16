import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { formatMoney } from "@sailo/core/currency";
import { ORDER_STATUSES, orderStatusLabel, type OrderStatus } from "@sailo/core/order-status";
import { SELLER_SETTABLE_PAYMENT_STATUSES } from "@sailo/core/payment-status";
import { TRPCClientError } from "@trpc/client";
import { interpolate } from "@sailo/i18n/native";
import {
  Banner,
  Button,
  Card,
  ErrorState,
  GroupedList,
  Icon,
  ListRow,
  Money,
  Screen,
  Sheet,
  Skeleton,
  StatusPill,
  Text,
  TextField,
  haptics,
  type StatusTone,
} from "@sailo/design-native";
import type { Order, OrderDetail, OrderItem, RouterOutputs } from "../../../lib/models";
import { textToPrice } from "../../../components/money";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";
import { orderTone } from "./index";

/**
 * One order, and the only thing on the phone that writes.
 *
 * WHAT THIS SCREEN IS ALLOWED TO CHANGE
 *
 * The order's status, and nothing else. Money and payment state are rendered
 * and never offered as an edit — `PAYMENT_STATUSES` lives in apps/web and
 * nothing outside it sets one, so a phone that could rewrite what a buyer paid
 * would be inventing a second answer to a question the web already owns.
 *
 * The status change itself re-implements none of the rule behind it.
 * `orders.updateStatus` calls `changeOrderStatus`, which is the same function
 * the web action calls: cancelling puts the units back on the shelf, voids the
 * tickets and fires the same storefront webhooks. This screen sends a status
 * and repaints; it does not try to predict the cascade.
 *
 * The "‹ Orders" control this file used to draw is gone. `orders/_layout.tsx`
 * gave the tab a real stack with a real header, and the hand-rolled one was a
 * second back affordance sitting under the system's — which that layout's note
 * asked whoever opened this screen next to delete. The header's *title* is set
 * from here instead, once the order has loaded, which is what that layout's
 * empty `title` is waiting for.
 */

/**
 * What the buyer has actually paid, as a tone.
 *
 * Local, and separate from `orderTone`, because payment states are not order
 * states: a refund is a *neutral* fact about an order and a red one about a
 * payment. `disputed` is the bank's decision, not the seller's, which is why it
 * is the same red as a refund rather than a warning.
 */
const PAYMENT_TONES: Record<string, StatusTone> = {
  unpaid: "neutral",
  pending: "warning",
  paid: "success",
  refunded: "danger",
  disputed: "danger",
};

/**
 * One page of `orders.list`, as the optimistic patch below has to reason about
 * it. Inferred from the router rather than written out, so the day a page grows
 * a field this screen fails to compile instead of quietly dropping it while
 * rewriting the cache.
 */
type OrderPage = RouterOutputs["orders"]["list"];

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, a, locale } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [pickingPayment, setPickingPayment] = useState(false);

  const order = useQuery(trpc.orders.get.queryOptions({ id }));

  /**
   * The optimistic write.
   *
   * The status flips the instant the seller taps, because on a phone the
   * alternative is a row that sits there looking broken for the length of a
   * round trip. What is repainted is *only* the status — the one field the
   * response is going to confirm. The cascade behind it (stock going back on
   * the shelf, tickets being voided) is deliberately not predicted here: it
   * happens on the server, and guessing at it is how a client-side copy of a
   * business rule gets born.
   *
   * Both caches are patched, not just this screen's. The list the seller came
   * from is still mounted behind this route, so leaving it stale means tapping
   * back to a row that contradicts the screen they just used.
   */
  /*
   * Confirming the money. Its own mutation rather than a branch of the status
   * one, because they are different questions with different consequences: a
   * status change moves an order along, and this one unlocks a download and
   * can start a membership billing.
   */
  const pay = useMutation(
    trpc.orders.setPaymentStatus.mutationOptions({
      onSuccess: async (result) => {
        haptics.success();
        setPickingPayment(false);
        /* Said out loud, because it is the part the seller cannot see: the
           buyer's files were locked and now are not. */
        if (result.releasedDownloads) {
          Alert.alert(a.orders.paymentStatusLabel, a.orders.downloadsReleased);
        }
        await queryClient.invalidateQueries(trpc.orders.pathFilter());
      },
      onError: (error) => {
        haptics.error();
        captureError(error, { scope: "mobile:orders:paymentStatus" });
      },
    }),
  );

  const update = useMutation(
    trpc.orders.updateStatus.mutationOptions({
      onMutate: async ({ status }) => {
        /*
         * Stop a refetch already in flight from landing on top of the patch and
         * putting the old status back. Both the detail and the lists, because
         * both are patched below — a pull-to-refresh the seller started a moment
         * before tapping would otherwise undo the row in front of them.
         */
        await queryClient.cancelQueries(trpc.orders.pathFilter());

        const patch = (rows: Order[]) =>
          rows.map((row) => (row.id === id ? { ...row, status } : row));

        const previousDetail = queryClient.getQueryData(trpc.orders.get.queryKey({ id }));
        /*
         * Two caches, because there are two ways this shop's orders are being
         * held. Home reads `orders.list` as a plain query for its five most
         * recent; the Orders tab reads the same procedure as an infinite one.
         * tRPC keys them apart — `{ type: "query" }` against
         * `{ type: "infinite" }` — so one filter cannot reach the other, and a
         * patch that only knew about one of them would leave the seller
         * tapping back onto a row that contradicts the screen they just used.
         */
        const previousPages = queryClient.getQueriesData<OrderPage>(
          trpc.orders.list.queryFilter(),
        );
        const previousInfinite = queryClient.getQueriesData<InfiniteData<OrderPage>>(
          trpc.orders.list.infiniteQueryFilter(),
        );

        queryClient.setQueryData(trpc.orders.get.queryKey({ id }), (current) =>
          current ? { ...current, status } : current,
        );
        queryClient.setQueriesData<OrderPage>(trpc.orders.list.queryFilter(), (page) =>
          page ? { ...page, items: patch(page.items) } : page,
        );
        /*
         * Every fetched page, not the first: the seller may have scrolled a
         * long way down before opening this order, and the row they came from
         * is in whichever page it arrived on.
         */
        queryClient.setQueriesData<InfiniteData<OrderPage>>(
          trpc.orders.list.infiniteQueryFilter(),
          (data) =>
            data
              ? {
                  ...data,
                  pages: data.pages.map((page) => ({ ...page, items: patch(page.items) })),
                }
              : data,
        );

        return { previousDetail, previousPages, previousInfinite };
      },

      onSuccess: () => {
        /*
         * On the outcome, not on the tap. A haptic when the button is pressed
         * says "I registered that", which the press state already says; one
         * when the server answers says "it is done", which is the thing a
         * seller standing in a kitchen with the phone face-down actually needs.
         */
        haptics.success();
      },

      onError: (error, _variables, context) => {
        captureError(error, { scope: "mobile:orders:updateStatus" });
        // The rollback below is visual; this is the half a seller feels when
        // they are not looking at the screen.
        haptics.error();
        // Put back exactly what was there. A failed write must not leave the
        // seller looking at a status the server never accepted.
        if (context?.previousDetail) {
          queryClient.setQueryData(trpc.orders.get.queryKey({ id }), context.previousDetail);
        }
        for (const [key, page] of context?.previousPages ?? []) {
          queryClient.setQueryData(key, page);
        }
        for (const [key, data] of context?.previousInfinite ?? []) {
          queryClient.setQueryData(key, data);
        }
      },

      onSettled: () => {
        /*
         * Orders, because the server is the authority on what the status now is.
         * Products too, because cancelling or refunding restocks — the seller's
         * catalogue counts are stale the moment this succeeds, and they are one
         * screen away.
         */
        void queryClient.invalidateQueries(trpc.orders.pathFilter());
        void queryClient.invalidateQueries(trpc.products.pathFilter());
      },
    }),
  );

  const setStatus = useCallback(
    (status: OrderStatus) => {
      setPicking(false);
      if (status === order.data?.status) return;
      update.mutate({ id, status });
    },
    [id, order.data?.status, update],
  );

  if (order.isPending) {
    return (
      <Screen scroll={false} edges={EDGES} testID="order-loading">
        <Skeleton shape="title" />
        <Skeleton shape="card" />
        <Skeleton shape="row" count={4} />
      </Screen>
    );
  }

  if (order.error) {
    reportQueryError(order.error, { scope: "mobile:orders:detail" });
    return (
      <Screen scroll={false} edges={EDGES}>
        <ErrorState
          message={t.errors.title}
          detail={errorMessage(order.error, t.errors.body)}
          onRetry={() => void order.refetch()}
          retryLabel={t.errors.retry}
          retrying={order.isFetching}
        />
      </Screen>
    );
  }

  const data = order.data;
  const statusLabel = orderStatusLabel(data.status, a.orderStatus);

  return (
    <Screen edges={EDGES} testID="order-detail">
      {/*
        The header's title, set once the order has loaded rather than in the
        layout, which is why `orders/_layout.tsx` names `[id]` with an empty
        one: a title declared there would flash a placeholder before the real
        order arrived. The buyer's name is what a seller recognises the order
        by; without one, the first line's title is the next best handle on it.
      */}
      <Stack.Screen options={{ title: data.customerName ?? data.productTitle }} />

      {/*
        The amount, the moment it was placed, and its two states — as one block
        rather than as four things floating at the top of a scroll.

        `Money` renders at `display` here, which it did not before: the
        component declared `variant`, `tone` and `weight` on its props, then
        destructured none of them and drew a bare `RNText`. So this line was
        body-sized in the default ink — and, because a bare `RNText` takes no
        colour from the theme, **black on black in dark mode**. `money.tsx`
        carries the rest.
      */}
      <Card padding="lg">
        <View style={styles.headline}>
          <Money minor={data.totalCents} currency={data.currency} locale={locale} variant="display" />
          <Text variant="caption" tone="muted">
            {placedOn(data.createdAt, locale)}
          </Text>
          <View style={styles.badges}>
            <StatusPill label={statusLabel} tone={orderTone(data.status)} />
            <StatusPill
              label={a.paymentStatus[data.paymentStatus as keyof typeof a.paymentStatus] ?? data.paymentStatus}
              tone={PAYMENT_TONES[data.paymentStatus] ?? "neutral"}
            />
          </View>
        </View>
      </Card>

      {/*
        The seller's one write, and the failure that goes with it. The message
          sits next to the control that caused it rather than in a toast — the
        status is right here, and an error the seller has to remember is an
        error they will miss. `Toast`'s own note makes the same point from the
        other side.
      */}
      <GroupedList>
        <ListRow
          title={a.orders.statusLabel}
          value={statusLabel}
          trailing="chevron"
          disabled={update.isPending}
          onPress={() => setPicking(true)}
          accessibilityLabel={`${a.orders.statusLabel}, ${statusLabel}`}
          testID="order-status"
        />
        {/*
          The second question every order has, and the one a phone answers
          better than a laptop: did the money turn up. On a card sale Stripe
          has already said; on cash at a stall the seller is the only source.
        */}
        <ListRow
          title={a.orders.paymentStatusLabel}
          value={paymentLabel(data.paymentStatus, a)}
          trailing="chevron"
          disabled={pay.isPending}
          onPress={() => setPickingPayment(true)}
          testID="order-payment-status"
        />
      </GroupedList>
      {update.error ? (
        <Banner
          tone="danger"
          message={errorMessage(update.error, t.errors.body)}
          testID="order-status-failed"
        />
      ) : null}

      {/*
        The two writes that move money and parcels, below the status because
        that is the order a seller works in: what state is this, then what am I
        doing about it.

        Both are absent rather than disabled where they cannot apply. A refund
        on an order with nothing left to give back, or a tracking number on a
        download, are controls that could only ever refuse.
      */}
      <OrderActions order={data} locale={locale} />

      <Items items={data.items} currency={data.currency} locale={locale} header={a.orders.items} />
      <Totals order={data} locale={locale} />
      <Fulfilment order={data} locale={locale} />
      <Buyer order={data} />

      <StatusPicker
        visible={picking}
        current={data.status}
        title={a.orders.statusLabel}
        options={ORDER_STATUSES}
        label={(status) => orderStatusLabel(status, a.orderStatus)}
        onPick={setStatus}
        onClose={() => setPicking(false)}
        closeLabel={a.common.cancel}
      />

      {/*
        Whether the money has arrived, which on a bank transfer or a cash sale
        is a thing only the seller knows. `SELLER_SETTABLE_PAYMENT_STATUSES`
        rather than the full list: `disputed` is a fact a bank reported, and a
        control that let the seller clear it would hide money that has already
        left their balance.
      */}
      <StatusPicker
        visible={pickingPayment}
        current={data.paymentStatus}
        title={a.orders.paymentStatusLabel}
        options={SELLER_SETTABLE_PAYMENT_STATUSES}
        label={(status) => a.paymentStatus[status]}
        onPick={(status) => pay.mutate({ id: data.id, paymentStatus: status })}
        onClose={() => setPickingPayment(false)}
        closeLabel={a.common.cancel}
      />
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/*  Lines                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What was actually bought.
 *
 * Read from `items`, never from the header. The order row carries
 * `productTitle`, `unitPriceCents` and `quantity` as a summary of the *first*
 * line so a list can render without a join — on a two-line order those columns
 * describe one of them, and a detail screen that trusted them would quietly
 * show the wrong basket.
 */
function Items({
  items,
  currency,
  locale,
  header,
}: {
  items: OrderItem[];
  currency: string;
  locale: string;
  header: string;
}) {
  return (
    <GroupedList header={header}>
      {items.map((item) => (
        <ListRow
          key={item.id}
          title={item.title}
          subtitle={[
            item.variantLabel,
            `${item.quantity} × ${formatMoney(item.unitPriceCents, currency, locale)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          // The line's own subtotal — unit price × quantity, as stored.
          valueTone="strong"
          value={formatMoney(item.subtotalCents, currency, locale)}
        />
      ))}
    </GroupedList>
  );
}

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
function OrderActions({ order, locale }: { order: OrderDetail; locale: string }) {
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
function refundError(
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

function Totals({ order, locale }: { order: OrderDetail; locale: string }) {
  const { t, a } = useT();
  const money = (minor: number) => formatMoney(minor, order.currency, locale);

  return (
    <GroupedList header={t.checkout.total}>
      <ListRow title={t.checkout.subtotal} valueTone="strong" value={money(order.subtotalCents)} />
      {order.discountCents > 0 ? (
        <ListRow
          title={order.couponCode ?? t.checkout.discount}
          valueTone="strong"
          value={`− ${money(order.discountCents)}`}
        />
      ) : null}
      {order.deliveryFeeCents > 0 ? (
        <ListRow title={a.orders.delivery} valueTone="strong" value={money(order.deliveryFeeCents)} />
      ) : null}
      {order.taxCents > 0 ? (
        <ListRow
          /*
           * The shop's own word for it — "VAT", "GST", "Sales tax" —
           * snapshotted on the order, because that is what the buyer's invoice
           * says. An inclusive rate is named rather than marked: the money was
           * already inside the total above, and a bare "VAT" line under it
           * reads as an amount added on top.
           */
          title={
            order.taxInclusive
              ? `${t.invoice.includes} ${order.taxName ?? t.invoice.tax}`
              : (order.taxName ?? t.invoice.tax)
          }
          valueTone="strong"
          value={money(order.taxCents)}
        />
      ) : null}
      <ListRow title={t.checkout.total} valueTone="strong" value={money(order.totalCents)} />
      {order.refundedCents > 0 ? (
        <ListRow title={a.orders.refunded} valueTone="strong" value={`− ${money(order.refundedCents)}`} />
      ) : null}
    </GroupedList>
  );
}

/* -------------------------------------------------------------------------- */
/*  Fulfilment                                                                 */
/* -------------------------------------------------------------------------- */

/** How it gets to the buyer, and how far along that is. */
function Fulfilment({ order, locale }: { order: OrderDetail; locale: string }) {
  const { a } = useT();

  const rows = [
    order.deliveryLabel ? { label: a.orders.delivery, value: order.deliveryLabel } : null,
    order.pickupLocation ? { label: a.orders.collectFrom, value: order.pickupLocation } : null,
    order.trackingCarrier ? { label: a.orders.carrier, value: order.trackingCarrier } : null,
    order.trackingNumber ? { label: a.orders.trackingNumber, value: order.trackingNumber } : null,
    order.shippedAt ? { label: a.orderStatus.shipped, value: placedOn(order.shippedAt, locale) } : null,
    order.scheduledFor
      ? { label: a.orders.booking, value: placedOn(order.scheduledFor, locale) }
      : null,
    order.serviceLocation ? { label: a.columns.where, value: order.serviceLocation } : null,
  ].filter((row) => row !== null);

  if (rows.length === 0) return null;

  return (
    <GroupedList header={a.orders.delivery}>
      {rows.map((row) => (
        <ListRow key={row.label} title={row.label} value={row.value} subtitleLines={2} />
      ))}
    </GroupedList>
  );
}

/* -------------------------------------------------------------------------- */
/*  Buyer                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Who bought it — the snapshot taken at checkout, not the client record.
 * A buyer who later edits their profile must not silently rewrite an order
 * that was already placed and possibly already invoiced.
 */
function Buyer({ order }: { order: OrderDetail }) {
  const { t, a } = useT();

  const address = [
    order.addressLine1,
    order.addressLine2,
    order.city,
    order.region,
    order.postalCode,
    order.country,
  ]
    .filter(Boolean)
    .join(", ");

  const rows = [
    order.customerName ? { label: a.common.name, value: order.customerName } : null,
    order.customerEmail ? { label: a.common.email, value: order.customerEmail } : null,
    order.customerPhone ? { label: a.clients.phone, value: order.customerPhone } : null,
    address ? { label: t.checkout.deliveryAddress, value: address } : null,
    order.paymentMethod
      ? { label: a.orders.paymentMethodLabel, value: order.paymentMethod }
      : null,
    order.paymentReference ? { label: a.orders.transferRef, value: order.paymentReference } : null,
    order.note ? { label: a.clients.note, value: order.note } : null,
  ].filter((row) => row !== null);

  if (rows.length === 0) return null;

  return (
    <GroupedList header={a.columns.client}>
      {rows.map((row) => (
        <ListRow key={row.label} title={row.label} value={row.value} subtitleLines={2} />
      ))}
    </GroupedList>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status picker                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The six statuses, offered exactly as the web dropdown offers them.
 *
 * All of `ORDER_STATUSES`, with no transition rules layered on top — because
 * the web has none either. Inventing "you may only go forward" here would make
 * the phone refuse a correction the same seller can make on their laptop.
 *
 * A `Sheet` rather than a hand-rolled `Modal`: the scrim tap, the swipe-down
 * and the back gesture are all its business, and so is what any of that looks
 * like when the seller has Reduce Motion on.
 */
/**
 * One picker for both status kinds.
 *
 * It used to iterate `ORDER_STATUSES` itself, which was right while there was
 * one list to pick from. There are two now — an order's own state and whether
 * its money has arrived — and they are picked the same way, told apart only by
 * which options they offer. A second near-identical sheet is a second place to
 * forget the tick, the close label and the grouping.
 *
 * `options` rather than a list name: the payment set a seller may choose from
 * is narrower than the set that exists — `disputed` is a fact a bank reported,
 * not an opinion they hold — and the caller is what knows which.
 */
function StatusPicker<T extends string>({
  visible,
  current,
  title,
  options,
  label,
  onPick,
  onClose,
  closeLabel,
}: {
  visible: boolean;
  current: string;
  title: string;
  options: readonly T[];
  /** How each option is written in the seller's language. */
  label: (value: T) => string;
  onPick: (status: T) => void;
  onClose: () => void;
  /** The sheet's close button, in the seller's language — the design system
   *  holds no dictionary, so the word comes from here. */
  closeLabel: string;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} closeLabel={closeLabel}>
      <GroupedList>
        {options.map((status) => {
          const active = status === current;
          return (
            <ListRow
              key={status}
              title={label(status)}
              /*
               * The tick is the only thing marking the current status, so it is
               * the one icon on this screen that gets a label of its own —
               * `Icon`'s note is that a glyph beside text should be silent, and
               * this one is not beside text that repeats it.
               */
              accessory={active ? <Icon name="check" accessibilityLabel={title} /> : undefined}
              onPress={() => onPick(status)}
            />
          );
        })}
      </GroupedList>
    </Sheet>
  );
}

/**
 * A payment status, in the seller's language.
 *
 * Falls back to the stored value rather than an em dash. The column is text, so
 * a row written by a build that knew a status this one does not would otherwise
 * render as blank — and "no payment status" is a different and more alarming
 * thing to read than a word you do not recognise.
 */
function paymentLabel(status: string, a: ReturnType<typeof useT>["a"]): string {
  /* Indexed through a widened view rather than a `keyof` cast: the column is
     text, so the value genuinely may not be a key, and a cast that claims it is
     would hand back `undefined` typed as `string`. */
  const labels: Record<string, string | undefined> = a.paymentStatus;
  return labels[status] ?? status;
}

/* -------------------------------------------------------------------------- */
/*  Bits                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Dates arrive as ISO strings, not `Date`s — there is no transformer on this
 * tRPC client, which `lib/models.ts` documents and which a screen that called
 * `.toLocaleString()` straight on the value would discover on a device.
 *
 * Wrapped, for the same reason `@sailo/core/currency` wraps `NumberFormat`:
 * Hermes ships a narrower ICU than a browser's, and an unrecognised locale
 * throws rather than degrading. An ISO date is unambiguous everywhere; a
 * crashed screen is not.
 */
function placedOn(value: string | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/*
 * Layout only — flex and spacing, nothing with a colour, a radius or a font
 * size in it. Every visual decision on this screen belongs to
 * `@sailo/design-native`.
 */
/** No safe-area edges — the stack header owns the top, the tab bar the bottom.
 *  `orders/index.tsx` carries the longer note. */
const EDGES = [] as const;

const styles = StyleSheet.create({
  headline: { gap: 6 },
  badges: { flexDirection: "row", gap: 8, marginTop: 6 },
  /* Side by side while both fit, wrapping rather than shrinking — a refund
     button narrow enough to read as an icon is one nobody presses on purpose. */
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  form: { gap: 16 },
});
