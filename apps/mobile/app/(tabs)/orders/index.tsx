import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import Animated from "react-native-reanimated";
import { useRouter } from "expo-router";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import {
  orderStatusLabel,
} from "@sailo/core/order-status";
import {
  Button,
  Divider,
  EmptyState,
  ErrorState,
  Screen,
  SearchField,
  rowEntering,
  rowLayout,
  Skeleton,
} from "@sailo/design-system/native";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";
import { useRelativeTime } from "../../../components/order/relative-time";
import { StatusFilter, type Filter } from "../../../components/order/status-filter";
import { OrderRow } from "../../../components/order/row";

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
 *
 * WHAT MOVED OUT, AND WHY IT COULD NOT BEFORE
 *
 * This file used to export `orderTone` and `useRelativeTime`, and explained itself: *"every
 * file under `app/` is a route… the ordinary home for a shared helper is
 * `apps/mobile/components/`, which this work order does not own."* Three screens imported a
 * colour mapping from a screen. They are in `components/order/` now, along with the row and
 * the filter sheet this screen renders.
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
        {/*
          A search bar, not a form field.
          This was a `TextField`, which draws a floating label above its input —
          so the control was two lines tall with the word "Search" stranded over
          an empty slab, on the screen whose entire job is finding an order.
          `search-field.tsx` carries the rest.
        */}
        <SearchField
          value={typed}
          onChangeText={setTyped}
          placeholder={t.common.search}
          clearLabel={a.common.cancel}
          testID="orders-search"
        />
        {/*
          A sheet rather than a row of chips, and that is `Segmented`'s own
          instruction: it is for three or four options, and past that "the answer
          is a `Sheet` with a list in it, not a smaller font". There are seven
          here — six statuses and the absence of one.
        */}
        <Button
          label={statusLabel}
          icon="filter"
          size="sm"
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
        renderItem={({ item, index }) => (
          /*
           * The rows arrive rather than appearing.
           *
           * A fade and a short rise, staggered by index and capped at the sixth
           * row — `list-motion.ts` carries why the cap matters on a recycling
           * list. It is the same entrance `Screen` gives its content, so a
           * screen arriving and its list settling read as one gesture.
           *
           * There is deliberately no exit: a row leaves because a filter
           * changed, and making its replacement wait for it makes the filter
           * feel slower than it is.
           */
          <Animated.View entering={rowEntering(index)} layout={rowLayout}>
            <OrderRow
              order={item}
              locale={locale}
              statusLabels={a.orderStatus}
              andMore={a.orders.andMore}
              ago={ago}
              now={now}
              onPress={open}
            />
          </Animated.View>
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
    /* `center`, not `flex-end`. The two controls are now the same height —
       a 38pt search capsule and a 36pt small button — so aligning them on
       their centres is what puts them on one line rather than on a shared
       baseline they no longer have. */
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  search: { flex: 1 },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
  footer: { paddingVertical: 12 },
});
