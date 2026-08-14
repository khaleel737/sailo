import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { formatMoney } from "@sailo/core/currency";
import {
  ORDER_STATUSES,
  orderStatusLabel,
  orderStatusTone,
  type OrderStatus,
} from "@sailo/core/order-status";
import { interpolate } from "@sailo/i18n/native";
import {
  Button,
  Divider,
  EmptyState,
  ErrorState,
  GroupedList,
  Icon,
  ListRow,
  Screen,
  Sheet,
  Skeleton,
  StatusPill,
  TextField,
  type StatusTone,
} from "@sailo/design-native";
import type { Order } from "../../../lib/models";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * Every order in the shop, newest first, narrowed to whatever the seller is
 * looking for.
 *
 * WHY THE PAGING IS A CURSOR AND NOT A PAGE NUMBER
 *
 * Orders arrive at the *front* of this list. A seller scrolling while an order
 * comes in and asking for "rows 20–39" of a list that has shifted by one is
 * handed a page that starts a row late — an order they have never seen,
 * skipped, with nothing to say so. `@sailo/commerce/pagination` sets this out
 * at length; what reaches this screen is an opaque `nextCursor` string that is
 * passed back and never parsed, which is the contract that file asks for.
 *
 * `nextCursor: null` is the end of the list, and it is the *only* thing that
 * means the end. A short page does not: the server over-fetches by one to know
 * whether there is more, so a page can come back short for its own reasons. The
 * upshot is that this screen has no cap to admit — the hundred-order ceiling
 * the phone used to hit was a consequence of asking for a longer list each time
 * rather than for the next one.
 *
 * The filter and the search are the server's, not this screen's. Filtering the
 * rows the phone happens to be holding would answer "no orders match" for a
 * shop full of orders that match — the predicate is `and`-ed onto `ctx.shopId`
 * in the WHERE, where it can see all of them.
 */

/** One screenful. Small enough that the first paint is quick on a phone network. */
const PAGE = 20;

/**
 * How long the search box waits before it means it.
 *
 * Long enough that typing a name is one request rather than eight, short enough
 * that it still feels like the list is following along. The trailing edge, not
 * the leading one: a seller who types "am" and keeps going never wanted the
 * results for "a".
 */
const SEARCH_DEBOUNCE = 300;

/** The status filter, plus the absence of one. */
type Filter = OrderStatus | "all";

/* -------------------------------------------------------------------------- */
/*  Shared with the other order screens                                        */
/* -------------------------------------------------------------------------- */

/**
 * The two helpers below are exported from a screen, which is unusual, and the
 * reason is a constraint rather than a preference: **every file under `app/` is
 * a route.** expo-router's context regex excludes only `+api`, `+html` and
 * `+middleware`, so a plain `orders/status.ts` would become the route
 * `/orders/status` — and an underscore does not help, `_layout` being the only
 * special name. The ordinary home for a shared helper is
 * `apps/mobile/components/`, which this work order does not own. Two copies of
 * a colour mapping is exactly how two screens end up drawing the same order two
 * different shades, so the list owns these and the others import them.
 */

/**
 * An order's status, in the vocabulary a badge speaks.
 *
 * `orderStatusTone` in `@sailo/core` answers in colour names, because the web's
 * palette speaks those; `StatusPill` takes a semantic role. This is the
 * translation between the two, and it lives on this side of the boundary
 * because a design system that knew what "refunded" meant would have a domain
 * inside it — which is the reason `status-pill.tsx` says the mapping is the
 * caller's.
 */
const PILL_TONES: Record<ReturnType<typeof orderStatusTone>, StatusTone> = {
  blue: "info",
  amber: "warning",
  green: "success",
  red: "danger",
  neutral: "neutral",
};

export function orderTone(status: string): StatusTone {
  return PILL_TONES[orderStatusTone(status)];
}

const DAY_MS = 86_400_000;
/** How old something gets before a relative time stops being the useful answer. */
const RELATIVE_LIMIT = 7 * DAY_MS;

