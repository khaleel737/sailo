import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "@sailo/core/currency";
import {
  isLowStock,
  priceRange,
  unitsLeft,
  variantLabel,
  variantPrice,
} from "@sailo/core/variants";
import { interpolate } from "@sailo/i18n/native";
import { captureError } from "@sailo/observability";
import {
  Button,
  Card,
  ErrorState,
  GroupedList,
  ListRow,
  Skeleton,
  Switch,
  Text,
} from "@sailo/design-native";
import type { ProductDetail, ProductVariant } from "../../../lib/models";
import { useReduceMotion } from "../../../lib/a11y";
import { useTRPC } from "../../../lib/query";
import { PublishBadge, ProductEditor, useStoreCopy } from "./index";

/**
 * One product — read, edited, published and deleted.
 *
 * Every derived number here — the headline price, what a variant costs, how
 * many are left — comes out of `@sailo/core/variants` rather than being
 * recomputed. That is the whole reason the package exists: a blank variant
 * price means "same as the product" and a blank stock means "nobody is
 * counting", and a phone that resolved those differently from the storefront
 * would show a seller a price their buyers never see. The router returns
 * variants raw and says so; nothing below re-derives them.
 *
 * IT USED TO SAY IT WAS READ-ONLY, AND WHY THAT CHANGED
 *
 * `packages/api` exposed `products.list` and `products.get` and no mutations,
 * so this screen deliberately offered no control that could not write — a Save
 * button over a missing mutation teaches a seller their edit was kept. A03 has
 * since landed `products.save`, `products.delete` and `products.togglePublished`,
 * so the three controls that were missing are here, each wired to the procedure
 * that actually performs it.
 *
 * The publish switch writes on the tap, like the settings screen's toggles, and
 * renders the value the *server* flipped to rather than the one this screen
 * assumed: `togglePublished` is `not is_published` in SQL, so a phone and an
 * open admin tab tapping at once cannot both read `false` and both write
 * `true`, and the caller that lost has to be told which way it ended up.
 */

export default function ProductDetailScreen() {
  const trpc = useTRPC();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  // Expo Router hands back an array when a path matches more than one segment.
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { s } = useStoreCopy();

  const [product, shop] = useQueries({
    queries: [
      trpc.products.get.queryOptions({ id: id ?? "" }, { enabled: Boolean(id) }),
      trpc.shop.get.queryOptions(),
    ],
  });

  const queries = [product, shop];
  const failed = queries.find((q) => q.error);
  const loading = queries.some((q) => q.isPending);
  const refreshing = queries.some((q) => q.isFetching) && !loading;

  const refresh = useCallback(() => {
    void product.refetch();
    void shop.refetch();
  }, [product.refetch, shop.refetch]);

  /*
   * A route reached without an id is a routing bug, not a network failure, and
   * saying "check your connection" about one sends the seller to their wifi
   * settings over something no amount of retrying will fix.
   */
  if (!id) {
    return (
      <>
        <Stack.Screen options={{ title: "" }} />
        <ErrorState message={s.noProductSelected} />
      </>
    );
  }

  if (failed?.error) {
    captureError(failed.error, { scope: "mobile:store:detail" });
    return (
      <>
        <Stack.Screen options={{ title: "" }} />
        <ErrorState message={s.detailFailed} onRetry={refresh} retrying={refreshing} />
      </>
    );
  }

  if (loading || !product.data) {
    return (
      <>
        <Stack.Screen options={{ title: "" }} />
        <Skeleton shape="card" />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: product.data.title }} />
      <Detail product={product.data} currency={shop.data?.currency ?? "USD"} />
    </>
  );
}

