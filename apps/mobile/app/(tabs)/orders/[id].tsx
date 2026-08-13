import { useCallback, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { ORDER_STATUSES, orderStatusLabel, type OrderStatus } from "@sailo/core/order-status";
import { adminEn } from "@sailo/i18n/admin/en";
import type { Order, OrderDetail, OrderItem } from "../../../lib/models";
import { useTRPC } from "../../../lib/query";
import { ErrorState, Loading, errorMessage } from "../../../components/states";
import {
  ORDER_STATUS_LABELS,
  OrderStatusBadge,
  PaymentStatusBadge,
} from "../../../components/order-status";
import { formatMoney } from "../../../components/money";

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
 * `orders.updateStatus` calls `applyOrderStatus`, which is the same function
 * the web action calls: cancelling puts the units back on the shelf and voids
 * the tickets, and un-cancelling takes them off again. This screen sends a
 * status and repaints; it does not try to predict the cascade.
 */

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);

  const order = useQuery(trpc.orders.get.queryOptions({ id }));

  /**
   * The optimistic write.
   *
   * The status badge flips the instant the seller taps, because on a phone the
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

        const previousDetail = queryClient.getQueryData(trpc.orders.get.queryKey({ id }));
        const previousLists = queryClient.getQueriesData<Order[]>(
          trpc.orders.list.queryFilter(),
        );

        queryClient.setQueryData(trpc.orders.get.queryKey({ id }), (current) =>
          current ? { ...current, status } : current,
        );
        /*
         * Every cached page, not one: growing the limit creates a separate
         * cache entry per page size, so the row can be sitting in several.
         */
        queryClient.setQueriesData<Order[]>(trpc.orders.list.queryFilter(), (rows) =>
          rows?.map((row) => (row.id === id ? { ...row, status } : row)),
        );

        return { previousDetail, previousLists };
      },

      onError: (error, _variables, context) => {
        captureError(error, { scope: "mobile:orders:updateStatus" });
        // Put back exactly what was there. A failed write must not leave the
        // seller looking at a status the server never accepted.
        if (context?.previousDetail) {
          queryClient.setQueryData(trpc.orders.get.queryKey({ id }), context.previousDetail);
        }
        for (const [key, rows] of context?.previousLists ?? []) {
          queryClient.setQueryData(key, rows);
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
      <SafeAreaView style={styles.safe}>
        <TopBar onBack={router.back} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (order.error) {
    captureError(order.error, { scope: "mobile:orders:detail" });
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar onBack={router.back} />
        <ErrorState
          message={errorMessage(order.error, "Couldn't load this order.")}
          onRetry={() => void order.refetch()}
          retrying={order.isFetching}
        />
      </SafeAreaView>
    );
  }

  const data = order.data;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <TopBar onBack={router.back} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.headerBlock}>
          <Text style={styles.total}>{formatMoney(data.totalCents, data.currency)}</Text>
          <Text style={styles.placed}>{placedOn(data.createdAt)}</Text>
          <View style={styles.badges}>
            <OrderStatusBadge status={data.status} />
            <PaymentStatusBadge status={data.paymentStatus} />
          </View>
        </View>

        {/*
          The seller's one write, and the failure that goes with it. The banner
          sits next to the control that caused it rather than in a toast — the
          status is right here, and an error the seller has to remember is an
          error they will miss.
        */}
        <Pressable
          style={[styles.statusButton, update.isPending && styles.statusButtonBusy]}
          disabled={update.isPending}
          onPress={() => setPicking(true)}
        >
          <Text style={styles.statusButtonLabel}>{adminEn.orders.statusLabel}</Text>
          <Text style={styles.statusButtonValue}>
            {orderStatusLabel(data.status, ORDER_STATUS_LABELS)}
            {update.isPending ? " …" : ""}
          </Text>
        </Pressable>
        {update.error ? (
          <Text style={styles.inlineError}>
            {errorMessage(update.error, "Couldn't update this order.")}
          </Text>
        ) : null}

        {/*
          The gap the router documents: a status set from the phone does not
          email the buyer or fire the storefront webhooks, and for an
          appointment that decision is the whole message. Saying so is the
          honest thing — the alternative is a seller who thinks they told
          somebody their booking was confirmed.
        */}
        {data.scheduledFor ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              This is a booking. Confirming or cancelling here won&apos;t email the buyer —
              use your dashboard for that.
            </Text>
          </View>
        ) : null}

        <Items items={data.items} currency={data.currency} />
        <Totals order={data} />
        <Fulfilment order={data} />
        <Buyer order={data} />
      </ScrollView>

      <StatusPicker
        visible={picking}
        current={data.status}
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
function Items({ items, currency }: { items: OrderItem[]; currency: string }) {
  return (
    <Section title={adminEn.orders.items}>
      {items.map((item) => (
        <View key={item.id} style={styles.item}>
          <View style={styles.itemMain}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            {item.variantLabel ? (
              <Text style={styles.itemMeta}>{item.variantLabel}</Text>
            ) : null}
            <Text style={styles.itemMeta}>
              {item.quantity} × {formatMoney(item.unitPriceCents, currency)}
            </Text>
          </View>
          {/* The line's own subtotal — unit price × quantity, as stored. */}
          <Text style={styles.itemAmount}>{formatMoney(item.subtotalCents, currency)}</Text>
        </View>
      ))}
    </Section>
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
function Totals({ order }: { order: OrderDetail }) {
  const money = (minor: number) => formatMoney(minor, order.currency);
  return (
    <Section title="Total">
      <Row label="Subtotal" value={money(order.subtotalCents)} />
      {order.discountCents > 0 ? (
        <Row
          label={order.couponCode ?? adminEn.columns.discount}
          value={`− ${money(order.discountCents)}`}
        />
      ) : null}
      {order.deliveryFeeCents > 0 ? (
        <Row label={adminEn.orders.delivery} value={money(order.deliveryFeeCents)} />
      ) : null}
      {order.taxCents > 0 ? (
        <Row
          // The shop's own word for it — "VAT", "GST", "Sales tax" — snapshotted
          // on the order, because that is what the buyer's invoice says.
          label={`${order.taxName ?? "Tax"}${order.taxInclusive ? " (included)" : ""}`}
          value={money(order.taxCents)}
        />
      ) : null}
      <Row label="Total" value={money(order.totalCents)} strong />
      {order.refundedCents > 0 ? (
        <Row label={adminEn.orders.refunded} value={`− ${money(order.refundedCents)}`} />
      ) : null}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Fulfilment                                                                 */
/* -------------------------------------------------------------------------- */

/** How it gets to the buyer, and how far along that is. */
function Fulfilment({ order }: { order: OrderDetail }) {
  const rows = [
    order.deliveryLabel ? { label: adminEn.orders.delivery, value: order.deliveryLabel } : null,
    order.pickupLocation
      ? { label: adminEn.orders.collectFrom, value: order.pickupLocation }
      : null,
    order.trackingCarrier ? { label: adminEn.orders.carrier, value: order.trackingCarrier } : null,
    order.trackingNumber
      ? { label: adminEn.orders.trackingNumber, value: order.trackingNumber }
      : null,
    order.shippedAt ? { label: "Shipped", value: placedOn(order.shippedAt) } : null,
    order.scheduledFor ? { label: "Scheduled", value: placedOn(order.scheduledFor) } : null,
    order.serviceLocation ? { label: "Where", value: order.serviceLocation } : null,
  ].filter((row) => row !== null);

  if (rows.length === 0) return null;

  return (
    <Section title={adminEn.orders.delivery}>
      {rows.map((row) => (
        <Row key={row.label} label={row.label} value={row.value} />
      ))}
    </Section>
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
    order.customerName ? { label: "Name", value: order.customerName } : null,
    order.customerEmail ? { label: "Email", value: order.customerEmail } : null,
    order.customerPhone ? { label: "Phone", value: order.customerPhone } : null,
    address ? { label: "Address", value: address } : null,
    order.paymentMethod
      ? { label: adminEn.orders.paymentMethodLabel, value: order.paymentMethod }
      : null,
    order.paymentReference
      ? { label: adminEn.orders.transferRef, value: order.paymentReference }
      : null,
    order.note ? { label: "Note", value: order.note } : null,
  ].filter((row) => row !== null);

  if (rows.length === 0) return null;

  return (
    <Section title={adminEn.columns.client}>
      {rows.map((row) => (
        <Row key={row.label} label={row.label} value={row.value} />
      ))}
    </Section>
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
 */
function StatusPicker({
  visible,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  current: string;
  onPick: (status: OrderStatus) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the scrim closes — the expected way out of a sheet, and the
          only one a seller gets if they opened it by accident. */}
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.sheetTitle}>{adminEn.orders.statusLabel}</Text>
          {ORDER_STATUSES.map((status) => {
            const active = status === current;
            return (
              <Pressable
                key={status}
                style={({ pressed }) => [
                  styles.option,
                  active && styles.optionActive,
                  pressed && styles.optionPressed,
                ]}
                onPress={() => onPick(status)}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>
                  {orderStatusLabel(status, ORDER_STATUS_LABELS)}
                </Text>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Bits                                                                       */
/* -------------------------------------------------------------------------- */

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹ {adminEn.orders.title}</Text>
      </Pressable>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.rowLine}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]}>{value}</Text>
    </View>
  );
}

/**
 * Dates arrive as ISO strings, not `Date`s — there is no transformer on this
 * tRPC client, which `lib/models.ts` documents and which a screen that called
 * `.toLocaleString()` straight on the value would discover on a device.
 */
function placedOn(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  topBar: { paddingHorizontal: 20, paddingVertical: 8 },
  back: { fontSize: 16, color: "#4f46e5", fontWeight: "600" },
  body: { padding: 20, paddingBottom: 48, gap: 24 },
  headerBlock: { gap: 6 },
  total: { fontSize: 32, fontWeight: "800", color: "#111827" },
  placed: { fontSize: 14, color: "#6b7280" },
  badges: { flexDirection: "row", gap: 8, marginTop: 6 },

  statusButton: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
  },
  statusButtonBusy: { opacity: 0.6 },
  statusButtonLabel: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  statusButtonValue: { fontSize: 16, color: "#111827", fontWeight: "700" },
  inlineError: { color: "#dc2626", fontSize: 13, marginTop: -16 },

  notice: {
    backgroundColor: "#fffbeb",
    borderRadius: 12,
    padding: 12,
  },
  noticeText: { fontSize: 13, color: "#b45309", lineHeight: 18 },

  section: { gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  itemMain: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 15, fontWeight: "600", color: "#111827" },
  itemMeta: { fontSize: 13, color: "#6b7280" },
  itemAmount: { fontSize: 15, fontWeight: "600", color: "#111827" },

  rowLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 5,
  },
  rowLabel: { fontSize: 14, color: "#6b7280", flexShrink: 0 },
  rowValue: { fontSize: 14, color: "#111827", flex: 1, textAlign: "right" },
  rowStrong: { fontWeight: "800", color: "#111827", fontSize: 15 },

  scrim: { flex: 1, backgroundColor: "rgba(17,24,39,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    gap: 6,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  option: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10 },
  optionActive: { backgroundColor: "#eef2ff" },
  optionPressed: { opacity: 0.6 },
  optionText: { fontSize: 16, color: "#111827" },
  optionTextActive: { color: "#4f46e5", fontWeight: "700" },
});
