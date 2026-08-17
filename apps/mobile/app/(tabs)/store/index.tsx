import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import Animated from "react-native-reanimated";
import { useRouter } from "expo-router";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { interpolate } from "@sailo/i18n/native";
import {
  Divider,
  EmptyState,
  ErrorState,
  GroupedList,
  IconButton,
  ListRow,
  Screen,
  Segmented,
  Skeleton,
  TextField,
  rowEntering,
  rowLayout,
  type SegmentedOption,
} from "@sailo/design-system/native";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { useStoreCopy } from "../../../components/store/copy";
import { ProductRow } from "../../../components/store/row";
import { ProductEditor } from "../../../components/store/editor";

/**
 * The catalogue, as the seller's phone shows it.
 *
 * ONE SCREEN AGAIN
 *
 * This file was 1,415 lines and held three things: the list, the 500-line
 * product editor, and every string both use — with `store/[id].tsx` importing
 * the editor and the badge back *out of a route file*. One route importing
 * another means opening the detail screen loads the list screen's module, and
 * it means neither screen's dependencies can be read off its own imports.
 *
 * The reason it was one file was real, and is recorded in
 * `components/store/copy.ts`: Expo Router turns every `.ts` and `.tsx` under
 * `app/` into a route, so there was nowhere beside a screen to put shared code.
 * `components/` is a sibling of `app/` and invisible to the router, which is
 * where the shared halves went — the same solution `lib/auth.ts` already used
 * for the auth screens.
 *
 * What is left here is the list: fetch a page, search it, filter it, push to a
 * product.
 */

const PAGE = 50;

/** Long enough that a word is finished before it is sent; short enough to feel live. */
const SEARCH_DEBOUNCE = 300;

type Status = "all" | "published" | "draft";