function Detail({ product, currency }: { product: ProductDetail; currency: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { a, locale, s } = useStoreCopy();

  const [editing, setEditing] = useState(false);

  const money = useCallback(
    (minor: number) => formatMoney(minor, currency, locale),
    [currency, locale],
  );

  /*
   * Variants that cost different amounts collapse to a range rather than
   * quoting one combination's price as if it were the product's.
   */
  const { min, max, varies } = priceRange(product, product.variants);
  const compareAt = product.compareAtCents;
  const hasVariants = product.variants.length > 0;
  const left = unitsLeft(product);

  /**
   * The switch writes on the tap. No Save button on a toggle — the settings
   * screen's switches behave the same way, and a control that needs confirming
   * is a checkbox wearing a switch's clothes.
   */
  const publish = useMutation(
    trpc.products.togglePublished.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.products.pathFilter());
        void queryClient.invalidateQueries(trpc.shop.pathFilter());
      },
      onError: (error) => {
        captureError(error, { scope: "mobile:store:togglePublished" });
        Alert.alert(s.publishFailed);
      },
    }),
  );

  const remove = useMutation(
    trpc.products.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.products.pathFilter());
        void queryClient.invalidateQueries(trpc.shop.pathFilter());
        void queryClient.invalidateQueries(trpc.analytics.pathFilter());
        /*
         * Back, not forward. The product this screen is about no longer exists,
         * so staying here would leave a detail view over a row the next refetch
         * answers `NOT_FOUND` for.
         */
        router.back();
      },
      onError: (error) => {
        captureError(error, { scope: "mobile:store:delete" });
        Alert.alert(s.deleteFailed);
      },
    }),
  );

  /*
   * A native `Alert`, not a custom modal: this is the one interaction where the
   * platform's own sheet is what a seller has been trained to read carefully,
   * and a bespoke one reads as part of the app rather than as a warning from
   * the phone. The product is named in the message — "Delete product?" over a
   * list the seller has been scrolling is not enough to be sure which one is
   * about to go — and the destructive style is what puts it in red.
   */
  const confirmDelete = useCallback(() => {
    Alert.alert(
      a.products.deleteProduct,
      interpolate(s.deleteBody, { title: product.title }),
      [
        { text: a.common.cancel, style: "cancel" },
        {
          text: a.common.delete,
          style: "destructive",
          onPress: () => remove.mutate({ id: product.id }),
        },
      ],
    );
  }, [a, s, product.title, product.id, remove]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Gallery product={product} />

      <Text variant="title" heading>
        {product.title}
      </Text>
      <PublishBadge published={product.isPublished} />

      <Text variant="heading">{varies ? `${money(min)} – ${money(max)}` : money(min)}</Text>
      {/*
        Only when it is genuinely more than the price — a compare-at at or below
        what the buyer pays advertises a saving that does not exist.

        The strike-through is the entire difference between this number and the
        one above it, and a strike-through is a drawing. Read aloud the two are
        just two prices for one product, in an order the seller has no reason to
        trust, so the label is what says which is which. `Text` has no
        strike-through variant to ask for yet; the tone is what distinguishes it
        until the design system grows one.
      */}
      {compareAt !== null && compareAt > min ? (
        <Text tone="muted">{interpolate(s.wasPrice, { price: money(compareAt) })}</Text>
      ) : null}

      <Card variant="outlined">
        <Text variant="label" heading>
          {a.productForm.descriptionLabel}
        </Text>
        {product.description?.trim() ? (
          <Text>{product.description}</Text>
        ) : (
          <Text tone="muted">{s.noDescription}</Text>
        )}
      </Card>

      <Card variant="outlined">
        <Text variant="label" heading>
          {a.variants.stock}
        </Text>
        {/*
          A product with options keeps its stock on each variant, so the
          product-level column is empty for reasons that have nothing to do with
          whether anything is in stock. Reading it here would print "Not
          counted" over a product with forty in the back, so this defers to the
          per-variant rows below rather than answering with a number it does not
          have.

          Otherwise: null is "not counting", which is a different answer from
          zero and has to read as one — a seller who turned inventory off should
          not see "Out of stock" on a product they are happily selling.
        */}
        <Text>
          {hasVariants
            ? s.stockPerVariant
            : !product.trackInventory
              ? s.stockUntracked
              : left === null
                ? s.stockUncounted
                : left === 0
                  ? s.stockOut
                  : interpolate(s.stockLeft, { count: left })}
        </Text>
        {!hasVariants && isLowStock(left) ? (
          <Text tone="warning">{s.stockLow}</Text>
        ) : null}
      </Card>

      {hasVariants ? (
        <GroupedList header={a.variants.variant}>
          {product.variants.map((variant) => (
            <VariantRow
              key={variant.id}
              product={product}
              variant={variant}
              currency={currency}
            />
          ))}
        </GroupedList>
      ) : null}

      <GroupedList>
        <Switch
          label={a.productForm.published}
          hint={a.productForm.publishedBody}
          value={product.isPublished}
          busy={publish.isPending}
          onValueChange={() => publish.mutate({ id: product.id })}
        />
      </GroupedList>

      <Button
        label={a.products.edit}
        icon="edit"
        variant="primary"
        fullWidth
        onPress={() => setEditing(true)}
      />

      <Button
        label={remove.isPending ? s.deleting : a.products.deleteProduct}
        icon="delete"
        variant="danger"
        fullWidth
        loading={remove.isPending}
        onPress={confirmDelete}
        // The button itself does not confirm — `danger` says so in its own
        // contract — so the hint is what tells a screen reader that a tap here
        // opens a question rather than doing the thing.
        accessibilityHint={interpolate(s.deleteBody, { title: product.title })}
      />

      <ProductEditor
        visible={editing}
        product={product}
        currency={currency}
        onClose={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    </ScrollView>
  );
}