/**
 * "2h ago", in the seller's language.
 *
 * **Nothing here ticks.** A clock that re-rendered the list every minute would
 * repaint every row to change one word an hour, and on a phone that is a scroll
 * which stutters for no reason the seller can see. The caller passes the
 * instant it is measuring from — one `Date.now()` per render pass, shared by
 * every row — so the labels agree with each other and refresh when the screen
 * has a reason to: a refetch, a pull, or coming back to the app.
 *
 * `Intl.RelativeTimeFormat` is *not* assumed. Hermes ships a narrower ICU than
 * a browser's and has had partial `Intl` historically, which is the same
 * caution `@sailo/core/currency` takes around `NumberFormat`. Both formatters
 * are built inside a `try`, and the fallback is an absolute date — a truthful
 * answer, where a hand-rolled "2h ago" in English for an Arabic seller would
 * not be. Anything older than a week gets the date regardless: "43 days ago" is
 * arithmetic the reader has to undo.
 */
export function useRelativeTime(locale: string): (iso: string, now: number) => string {
  return useMemo(() => {
    let relative: Intl.RelativeTimeFormat | null = null;
    let absolute: Intl.DateTimeFormat | null = null;
    try {
      relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    } catch {
      relative = null;
    }
    try {
      absolute = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    } catch {
      absolute = null;
    }

    return (iso: string, now: number) => {
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return "";

      // Negative into the past, which is the sign `RelativeTimeFormat` wants.
      const signed = then - now;
      const distance = Math.abs(signed);

      if (!relative || distance >= RELATIVE_LIMIT) {
        /*
         * The ISO slice is a last resort rather than a format choice: the one
         * time it is reached is when this runtime has no `Intl` at all, and
         * `2026-08-14` is at least unambiguous in every locale on earth.
         */
        return absolute ? absolute.format(then) : new Date(then).toISOString().slice(0, 10);
      }
      if (distance < 60_000) return relative.format(Math.round(signed / 1_000), "second");
      if (distance < 3_600_000) return relative.format(Math.round(signed / 60_000), "minute");
      if (distance < DAY_MS) return relative.format(Math.round(signed / 3_600_000), "hour");
      return relative.format(Math.round(signed / DAY_MS), "day");
    };
  }, [locale]);
}

/* -------------------------------------------------------------------------- */
/*  The screen                                                                 */
/* -------------------------------------------------------------------------- */