export default function StoreScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  const { a, s } = useStoreCopy();

  const [status, setStatus] = useState<Status>("all");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [typed]);

  const shop = useQuery(trpc.shop.get.queryOptions());
  const products = useInfiniteQuery(
    trpc.products.list.infiniteQueryOptions(
      {
        limit: PAGE,
        // `undefined` rather than "all" and "": the router's input is optional
        // on both, and an empty search would be a `%%` LIKE across the whole
        // table for no reason.
        status: status === "all" ? undefined : status,
        search: search || undefined,
      },
      {
        // `null` is the end of the list; `undefined` is what TanStack reads as
        // "no next page". Mapped onto each other here rather than left for
        // `hasNextPage` to guess at.
        getNextPageParam: (page) => page.nextCursor ?? undefined,
        // Keeps the rows the seller is looking at on screen while a changed
        // filter loads, so a debounce does not end in a flash of skeletons
        // where their results were.
        placeholderData: keepPreviousData,
      },
    ),
  );

  const currency = shop.data?.currency ?? "USD";

  /*
   * One list out of however many pages have been fetched, memoised on the pages
   * themselves — scrolling changes nothing about them, and rebuilding the array
   * on every render would hand the list a new `data` identity to diff.
   */
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.items) ?? [],
    [products.data?.pages],
  );

  const narrowed = status !== "all" || search !== "";
  // The next page is excluded: a pull-to-refresh control spinning because the
  // seller reached the bottom is a lie.
  const refreshing =
    products.isFetching && !products.isPending && !products.isFetchingNextPage;

  const loadMore = useCallback(() => {
    if (!products.hasNextPage || products.isFetchingNextPage) return;
    void products.fetchNextPage();
  }, [products.hasNextPage, products.isFetchingNextPage, products.fetchNextPage]);

  const refresh = useCallback(() => {
    void products.refetch();
    void shop.refetch();
  }, [products.refetch, shop.refetch]);

  const open = useCallback(
    (id: string) => router.push({ pathname: "/(tabs)/store/[id]", params: { id } }),
    [router],
  );

  const failed = products.error ?? shop.error;
  if (failed) {
    reportQueryError(failed, { scope: "mobile:store:list" });
    return (
      <Screen scroll={false} edges={EDGES}>
        <ErrorState
          message={s.loadFailed}
          onRetry={refresh}
          retrying={refreshing}
        />
      </Screen>
    );
  }

  const filters: readonly SegmentedOption<Status>[] = [
    { value: "all", label: s.filterAll },
    { value: "published", label: s.filterLive },
    { value: "draft", label: s.filterDraft },
  ];

  return (
    /*
     * `Screen`, and the root it replaces was a bare `<View>` with no `flex` on
     * it at all.
     *
     * That is not a styling nicety. A `View` with no flex sizes to its content,
     * and `FlashList` measures against its parent — so the catalogue was a list
     * with no height to draw in, inside a container that had not claimed the
     * window. `Screen` owns the fill, the page colour and the safe area, and
     * the list gets a bounded height to recycle rows into.
     *
     * `scroll={false}` because the list does the scrolling. A `FlashList` inside
     * a `ScrollView` is a list with unbounded height, which is the same bug
     * from the other direction.
     */
    <Screen scroll={false} padding="none" gap="none" edges={EDGES} testID="store">
      <View style={styles.controls}>
        <Segmented
          options={filters}
          value={status}
          onChange={setStatus}
          accessibilityLabel={a.products.title}
        />

        {/*
          Drawn above the list rather than as its header, so it does not scroll
          away: a seller filtering a long catalogue needs to see and edit the term
          while looking at what it matched.
        */}
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <TextField
              label={s.searchLabel}
              placeholder={s.searchPlaceholder}
              value={typed}
              onChangeText={setTyped}
              returnKey="search"
            />
          </View>
          {/*
            An icon-only add, beside the search rather than under it.

            A full-width primary button between the controls and the list is a
            third band of chrome above a catalogue somebody opened to look at —
            and on a small handset it pushed the first product off the screen.
            `IconButton` requires its own accessible name, which is the whole
            reason it is safe to reduce a labelled button to a glyph.
          */}
          <View style={styles.add}>
            <IconButton
              icon="add"
              variant="tinted"
              size="lg"
              accessibilityLabel={a.products.add}
              onPress={() => setCreating(true)}
            />
          </View>
        </View>
      </View>

      <Divider spacing="none" />

      {products.isPending ? (
        <View style={styles.list}>
          <Skeleton shape="row" count={6} />
        </View>
      ) : (
        <FlashList
          style={styles.listFill}
          contentContainerStyle={styles.list}
          data={rows}
          keyExtractor={(product) => product.id}
          renderItem={({ item, index }) => (
            /* Rows arrive rather than appearing — the same entrance the orders
               list and `Screen` use, so the whole app settles one way. */
            <Animated.View entering={rowEntering(index)} layout={rowLayout}>
              <ProductRow product={item} currency={currency} onPress={() => open(item.id)} />
            </Animated.View>
          )}
          onRefresh={refresh}
          refreshing={refreshing}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          /*
           * The shop's own settings, above the catalogue and scrolling with it.
           *
           * Not in the fixed block with the search and the filter: those two
           * are controls *over this list* and have to stay put while it moves,
           * and a third thing up there that goes somewhere else entirely would
           * push the catalogue down the screen on every visit to buy a
           * destination a seller opens once a week.
           *
           * Here instead, where it is the first thing under the thumb on a
           * pull-down and out of the way the moment they start scrolling.
           */
          ListHeaderComponent={
            <GroupedList>
              <ListRow
                title={a.payments.title}
                subtitle={a.payments.description}
                icon="card"
                trailing="chevron"
                onPress={() => router.push("/store/payments")}
                testID="store-payments"
              />
              <ListRow
                title={a.delivery.title}
                subtitle={a.delivery.description}
                icon="package"
                trailing="chevron"
                onPress={() => router.push("/store/delivery")}
                testID="store-delivery"
              />
              <ListRow
                title={a.coupons.title}
                subtitle={a.coupons.description}
                icon="tag"
                trailing="chevron"
                onPress={() => router.push("/store/coupons")}
                testID="store-coupons"
              />
              <ListRow
                title={a.categories.title}
                subtitle={a.categories.description}
                icon="tag"
                trailing="chevron"
                onPress={() => router.push("/store/categories")}
                testID="store-categories"
              />
            </GroupedList>
          }
          /*
           * `FlashList` recycles row views rather than mounting one per item,
           * which is what holds a long catalogue at sixty frames. Its own
           * windowing is why `FlatList`'s knobs are absent rather than tuned.
           */
          ListEmptyComponent={
            /*
             * "Nothing matched" and "nothing exists" are different facts and
             * get different words — telling a seller with a full catalogue that
             * they have no products because they mistyped is how a working
             * screen reads as a broken one. Only the second gets a button:
             * clearing a search is not what an empty shop needs, and one
             * heading, one line and one action is the whole of an empty state.
             */
            narrowed ? (
              <EmptyState
                title={interpolate(s.noMatches, { term: search })}
                message={s.noMatchesBody}
                icon="search"
              />
            ) : (
              <EmptyState
                title={a.products.empty}
                message={a.products.emptyBody}
                icon="store"
                action={{ label: a.products.addFirst, onPress: () => setCreating(true) }}
              />
            )
          }
          ListFooterComponent={
            products.isFetchingNextPage ? <Skeleton shape="row" count={2} /> : null
          }
        />
      )}

      <ProductEditor
        visible={creating}
        product={null}
        currency={currency}
        onClose={() => setCreating(false)}
        onSaved={(id) => {
          setCreating(false);
          open(id);
        }}
      />
    </Screen>
  );
}


const EDGES = [] as const;

/*
 * Layout only — flex and spacing, nothing with a colour, a radius or a font
 * size in it. Every visual decision on this screen belongs to
 * `@sailo/design-system`.
 */
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
  controls: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  searchRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  search: { flex: 1 },
  /* Nudged up so the glyph sits on the field's centre line rather than on its
     baseline, which is where `alignItems: "flex-end"` would otherwise put it —
     the field is taller than the button by its label. */
  add: { paddingBottom: 0 },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 8 },
});
