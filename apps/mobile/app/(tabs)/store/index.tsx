import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { formatMoney } from "@sailo/core/currency";
import { isProductKind, variantLabel } from "@sailo/core/variants";
import { interpolate } from "@sailo/i18n/native";
import {
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  GroupedList,
  IconButton,
  ListRow,
  Screen,
  Segmented,
  Sheet,
  Skeleton,
  StatusPill,
  Switch,
  Text,
  TextField,
  haptics,
  type SegmentedOption,
} from "@sailo/design-native";
/*
 * The price parsers live in `components/money.ts` rather than here.
 *
 * They were written in this file because everything under `app/` becomes a
 * route and there was nowhere else this work order could put them — the header
 * above says so. `components/` is outside `app/`, which makes it the right
 * home now that Delivery and Coupons need the same arithmetic: a fee typed as
 * `12,50` is twelve fifty in French and twelve hundred and fifty in English,
 * and three screens each deciding that for themselves is three chances to
 * charge a seller's buyers a hundred times the wrong amount.
 */
import { priceToText, textToCount, textToPrice } from "../../../components/money";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import type { Product, ProductDetail, RouterInputs } from "../../../lib/models";

/**
 * The catalogue, as the seller's phone shows it — and the editor behind it.
 *
 * Two screens' worth of code in one file, and not by preference. Expo Router
 * turns *every* `.ts` and `.tsx` file under `app/` into a route: the context in
 * `expo-router/_ctx.ios.js` ignores only `+api`, `+html` and `+middleware`, and
 * `_layout` is the one filename `getRoutesCore` treats specially. A
 * `product-editor.tsx` beside this file would become a linkable route with no
 * default export, warning on every dev boot and landing in the typed-`href`
 * union. A06 put its shared half in `lib/auth.ts` for exactly this reason and
 * says so; this work order owns no path outside `app/`, so the shared half
 * lives here and `[id].tsx` imports it — which is also why `PublishBadge` has
 * always been exported from this file rather than from a component module.
 *
 * WHAT READS WHAT
 *
 * `products.list` is keyset-paged and filters server-side: status and search
 * are both in the WHERE, `and`-ed onto `ctx.shopId`. So the search box is a
 * query rather than the honest-but-limited filter over one loaded page it used
 * to be, and the footnote that admitted that limit is gone with it. `shop.get`
 * sits beside it because a product carries `priceCents` and no currency of its
 * own — the shop owns that choice, and every price here is written in it.
 */

/* -------------------------------------------------------------------------- */
/*  Copy                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The sentences this screen needs that `@sailo/i18n/admin` does not have.
 *
 * Everything the admin dictionary already says is read from it — `a.products`,
 * `a.productForm`, `a.variants`, `a.images`, `a.common` — because the web
 * product form and this one are the same form, and translating it twice is how
 * the two drift. What is left is the handful of strings that exist only because
 * this is a phone: a search box the web page does not have, a native discard
 * confirmation, and wording for the refusals `products.save` answers with.
 *
 * Held here rather than in `packages/i18n` because that package is outside this
 * work order's write scope, and following A06's convention exactly: a typed
 * constant, in one place, read through a hook, so that lifting it later is
 * `return useT().a.store` and **no screen changes**. The placeholder syntax is
 * the dictionaries' own — `{term}`, substituted by `interpolate` — so the
 * strings move without being rewritten.
 */
