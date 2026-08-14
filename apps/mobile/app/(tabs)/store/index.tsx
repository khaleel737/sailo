import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useQueries } from "@tanstack/react-query";
import { formatMoney } from "@sailo/core/currency";
import { captureError } from "@sailo/observability";
import type { Product } from "../../../lib/models";
import { useTRPC } from "../../../lib/query";
import { Empty, ErrorState, Loading, errorMessage } from "../../../components/states";

/**
 * The catalogue, as the seller's phone shows it.
 *
 * Two reads, not one: `products.list` is the catalogue, and `shop.get` is the
 * currency every price on this screen is written in — products carry
 * `priceCents` and no currency of their own, because the shop owns that
 * choice. Both go through the same query cache the dashboard already filled,
 * so arriving here from the home screen paints instantly and revalidates in
 * the background rather than re-fetching from scratch.
 */

/**
 * One page, and the search below filters within it.
 *
 * `products.list` takes a `limit` and nothing else — there is no server-side
 * search in the contract — so "search" here is honestly a filter over what
 * has been loaded, not a query. At 100 that covers the whole catalogue for
 * almost every shop on the platform; past it the seller is filtering their
 * hundred most recent products and the footer below says so rather than
 * quietly implying the rest do not match.
 */
const LIMIT = 100;

export default function ProductsScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const [products, shop] = useQueries({
    queries: [
      trpc.products.list.queryOptions({ limit: LIMIT }),
      trpc.shop.get.queryOptions(),
    ],
  });

  const queries = [products, shop];
  const failed = queries.find((q) => q.error);
  const loading = queries.some((q) => q.isPending);
  const refreshing = queries.some((q) => q.isFetching) && !loading;

  const refresh = useCallback(() => {
    void products.refetch();
    void shop.refetch();
  }, [products.refetch, shop.refetch]);

  const currency = shop.data?.currency ?? "USD";
  // `.items`, because the list is paged — `nextCursor` beside it says whether
  // there is another page, which is what the footnote below now reads.
  const all = useMemo(() => products.data?.items ?? [], [products.data]);

  /*
   * Case- and whitespace-insensitive, because a seller hunting for "Blue Mug"
   * types `blue mug`, ` mug`, or `MUG` and means the same product every time.
   * Memoised on the query and the term rather than recomputed per keystroke
   * render — a hundred rows is cheap, but this also runs on every unrelated
   * re-render the list does while scrolling.
   */
  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () => (term ? all.filter((p) => p.title.toLowerCase().includes(term)) : all),
    [all, term],
  );

  if (failed?.error) {
    captureError(failed.error, { scope: "mobile:products:list" });
    return (
      <ErrorState
        message={errorMessage(failed.error, "Couldn't load your products.")}
        onRetry={refresh}
        retrying={refreshing}
      />
    );
  }

  if (loading) return <Loading />;

  return (
    <View style={styles.screen}>
      {/*
        Rendered above the list rather than as `ListHeaderComponent` so it does
        not scroll away: a seller filtering a long catalogue needs to see and
        edit the term while looking at what it matched.
      */}
      <View style={styles.searchWrap}>
        {/*
          The placeholder vanishes as soon as the seller types, taking the only
          description of the field with it — see the same note on the sign-in
          inputs. Same words, said durably.
        */}
        <TextInput
          style={styles.search}
          placeholder="Search products"
          accessibilityLabel="Search products"
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(product) => product.id}
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            currency={currency}
            onPress={() => router.push(`/(tabs)/store/${item.id}`)}
          />
        )}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#4f46e5" />
        }
        /*
         * "Nothing matched" and "nothing exists" are different facts and get
         * different words. Telling a seller with a full catalogue that they
         * have no products because they mistyped a search is how a working
         * screen reads as a broken one.
         */
        ListEmptyComponent={
          term ? (
            <Empty
              title={`No products match “${search.trim()}”`}
              hint="Try a shorter word, or clear the search."
            />
          ) : (
            <Empty
              title="No products yet"
              hint="Products you add to your shop will appear here."
            />
          )
        }
        ListFooterComponent={
          products.data?.nextCursor ? (
            <Text style={styles.footnote}>
              Showing your {LIMIT} most recent products.
            </Text>
          ) : null
        }
      />
    </View>
  );
}

function ProductRow({
  product,
  currency,
  onPress,
}: {
  product: Product;
  currency: string;
  onPress: () => void;
}) {
  /*
   * A product with options prices each combination separately, and the list
   * query does not load them — so the base price is the only figure this row
   * can stand behind. "from" is what keeps that honest: quoting a flat number
   * for a product whose medium costs more would be wrong on the row that the
   * seller is most likely to trust at a glance.
   */
  const varies = product.options.length > 0;
  const price = formatMoney(product.priceCents, currency);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      /*
       * The price was the one thing the old label left out, and it is the
       * thing a seller opens this list to check. `from` is carried across for
       * the same reason it is drawn: a flat number on a product whose variants
       * cost more is a price the seller does not actually charge.
       */
      accessibilityLabel={`${product.title}, ${varies ? `from ${price}` : price}, ${
        product.isPublished ? "live" : "draft"
      }`}
      accessibilityHint="Opens this product"
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {product.title}
        </Text>
        <Text style={styles.rowSub}>{varies ? `from ${price}` : price}</Text>
      </View>
      <PublishBadge published={product.isPublished} />
    </Pressable>
  );
}

/**
 * Whether buyers can see this at all — the one fact about a product that is
 * invisible from its name and price, and the one a seller most often opens the
 * app to check after adding something.
 */
export function PublishBadge({ published }: { published: boolean }) {
  return (
    <View style={[styles.badge, published ? styles.badgeLive : styles.badgeDraft]}>
      <Text style={[styles.badgeText, published ? styles.badgeTextLive : styles.badgeTextDraft]}>
        {published ? "Live" : "Draft"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  searchWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  search: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#f9fafb",
  },
  list: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  rowPressed: { opacity: 0.6 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#111827" },
  rowSub: { fontSize: 13, color: "#6b7280" },
  footnote: {
    paddingTop: 16,
    fontSize: 12,
    color: "#9ca3af",
    textAlign: "center",
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeLive: { backgroundColor: "#ecfdf5" },
  badgeDraft: { backgroundColor: "#f3f4f6" },
  badgeText: { fontSize: 12, fontWeight: "700" },
  badgeTextLive: { color: "#047857" },
  badgeTextDraft: { color: "#6b7280" },
});
