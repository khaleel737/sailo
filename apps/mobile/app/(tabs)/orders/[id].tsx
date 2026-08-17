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
import { ORDER_STATUSES, orderStatusLabel, type OrderStatus } from "@sailo/core/order-status";
import { SELLER_SETTABLE_PAYMENT_STATUSES } from "@sailo/core/payment-status";
import {
  Banner,
  Card,
  ErrorState,
  GroupedList,
  ListRow,
  Money,
  Screen,
  Skeleton,
  StatusPill,
  Text,
  haptics,
} from "@sailo/design-system/native";
import type { Order, RouterOutputs } from "../../../lib/models";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";
import {
  orderTone,
  paymentLabel,
  paymentTone,
} from "../../../components/order/tone";
import { Items } from "../../../components/order/items";
import { OrderActions } from "../../../components/order/actions";
import { Totals } from "../../../components/order/totals";
import { Fulfilment } from "../../../components/order/fulfilment";
import { Buyer } from "../../../components/order/buyer";
import { StatusPicker } from "../../../components/order/status-picker";
import { placedOn } from "../../../components/order/format";

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
 *
 * WHAT IS NO LONGER IN THIS FILE
 *
 * It was 918 lines: this screen plus seven components it happened to render. They are in
 * `components/order/` now, which is where they have to be — in Expo Router every file under
 * `app/` is a route, so a component kept beside its screen for tidiness would have become a
 * URL. `orderTone` was the clearest case: it was exported from the orders *list* route and
 * imported by three screens.
 */

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
              tone={paymentTone(data.paymentStatus)}
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

const EDGES = [] as const;

const styles = StyleSheet.create({
  headline: { gap: 6 },
  badges: { flexDirection: "row", gap: 8, marginTop: 6 },
});
