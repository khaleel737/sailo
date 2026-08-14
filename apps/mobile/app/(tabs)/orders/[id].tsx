import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import {
  Card,
  ErrorState,
  GroupedList,
  Icon,
  ListRow,
  Money,
  Sheet,
  Skeleton,
  StatusPill,
  Text,
  type StatusTone,
} from "@sailo/design-native";
import type { Order, OrderDetail, OrderItem, RouterOutputs } from "../../../lib/models";
import { useT } from "../../../lib/i18n";
import { useTRPC } from "../../../lib/query";
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

      onError: (error, _variables, context) => {
        captureError(error, { scope: "mobile:orders:updateStatus" });
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
      <SafeAreaView style={styles.safe} edges={["left", "right"]}>
        <View style={styles.body}>
          <Skeleton shape="title" />
          <Skeleton shape="card" />
          <Skeleton shape="row" count={4} />
        </View>
      </SafeAreaView>
    );
  }

  if (order.error) {
    captureError(order.error, { scope: "mobile:orders:detail" });
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right"]}>
        <ErrorState
          message={t.errors.title}
          detail={errorMessage(order.error, t.errors.body)}
          onRetry={() => void order.refetch()}
          retrying={order.isFetching}
        />
      </SafeAreaView>
    );
  }

  const data = order.data;
  const statusLabel = orderStatusLabel(data.status, a.orderStatus);

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      {/*
        The header's title, set once the order has loaded rather than in the
        layout, which is why `orders/_layout.tsx` names `[id]` with an empty
        one: a title declared there would flash a placeholder before the real
        order arrived. The buyer's name is what a seller recognises the order
        by; without one, the first line's title is the next best handle on it.
      */}
      <Stack.Screen options={{ title: data.customerName ?? data.productTitle }} />

      <ScrollView contentContainerStyle={styles.body}>
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
        </GroupedList>
        {update.error ? (
          <Text variant="caption" tone="danger">
            {errorMessage(update.error, t.errors.body)}
          </Text>
        ) : null}

        {/*
          The gap `orders.updateStatus` documents: a status set from the phone
          does not email the buyer a booking decision, and for an appointment
          that decision is the whole message. Saying so is the honest thing —
          the alternative is a seller who thinks they have told somebody their
          booking was confirmed.

          i18n: blocked. No dictionary key exists for this sentence and the 35
          admin dictionaries are not this work order's to write, so it is marked
          rather than hidden — the same convention A00 used for the tab labels.
        */}
        {data.scheduledFor ? (
          <Card variant="outlined" padding="md">
            <Text variant="caption" tone="warning">
              This is a booking. Confirming or cancelling here won&apos;t email the buyer — use
              your dashboard for that.
            </Text>
          </Card>
        ) : null}

        <Items items={data.items} currency={data.currency} locale={locale} header={a.orders.items} />
        <Totals order={data} locale={locale} />
        <Fulfilment order={data} locale={locale} />
        <Buyer order={data} />
      </ScrollView>

      <StatusPicker
        visible={picking}
        current={data.status}
        title={a.orders.statusLabel}
        labels={a.orderStatus}
        onPick={setStatus}
        onClose={() => setPicking(false)}
      />
    </SafeAreaView>
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
function Totals({ order, locale }: { order: OrderDetail; locale: string }) {
  const { t, a } = useT();
  const money = (minor: number) => formatMoney(minor, order.currency, locale);

  return (
    <GroupedList header={t.checkout.total}>
      <ListRow title={t.checkout.subtotal} value={money(order.subtotalCents)} />
      {order.discountCents > 0 ? (
        <ListRow
          title={order.couponCode ?? t.checkout.discount}
          value={`− ${money(order.discountCents)}`}
        />
      ) : null}
      {order.deliveryFeeCents > 0 ? (
        <ListRow title={a.orders.delivery} value={money(order.deliveryFeeCents)} />
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
          value={money(order.taxCents)}
        />
      ) : null}
      <ListRow title={t.checkout.total} value={money(order.totalCents)} />
      {order.refundedCents > 0 ? (
        <ListRow title={a.orders.refunded} value={`− ${money(order.refundedCents)}`} />
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
    /*
     * `a.settings.booking` is borrowed — it is the word "Booking", and it is
     * the right word, but it lives in the settings section because that is
     * where it was first needed. An `a.orders.booking` of its own is the real
     * fix and belongs with the other order keys; adding it means editing all 35
     * dictionaries, which this work order does not own.
     */
    order.scheduledFor
      ? { label: a.settings.booking, value: placedOn(order.scheduledFor, locale) }
      : null,
    order.serviceLocation ? { label: a.columns.where, value: order.serviceLocation } : null,
  ].filter((row) => row !== null);

  if (rows.length === 0) return null;

  return (
    <GroupedList header={a.orders.delivery}>
      {rows.map((row) => (
        <ListRow key={row.label} title={row.label} value={row.value} />
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
        <ListRow key={row.label} title={row.label} value={row.value} />
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
function StatusPicker({
  visible,
  current,
  title,
  labels,
  onPick,
  onClose,
}: {
  visible: boolean;
  current: string;
  title: string;
  labels: Record<string, string>;
  onPick: (status: OrderStatus) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <GroupedList>
        {ORDER_STATUSES.map((status) => {
          const active = status === current;
          return (
            <ListRow
              key={status}
              title={orderStatusLabel(status, labels)}
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
const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: 16, paddingBottom: 48, gap: 24 },
  headline: { gap: 6 },
  badges: { flexDirection: "row", gap: 8, marginTop: 6 },
});