/**
 * The product's photography, in the order the seller arranged it — the router
 * already sorts `images` by position, so nothing here re-sorts it.
 *
 * The one place on this screen still holding a `StyleSheet`, and deliberately.
 * A paged gallery is sized against the device width at runtime, and
 * `@sailo/design-native` has no image component to ask for one: `Avatar` draws
 * a single rounded thumbnail, which is not this. Requesting a `Gallery` from
 * A01 is the right fix and is in the PR; inlining a local imitation of one
 * would be the thing rule 9 exists to stop.
 */
function Gallery({ product }: { product: ProductDetail }) {
  const { width } = useWindowDimensions();
  const { s } = useStoreCopy();
  /*
   * The cross-fade as a photo decodes is small, but Reduce Motion is a request
   * about all of it, not about the big pieces — and a seller paging through
   * eight product shots meets this one eight times.
   */
  const reduceMotion = useReduceMotion();
  // Full-bleed minus the screen's own gutters, so a photo lines up with the
  // text beneath it at every device width rather than at one hardcoded one.
  const size = width - 40;

  if (product.images.length === 0) {
    return (
      <View style={[styles.placeholder, { width: size, height: size * 0.66 }]}>
        <Text tone="muted">{s.noImages}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      style={{ width: size }}
    >
      {product.images.map((image) => (
        <Image
          key={image.id}
          source={{ uri: image.url }}
          // Falls back to the title: a screen reader on a product whose seller
          // left the alt text blank should still say which product it is.
          alt={image.alt ?? product.title}
          style={{ width: size, height: size * 0.66, borderRadius: 16 }}
          contentFit="cover"
          transition={reduceMotion ? 0 : 150}
        />
      ))}
    </ScrollView>
  );
}

function VariantRow({
  product,
  variant,
  currency,
}: {
  product: ProductDetail;
  variant: ProductVariant;
  currency: string;
}) {
  const { locale, s } = useStoreCopy();
  const left = unitsLeft(product, variant);
  const label = variantLabel(variant.options, product.options) || s.variantDefault;

  const stock =
    !product.trackInventory || left === null
      ? variant.isAvailable
        ? s.available
        : s.unavailable
      : interpolate(s.stockLeft, { count: left });
  const price = formatMoney(variantPrice(product, variant), currency, locale);

  return (
    /*
     * One variant, one stop. Split, the price of the Medium arrives after the
     * stock count of the Large, which is a way to misread a catalogue that only
     * exists for somebody navigating by swipe.
     */
    <ListRow
      title={label}
      subtitle={stock}
      value={price}
      accessibilityLabel={`${label}. ${stock}. ${price}`}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
  placeholder: { alignItems: "center", justifyContent: "center" },
});