const STORE_COPY = {
  searchLabel: "Search products",
  searchPlaceholder: "Title or link…",
  filterAll: "All",
  filterLive: "Live",
  filterDraft: "Drafts",
  noMatches: "Nothing matches “{term}”",
  noMatchesBody: "Try a shorter word, or clear the search.",
  loadFailed: "Couldn't load your products.",

  /* The editor. */
  newTitle: "New product",
  saving: "Saving…",
  unsavedTitle: "Discard this product?",
  unsavedBody: "Your changes haven't been saved.",
  discard: "Discard",
  keepEditing: "Keep editing",

  /* Deleting, as the native alert says it. */
  deleteBody: "“{title}” will be removed from your shop. This cannot be undone.",
  deleting: "Deleting…",

  /*
   * The detail screen. Here rather than in a second constant beside it: two
   * copy objects for one tab is two places to forget when these lift into
   * `a.store`, and `[id].tsx` already reads this file for `PublishBadge`.
   */
  noProductSelected: "No product was selected.",
  detailFailed: "Couldn't load this product.",
  noImages: "No images",
  noDescription: "No description.",
  /** Stock, in the four answers that are genuinely different from each other. */
  stockPerVariant: "Counted per variant",
  stockUntracked: "Not tracked",
  stockUncounted: "Not counted",
  stockOut: "Out of stock",
  stockLeft: "{count} left",
  stockLow: "Running low.",
  available: "Available",
  unavailable: "Unavailable",
  /** An unlabelled variant is one with no options set. Rare, and it needs a word. */
  variantDefault: "Default",
  /** Said aloud, because the strike-through that means it is a drawing. */
  wasPrice: "Was {price}",

  /**
   * The refusals `products.save` answers with, keyed by the `kind` it puts in
   * the error message. Anything not listed falls back to `saveFailed`: a
   * refusal added server-side must never reach a seller as
   * `membership_needs_interval`.
   */
  refusal: {
    no_title: "Give the product a title.",
    unknown_category: "That category no longer exists.",
    event_needs_start: "An event needs a start time. Add one on the web admin.",
    join_url_not_public: "That join link can't be used.",
    membership_needs_interval: "A membership needs a billing interval.",
    membership_needs_price: "A membership needs a price above zero.",
    product_limit: "You've used every product slot on your plan.",
    not_found: "That product no longer exists.",
  } as Record<string, string>,
  saveFailed: "Couldn't save this product.",
  deleteFailed: "Couldn't delete this product.",
  publishFailed: "Couldn't change whether this is live.",

  /**
   * The two things this screen cannot do yet, said where a seller would look
   * for them rather than left as controls that do nothing.
   *
   * Both are dependencies rather than decisions, and both are in the PR.
   * Downloads are unreadable because `products.get` returns `images` and
   * `variants` and not `files`, while `saveProduct` replaces the file set
   * wholesale — saving a digital product from a screen that cannot see its
   * files would delete every one of them. Photos need `expo-image-picker`,
   * which is not in `apps/mobile/package.json`, a file this work order may not
   * write.
   */
  digitalOnWeb:
    "Digital products are edited on the web admin — the phone can't read their files yet, and saving here would remove them.",
  photosOnWeb: "Photos are added on the web admin for now.",
} as const;

type StoreCopy = typeof STORE_COPY;

/**
 * The dictionary, the local copy and the locale, in one call.
 *
 * `useT()` is what subscribes a component to a language change, so it is called
 * even where only `STORE_COPY` is read — without it a seller switching language
 * would keep the old strings until something unrelated re-rendered. `locale`
 * comes back because money is punctuated per-locale, and a screen that forgot
 * it would write a German seller's prices as an American's.
 */
export function useStoreCopy(): {
  a: ReturnType<typeof useT>["a"];
  locale: string;
  s: StoreCopy;
} {
  const { a, locale } = useT();
  return { a, locale, s: STORE_COPY };
}

/* -------------------------------------------------------------------------- */
/*  Money, in and out of a text field                                          */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  The catalogue                                                              */
/* -------------------------------------------------------------------------- */