export default function OrdersScreen() {
  const { t, a, locale } = useT();
  const trpc = useTRPC();
  const router = useRouter();
  const ago = useRelativeTime(locale);

  const [status, setStatus] = useState<Filter>("all");
  const [picking, setPicking] = useState(false);
  /** What is in the box, which changes on every keystroke. */
  const [typed, setTyped] = useState("");
  /** What the server has been asked for, which does not. */
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [typed]);

  const orders = useInfiniteQuery(
    trpc.orders.list.infiniteQueryOptions(
      {
        limit: PAGE,
        // `undefined` rather than "all" and "": the router's input is optional
        // on both, and sending an empty search would be a `%%` LIKE across the
        // whole table for no reason.
        status: status === "all" ? undefined : status,
        search: search || undefined,
      },
      {
        // `null` is the end of the list. `undefined` is what TanStack reads as
        // "there is no next page", so the two are mapped onto each other here
        // rather than left for `hasNextPage` to guess at.
        getNextPageParam: (page) => page.nextCursor ?? undefined,
        // Keeps the rows the seller is looking at on screen while a changed
        // filter loads. Without it, every keystroke's debounce ends in a flash
        // of skeletons where their results were.
        placeholderData: keepPreviousData,
      },
    ),
  );

  /*
   * One list out of however many pages have been fetched. Memoised on the pages
   * themselves, so scrolling — which changes nothing about them — does not
   * rebuild the array on every render and hand the list a new `data`
   * identity to diff.
   */
  const rows = useMemo(
    () => orders.data?.pages.flatMap((page) => page.items) ?? [],
    [orders.data?.pages],
  );

  const narrowed = status !== "all" || search !== "";
  // `isFetching` rather than `isRefetching`, matching the dashboard: the
  // spinner is honest about a background refresh as well as a pulled one. The
  // next page is excluded — that has its own footer, and a pull-to-refresh
  // control spinning because the seller reached the bottom is a lie.
  const refreshing = orders.isFetching && !orders.isPending && !orders.isFetchingNextPage;

  /*
   * One instant for the whole pass, read during render rather than held in
   * state. See `useRelativeTime`: this is what makes every row agree with every
   * other row, and what keeps the list from repainting itself on a timer.
   */
  const now = Date.now();

  const loadMore = useCallback(() => {
    if (!orders.hasNextPage || orders.isFetchingNextPage) return;
    void orders.fetchNextPage();
  }, [orders.hasNextPage, orders.isFetchingNextPage, orders.fetchNextPage]);

  const refresh = useCallback(() => {
    void orders.refetch();
  }, [orders.refetch]);

  const clear = useCallback(() => {
    setStatus("all");
    setTyped("");
    setSearch("");
  }, []);

  const open = useCallback(
    (id: string) => {
      /*
       * The object href rather than a built string: with `typedRoutes` on, the
       * route and its params are checked separately, so a renamed segment or a
       * missing `id` is a compile error instead of a dead tap.
       */
      router.navigate({ pathname: "/orders/[id]", params: { id } });
    },
    [router],
  );

  const statusLabel = status === "all" ? t.shop.all : orderStatusLabel(status, a.orderStatus);

  /*
   * The controls sit above the list rather than inside its header, so they stay
   * put while the rows move. A search box that scrolls away is one a seller has
   * to scroll back up to correct.
   *
   * The sheet travels with them, and that is not tidiness. All three of this
   * screen's returns render this block, so a filter button that opened a sheet
   * mounted only in the third would be a dead tap for as long as the first page
   * is in flight — and a longer one after a failure, which is precisely when a
   * seller wants to take a filter back off.
   *
   * The same reasoning puts the whole block above the early returns: the search
   * text and the filter survive the screen going from skeletons to rows to an
   * error and back, because React reconciles by position and this is position
   * zero in every branch.
   */
  const controls = (
    <>
      <View style={styles.controls}>
        <View style={styles.search}>
          <TextField
            label={t.common.search}
            value={typed}
            onChangeText={setTyped}
            returnKey="search"
          />
        </View>
        {/*
          A sheet rather than a row of chips, and that is `Segmented`'s own
          instruction: it is for three or four options, and past that "the answer
          is a `Sheet` with a list in it, not a smaller font". There are seven
          here — six statuses and the absence of one.
        */}
        <Button
          label={statusLabel}
          icon="filter"
          onPress={() => setPicking(true)}
          accessibilityLabel={`${a.common.status}: ${statusLabel}`}
          testID="orders-filter"
        />
      </View>

      {/* A hairline under the controls, so rows scrolling up read as passing
          *under* the bar rather than as ending at an arbitrary gap. */}
      <Divider spacing="none" />

      <StatusFilter
        visible={picking}
        current={status}
        title={t.shop.filters}
        allLabel={t.shop.all}
        labels={a.orderStatus}
        onPick={(next) => {
          setPicking(false);
          setStatus(next);
        }}
        onClose={() => setPicking(false)}
        closeLabel={a.common.cancel}
      />
    </>
  );

  if (orders.isPending) {
    /*
     * Skeletons rather than a spinner. What is coming is rows, so what stands
     * in for it is row-shaped — a centred spinner collapses the layout and then
     * jumps it back the moment the data lands.
     */
    return (
      <Screen scroll={false} padding="none" gap="none" edges={EDGES} testID="orders-loading">
        {controls}
        <View style={styles.list}>
          <Skeleton shape="row" count={8} />
        </View>
      </Screen>
    );
  }

  if (orders.error) {
    reportQueryError(orders.error, { scope: "mobile:orders:list" });
    return (
      <Screen scroll={false} padding="none" gap="none" edges={EDGES}>
        {controls}
        {/*
          The server's own sentence goes in `detail`, never in place of
          `message` — `ErrorState`'s note says why: a raw error is not an
          explanation, and "No such order." on its own tells a seller nothing
          about what they were doing.
        */}
        <ErrorState
          message={t.errors.title}
          detail={errorMessage(orders.error, t.errors.body)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={orders.isFetching}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padding="none" gap="none" edges={EDGES} testID="orders">
      {controls}

      {/*
        `FlashList` rather than `FlatList`. It recycles row views instead of
        mounting one per item, which is what keeps a seller with several hundred
        orders at sixty frames while they flick — the point at which `FlatList`
        starts dropping them is roughly where a working shop's list begins.

        No `initialNumToRender` / `windowSize` / `removeClippedSubviews`: those
        are `FlatList`'s knobs for a problem `FlashList` does not have, and
        passing them through would read as tuning that is doing nothing.

        Rows are bare `ListRow`s rather than a `GroupedList`, which is the
        component that owns the hairlines between rows — a grouped list takes
        children and cannot window a few hundred of them.
      */}
      <FlashList
        style={styles.listFill}
        data={rows}
        keyExtractor={(order) => order.id}
        renderItem={({ item }) => (
          <OrderRow
            order={item}
            locale={locale}
            statusLabels={a.orderStatus}
            andMore={a.orders.andMore}
            ago={ago}
            now={now}
            onPress={open}
          />
        )}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        onEndReached={loadMore}
        // Half a screen out, so the next page is usually there by the time the
        // seller's thumb arrives.
        onEndReachedThreshold={0.5}
        /*
         * Renders only once the query has answered — the pending branch above
         * returns first — so a seller never reads "No orders yet" about a
         * request that is still in flight. Which sentence it is matters: an
         * empty shop and a filter that matched nothing are different facts, and
         * telling a seller with three hundred orders that they have none
         * because they typed a name wrong is the worse of the two mistakes.
         */
        ListEmptyComponent={
          narrowed ? (
            <EmptyState
              icon="search"
              title={a.orders.noMatches}
              message={a.orders.noMatchesBody}
              action={{ label: a.orders.clearFilters, onPress: clear }}
            />
          ) : (
            <EmptyState icon="orders" title={a.orders.empty} message={a.orders.emptyBody} />
          )
        }
        /*
         * The next page, in the shape of the rows it is about to be. There is
         * nothing to say when the list ends: `nextCursor` went null, the seller
         * has reached the bottom, and a line telling them so is a line that
         * only ever appears at the moment it stops mattering.
         */
        ListFooterComponent={
          orders.isFetchingNextPage ? (
            <View style={styles.footer}>
              <Skeleton shape="row" count={2} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

/**
 * The six statuses and "all of them", as a sheet.
 *
 * Every status the database can hold, in the order `ORDER_STATUSES` declares
 * them, so a filter cannot quietly stop offering one the moment a seller starts
 * using it. There is no count beside each: the server would have to run six
 * more queries to produce them, and a stale count next to a filter is worse
 * than no count at all.
 */
function StatusFilter({
  visible,
  current,
  title,
  allLabel,
  labels,
  onPick,
  onClose,
  closeLabel,
}: {
  visible: boolean;
  current: Filter;
  title: string;
  allLabel: string;
  labels: Record<string, string>;
  onPick: (next: Filter) => void;
  onClose: () => void;
  /** The sheet's close button, in the seller's language. */
  closeLabel: string;
}) {
  const options: { value: Filter; label: string }[] = [
    { value: "all", label: allLabel },
    ...ORDER_STATUSES.map((status) => ({
      value: status as Filter,
      label: orderStatusLabel(status, labels),
    })),
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={title} closeLabel={closeLabel}>
      <GroupedList>
        {options.map((option) => (
          <ListRow
            key={option.value}
            title={option.label}
            /*
             * The tick is the only thing marking the current filter, so it is
             * the one icon here that gets a label of its own — `Icon`'s note is
             * that a glyph beside text should be silent, and this one is not
             * beside text that repeats it.
             */
            accessory={
              option.value === current ? <Icon name="check" accessibilityLabel={title} /> : undefined
            }
            onPress={() => onPick(option.value)}
            testID={`filter-${option.value}`}
          />
        ))}
      </GroupedList>
    </Sheet>
  );
}

/**
 * One order, as a row.
 *
 * `productTitle` and `itemCount` are the order header's own summary of its
 * first line, which is exactly what a list wants and exactly what a detail
 * screen must not trust — `orderItems` is the authoritative list of what was
 * bought, and `[id].tsx` reads that.
 *
 * The subtitle is assembled from what the order actually has rather than padded
 * out with a stand-in: an order placed without a name renders the remaining
 * parts instead of the word "Someone", which was an English literal this app
 * had no dictionary key for and no reason to invent.
 */
function OrderRow({
  order,
  locale,
  statusLabels,
  andMore,
  ago,
  now,
  onPress,
}: {
  order: Order;
  locale: string;
  statusLabels: Record<string, string>;
  /** `a.orders.andMore` — "+ {count} more", still holding its placeholder. */
  andMore: string;
  ago: (iso: string, now: number) => string;
  now: number;
  onPress: (id: string) => void;
}) {
  const status = orderStatusLabel(order.status, statusLabels);
  const amount = formatMoney(order.totalCents, order.currency, locale);
  const subtitle = [
    order.customerName,
    /*
     * The header's `itemCount` counts the order's lines, so this says "and 2
     * more" without a second request. The lines themselves are only fetched on
     * the detail screen, which is where they are rendered.
     */
    order.itemCount > 1 ? interpolate(andMore, { count: order.itemCount - 1 }) : null,
    ago(order.createdAt, now),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ListRow
      title={order.productTitle}
      subtitle={subtitle}
      value={amount}
      accessory={<StatusPill label={status} tone={orderTone(order.status)} size="sm" />}
      trailing="chevron"
      onPress={() => onPress(order.id)}
      /*
       * The row's parts read as one sentence rather than four stops, which is
       * what `ListRow`'s own note asks for: a screen reader announcing "240 AED"
       * on its own has told the seller nothing about which order it belongs to.
       */
      accessibilityLabel={[order.productTitle, subtitle, status, amount].filter(Boolean).join(", ")}
      testID={`order-${order.id}`}
    />
  );
}

/*
 * Layout only — flex and spacing, nothing with a colour, a radius or a font
 * size in it. Every visual decision on this screen belongs to
 * `@sailo/design-native`; what is left is where the boxes sit relative to each
 * other, which is the one thing no component can decide on a screen's behalf.
 */
/**
 * No safe-area edges, and the empty array is the decision rather than an
 * oversight.
 *
 * The stack header above this screen already consumes the top inset and the
 * native tab bar below it consumes the bottom, so claiming either here inserts
 * a second gap. The list handles its own bottom breathing room through
 * `styles.list`, which is also what lets rows scroll *under* the translucent
 * tab bar instead of stopping short of it.
 */
const EDGES = [] as const;

const styles = StyleSheet.create({
  /*
   * The list has to be told to fill what is left of the screen.
   *
   * `FlashList` sets no `flex` of its own, and a scroller inside a column that
   * does not claim one is sized to its *content* — which for a virtualised list
   * is whatever it has rendered so far. The symptom is a list that draws one
   * screenful and then refuses to scroll, or one that pushes the tab bar off
   * the bottom. One line, and it is the line every FlashList needs.
   */
  listFill: { flex: 1 },
  controls: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  search: { flex: 1 },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
  footer: { paddingVertical: 12 },
});