/** One page. Fifty is `listInput`'s own default; its ceiling is 100. */
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
          renderItem={({ item }) => (
            <ProductRow product={item} currency={currency} onPress={() => open(item.id)} />
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

function ProductRow({
  product,
  currency,
  onPress,
}: {
  product: Product;
  currency: string;
  onPress: () => void;
}) {
  const { a, locale } = useStoreCopy();

  /*
   * A product with options prices each combination separately, and the list
   * query loads neither the variants nor their prices — so the base price is
   * the only figure this row can stand behind, and the count of combinations
   * beside it is what keeps that honest. Derived from `options`, which the row
   * does carry: the product of the value counts is exactly what `combinations`
   * would enumerate, without loading them in order to count them.
   */
  const choices = product.options.reduce(
    (total, option) => total * Math.max(1, option.values.length),
    product.options.length > 0 ? 1 : 0,
  );
  const subtitle =
    choices === 1
      ? a.products.variantCountOne
      : choices > 1
        ? interpolate(a.products.variantCount, { count: choices })
        : undefined;

  const price = formatMoney(product.priceCents, currency, locale);
  const state = product.isPublished ? a.common.live : a.common.hidden;

  return (
    <ListRow
      title={product.title}
      subtitle={subtitle}
      value={price}
      accessory={<PublishBadge published={product.isPublished} />}
      trailing="chevron"
      onPress={onPress}
      /*
       * Read as one sentence rather than four fragments. The price is in it
       * because it is what a seller opens this list to check, and it is the one
       * thing the title and the badge between them do not say.
       */
      accessibilityLabel={`${product.title}, ${price}, ${state}`}
    />
  );
}

/**
 * Whether buyers can see this at all — the one fact about a product that is
 * invisible from its name and price, and the one a seller most often opens the
 * app to check after adding something.
 */
export function PublishBadge({ published }: { published: boolean }) {
  const { a } = useStoreCopy();
  return (
    <StatusPill
      label={published ? a.common.live : a.common.hidden}
      tone={published ? "success" : "neutral"}
      size="sm"
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  The editor                                                                 */
/* -------------------------------------------------------------------------- */

type SaveInput = RouterInputs["products"]["save"];

/**
 * The draft, as fields rather than as a row.
 *
 * Text, not numbers, for everything the seller types into. A price mid-edit is
 * `"12."` and a stock count mid-edit is `""`, and neither is a number yet;
 * parsing on every keystroke would fight the keyboard, turning `12.` back into
 * `12` and moving the cursor so the fraction can never be typed at all.
 */
type Draft = {
  title: string;
  description: string;
  price: string;
  compareAt: string;
  tags: string;
  trackInventory: boolean;
  stockQuantity: string;
  inStock: boolean;
  isFeatured: boolean;
  isPublished: boolean;
  /** Keyed by the variant's own id, so a re-render cannot re-key the map. */
  variants: Record<string, { price: string; stock: string; available: boolean }>;
};

function draftFrom(
  product: ProductDetail | null,
  currency: string,
  locale: string,
): Draft {
  if (!product) {
    return {
      title: "",
      description: "",
      price: "",
      compareAt: "",
      tags: "",
      trackInventory: false,
      stockQuantity: "",
      /*
       * The defaults the web form opens a new product on. A product created on
       * the phone has to be row-identical to one created there, and these are
       * two of the columns that would otherwise quietly differ.
       */
      inStock: true,
      isFeatured: false,
      isPublished: true,
      variants: {},
    };
  }

  return {
    title: product.title,
    description: product.description ?? "",
    price: priceToText(product.priceCents, currency, locale),
    compareAt:
      product.compareAtCents === null
        ? ""
        : priceToText(product.compareAtCents, currency, locale),
    tags: product.tags.join(", "),
    trackInventory: product.trackInventory,
    stockQuantity: product.stockQuantity === null ? "" : String(product.stockQuantity),
    inStock: product.inStock,
    isFeatured: product.isFeatured,
    isPublished: product.isPublished,
    variants: Object.fromEntries(
      product.variants.map((variant) => [
        variant.id,
        {
          price:
            variant.priceCents === null
              ? ""
              : priceToText(variant.priceCents, currency, locale),
          stock: variant.stockQuantity === null ? "" : String(variant.stockQuantity),
          available: variant.isAvailable,
        },
      ]),
    ),
  };
}

/**
 * The draft as `products.save` wants it — the whole product, every time.
 *
 * **This is a replace, not a patch.** `saveProduct` rewrites every editable
 * column from what it is handed and re-derives the image, variant and file sets
 * wholesale, so a field left out of this object is not left alone: it is reset
 * to the column default. That is why everything `products.get` returned is
 * carried back whether or not this sheet drew it — the event's start time, the
 * membership's interval, the service's duration, the digital delivery settings.
 * A product edited on a phone comes out of the database identical to the same
 * edit made in a browser, which is the bar this screen is held to.
 *
 * The one set that cannot be carried back is `files`, because `products.get`
 * does not return it. That is why a digital product is refused outright rather
 * than saved with an empty file list — see `digitalOnWeb`.
 */
function toSaveInput(
  draft: Draft,
  product: ProductDetail | null,
  currency: string,
  locale: string,
): SaveInput {
  return {
    id: product?.id ?? null,
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    priceCents: textToPrice(draft.price, currency, locale) ?? 0,
    compareAtCents: textToPrice(draft.compareAt, currency, locale),
    // `kind` is a text column, so it is narrowed rather than asserted: a row
    // holding something this build has never heard of falls back to the same
    // default `saveProduct` would have chosen for it.
    kind: product && isProductKind(product.kind) ? product.kind : "physical",
    categoryId: product?.categoryId ?? null,
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    options: product?.options ?? [],
    variants: (product?.variants ?? []).map((variant) => {
      const edited = draft.variants[variant.id];
      return {
        options: variant.options,
        sku: variant.sku,
        priceCents: edited
          ? textToPrice(edited.price, currency, locale)
          : variant.priceCents,
        compareAtCents: variant.compareAtCents,
        stockQuantity: edited ? textToCount(edited.stock) : variant.stockQuantity,
        isAvailable: edited ? edited.available : variant.isAvailable,
        imageUrl: variant.imageUrl,
      };
    }),
    // In the order the router returned them, which is `position`. The gallery's
    // order is the seller's, and re-sorting it here would shuffle their shop.
    imageUrls: (product?.images ?? []).map((image) => image.url),

    trackInventory: draft.trackInventory,
    stockQuantity: draft.trackInventory ? textToCount(draft.stockQuantity) : null,

    releaseOnPayment: product?.releaseOnPayment ?? true,
    downloadLimit: product?.downloadLimit ?? null,
    downloadExpiryDays: product?.downloadExpiryDays ?? null,

    durationMinutes: product?.durationMinutes ?? null,
    serviceMode: product?.serviceMode === "online" ? "online" : "in_person",
    serviceLocation: product?.serviceLocation ?? null,
    bookingEnabled: product?.bookingEnabled ?? false,
    bookingLeadHours: product?.bookingLeadHours ?? 0,

    eventStartsAt: product?.eventStartsAt ?? null,
    eventJoinUrl: product?.eventJoinUrl ?? null,

    billingInterval: product?.billingInterval ?? null,
    trialDays: product?.trialDays ?? null,

    inStock: draft.inStock,
    isFeatured: draft.isFeatured,
    isPublished: draft.isPublished,
  };
}

/**
 * The refusal `products.save` answered with, as something to show a seller.
 *
 * The server puts the machine-readable kind in `message` and leaves the wording
 * to us — its own comment says so, and points here. An unrecognised kind falls
 * back rather than rendering a raw enum.
 */
function refusalText(error: unknown, copy: StoreCopy): string {
  if (error instanceof TRPCClientError) {
    const known = copy.refusal[error.message];
    if (known) return known;
  }
  return copy.saveFailed;
}

/**
 * Create or edit, in a sheet.
 *
 * `size="large"` because this scrolls, and the sheet owns that scrolling rather
 * than the screen — a `ScrollView` in here would nest inside the one the design
 * system draws. `dismissible` goes off the moment there is unsaved input, so a
 * swipe-down cannot throw away a product the seller spent two minutes typing;
 * that is the single case the component permits it for, and Cancel then asks
 * before discarding rather than taking the way out away entirely.
 */
export function ProductEditor({
  visible,
  product,
  currency,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** `null` creates. Anything else is a full read from `products.get`. */
  product: ProductDetail | null;
  currency: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { a, locale, s } = useStoreCopy();

  const [draft, setDraft] = useState<Draft>(() => draftFrom(product, currency, locale));
  const [dirty, setDirty] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  /*
   * Re-seeded when the sheet opens, not on every render. Reopening on a product
   * the seller just edited has to show what is now stored; a sheet that kept
   * its old draft would silently re-submit a stale price over a newer one.
   */
  useEffect(() => {
    if (!visible) return;
    setDraft(draftFrom(product, currency, locale));
    setDirty(false);
    setRefused(null);
  }, [visible, product, currency, locale]);

  const edit = useCallback((patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  }, []);

  const setVariant = useCallback(
    (id: string, patch: Partial<Draft["variants"][string]>) => {
      setDraft((current) => {
        const existing = current.variants[id];
        if (!existing) return current;
        return {
          ...current,
          variants: { ...current.variants, [id]: { ...existing, ...patch } },
        };
      });
      setDirty(true);
    },
    [],
  );

  const save = useMutation(
    trpc.products.save.mutationOptions({
      onSuccess: (result) => {
        // Publishing or unpublishing changes what a buyer can see, which is
        // worth confirming through the hand as well as the screen.
        haptics.success();
        /*
         * The whole namespace rather than the one page. A saved product changes
         * its own row, the page it sits on, and — for a new one — every
         * filtered list that should now contain it. `shop` and `analytics` go
         * with it because the Home checklist counts products: a draft still
         * ticks the `product` step, and a seller who just added their first one
         * must not have to pull to refresh to watch it tick.
         */
        void queryClient.invalidateQueries(trpc.products.pathFilter());
        void queryClient.invalidateQueries(trpc.shop.pathFilter());
        void queryClient.invalidateQueries(trpc.analytics.pathFilter());
        setDirty(false);
        onSaved(result.id);
      },
      onError: (error) => {
        reportQueryError(error, { scope: "mobile:store:save" });
        setRefused(refusalText(error, s));
      },
    }),
  );

  /*
   * A digital product's files are invisible to this screen, and `saveProduct`
   * rebuilds the file set from what it is handed — so saving one here would
   * delete every download the seller sells. Refused as a rendered state with
   * somewhere to go, rather than as a Save button that quietly destroys data.
   */
  const refusesDigital = product?.kind === "digital";

  const canSave =
    !refusesDigital &&
    draft.title.trim().length > 0 &&
    textToPrice(draft.price, currency, locale) !== null &&
    !save.isPending;

  const close = useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert(s.unsavedTitle, s.unsavedBody, [
      { text: s.keepEditing, style: "cancel" },
      { text: s.discard, style: "destructive", onPress: onClose },
    ]);
  }, [dirty, onClose, s]);

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={product ? a.products.edit : s.newTitle}
      size="large"
      dismissible={!dirty}
    >
      {refusesDigital ? (
        <Card variant="outlined">
          <Text tone="warning">{s.digitalOnWeb}</Text>
        </Card>
      ) : null}

      {refused ? (
        <Card variant="outlined">
          <Text tone="danger">{refused}</Text>
        </Card>
      ) : null}

      {product ? null : <Text tone="muted">{a.products.newSubtitle}</Text>}

      <TextField
        label={a.productForm.titleLabel}
        placeholder={a.productForm.titlePlaceholder}
        value={draft.title}
        onChangeText={(title) => edit({ title })}
        maxLength={200}
        autoFocus={!product}
        disabled={refusesDigital}
      />

      <TextField
        label={a.productForm.descriptionLabel}
        placeholder={a.productForm.descriptionPlaceholder}
        value={draft.description}
        onChangeText={(description) => edit({ description })}
        multiline
        maxLength={10_000}
        disabled={refusesDigital}
      />

      <TextField
        label={interpolate(a.productForm.price, { currency })}
        value={draft.price}
        onChangeText={(price) => edit({ price })}
        keyboard="decimal"
        disabled={refusesDigital}
      />

      <TextField
        label={a.productForm.compareAt}
        value={draft.compareAt}
        onChangeText={(compareAt) => edit({ compareAt })}
        keyboard="decimal"
        disabled={refusesDigital}
      />

      <TextField
        label={a.productForm.tags}
        hint={a.productForm.tagsHint}
        placeholder={a.productForm.tagsPlaceholder}
        value={draft.tags}
        onChangeText={(tags) => edit({ tags })}
        disabled={refusesDigital}
      />

      <GroupedList header={a.productForm.optionsTitle}>
        <Switch
          label={a.productForm.trackStock}
          hint={a.productForm.trackStockBody}
          value={draft.trackInventory}
          onValueChange={(trackInventory) => edit({ trackInventory })}
          disabled={refusesDigital}
        />
        {/*
          Drawn only where it can mean something. Stock lives on the variants
          once a product has options — `saveProduct` nulls the product-level
          count in that case — so showing the field there would offer a number
          the server throws away.
        */}
        {draft.trackInventory && (product?.variants.length ?? 0) === 0 ? (
          <TextField
            label={a.variants.unitsInStock}
            hint={a.variants.unitsHint}
            value={draft.stockQuantity}
            onChangeText={(stockQuantity) => edit({ stockQuantity })}
            keyboard="number"
            disabled={refusesDigital}
          />
        ) : null}
        <Switch
          label={a.productForm.inStock}
          hint={a.productForm.inStockBody}
          value={draft.inStock}
          onValueChange={(inStock) => edit({ inStock })}
          disabled={refusesDigital}
        />
        <Switch
          label={a.productForm.featured}
          hint={a.productForm.featuredBody}
          value={draft.isFeatured}
          onValueChange={(isFeatured) => edit({ isFeatured })}
          disabled={refusesDigital}
        />
        <Switch
          label={a.productForm.published}
          hint={a.productForm.publishedBody}
          value={draft.isPublished}
          onValueChange={(isPublished) => edit({ isPublished })}
          disabled={refusesDigital}
        />
      </GroupedList>

      {/*
        Prices and counts for combinations that already exist. Defining the
        options themselves — adding a Size, renaming a Colour — stays on the web
        admin: `saveProduct` drops every variant whose combination the new
        options no longer describe, so a half-built option set typed on a phone
        would delete rows that past orders point at.
      */}
      {product && product.variants.length > 0 ? (
        <GroupedList header={a.variants.variant} footer={a.variants.footnote}>
          {product.variants.map((variant) => {
            const edited = draft.variants[variant.id];
            if (!edited) return null;
            const label = variantLabel(variant.options, product.options);
            return (
              <View key={variant.id}>
                <TextField
                  label={`${label} · ${interpolate(a.variants.priceIn, { currency })}`}
                  hint={a.variants.intro}
                  value={edited.price}
                  onChangeText={(price) => setVariant(variant.id, { price })}
                  keyboard="decimal"
                  disabled={refusesDigital}
                />
                {draft.trackInventory ? (
                  <TextField
                    label={`${label} · ${a.variants.stock}`}
                    hint={a.variants.unitsHint}
                    value={edited.stock}
                    onChangeText={(stock) => setVariant(variant.id, { stock })}
                    keyboard="number"
                    disabled={refusesDigital}
                  />
                ) : null}
                <Switch
                  label={`${label} · ${a.variants.forSale}`}
                  value={edited.available}
                  onValueChange={(available) => setVariant(variant.id, { available })}
                  disabled={refusesDigital}
                />
              </View>
            );
          })}
        </GroupedList>
      ) : null}

      {/*
        The gallery, in `position` order, so a seller can see what a buyer sees.
        There is no add and no reorder here — both need a picker this build does
        not have, and a footer that says so beats a control that opens nothing.
      */}
      {product && product.images.length > 0 ? (
        <GroupedList header={a.productForm.photos} footer={s.photosOnWeb}>
          {product.images.map((image, index) => (
            <ListRow
              key={image.id}
              title={index === 0 ? a.images.cover : String(index + 1)}
              subtitle={image.alt ?? undefined}
            />
          ))}
        </GroupedList>
      ) : null}

      <Button
        label={save.isPending ? s.saving : a.common.save}
        variant="primary"
        fullWidth
        loading={save.isPending}
        disabled={!canSave}
        onPress={() => save.mutate(toSaveInput(draft, product, currency, locale))}
      />
      <Button label={a.common.cancel} variant="ghost" fullWidth onPress={close} />
    </Sheet>
  );
}

/** No safe-area edges — the stack header owns the top, the tab bar the bottom.
 *  `orders/index.tsx` carries the longer note on why an empty list is the
 *  right answer here rather than an omission. */
const EDGES = [] as const;

/*
 * Layout only — flex and spacing, nothing with a colour, a radius or a font
 * size in it. Every visual decision on this screen belongs to
 * `@sailo/design-native`.
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
