import { useCallback } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useQueries } from "@tanstack/react-query";
import { formatMoney } from "@sailo/core/currency";
import {
  isLowStock,
  priceRange,
  unitsLeft,
  variantLabel,
  variantPrice,
} from "@sailo/core/variants";
import { captureError } from "@sailo/observability";
import type { ProductDetail, ProductVariant } from "../../../lib/models";
import { useReduceMotion } from "../../../lib/a11y";
import { useTRPC } from "../../../lib/query";
import { ErrorState, Loading, errorMessage } from "../../../components/states";
import { PublishBadge } from "./index";

/**
 * One product, read.
 *
 * Every derived number on this screen — the headline price, what a variant
 * costs, how many are left — comes out of `@sailo/core/variants` rather than
 * being recomputed here. That is the whole reason the package exists: a blank
 * variant price means "same as the product" and a blank stock means "nobody is
 * counting", and a phone that guessed differently from the storefront would
 * show a seller a price their buyers never see.
 *
 * READ-ONLY, and not by preference. `packages/api` exposes `products.list` and
 * `products.get` and no product mutations at all — there is no `products.update`
 * to save a title to, no way to flip `isPublished`, and no procedure that
 * attaches an uploaded image to a product. So this screen shows the fields an
 * editor would own and offers no control that cannot actually write. A Save
 * button over a missing mutation is worse than no button: it teaches the
 * seller their edit was kept.
 */

export default function ProductDetailScreen() {
  const trpc = useTRPC();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  // Expo Router hands back an array when a path matches more than one segment.
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

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
        <Stack.Screen options={{ title: "Product" }} />
        <ErrorState message="No product was selected." onRetry={refresh} />
      </>
    );
  }

  if (failed?.error) {
    captureError(failed.error, { scope: "mobile:products:detail" });
    return (
      <>
        <Stack.Screen options={{ title: "Product" }} />
        <ErrorState
          // The server says "No such product." for an id that isn't in this
          // shop, which is a better sentence than anything this file could
          // invent for it.
          message={errorMessage(failed.error, "Couldn't load this product.")}
          onRetry={refresh}
          retrying={refreshing}
        />
      </>
    );
  }

  if (loading || !product.data) {
    return (
      <>
        <Stack.Screen options={{ title: "Product" }} />
        <Loading />
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
  const money = (minor: number) => formatMoney(minor, currency);

  /*
   * Variants that cost different amounts collapse to a range rather than
   * quoting one combination's price as if it were the product's.
   */
  const { min, max, varies } = priceRange(product, product.variants);
  const compareAt = product.compareAtCents;
  const hasVariants = product.variants.length > 0;
  const left = unitsLeft(product);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Gallery product={product} />

      <View style={styles.headline}>
        <Text style={styles.title} accessibilityRole="header">
          {product.title}
        </Text>
        <PublishBadge published={product.isPublished} />
      </View>

      <View style={styles.priceRow}>
        <Text style={styles.price}>
          {varies ? `${money(min)} – ${money(max)}` : money(min)}
        </Text>
        {/*
          Only when it is genuinely more than the price — a compare-at at or
          below what the buyer pays advertises a saving that does not exist.

          The strike-through is the entire difference between this number and
          the one beside it, and a strike-through is a drawing. Read aloud the
          two are just two prices for one product, in an order the seller has
          no reason to trust. The label is what says which is which.
        */}
        {compareAt !== null && compareAt > min ? (
          <Text
            style={styles.compareAt}
            accessibilityLabel={`Was ${money(compareAt)}`}
          >
            {money(compareAt)}
          </Text>
        ) : null}
      </View>

      <Field label="Description">
        {product.description?.trim() ? (
          <Text style={styles.body}>{product.description}</Text>
        ) : (
          <Text style={styles.muted}>No description.</Text>
        )}
      </Field>

      <Field label="Stock">
        <Text style={styles.body}>
          {/*
            A product with options keeps its stock on each variant, so the
            product-level column is empty for reasons that have nothing to do
            with whether anything is in stock. Reading it here would print
            "Not counted" over a product with forty in the back, so this defers
            to the per-variant rows below instead of answering with a number it
            does not have.

            Otherwise: null is "not counting", which is a different answer from
            zero and has to read as one — a seller who turned inventory off
            should not see "Out of stock" on a product they are happily selling.
          */}
          {hasVariants
            ? "Counted per variant"
            : !product.trackInventory
              ? "Not tracked"
              : left === null
                ? "Not counted"
                : left === 0
                  ? "Out of stock"
                  : `${left} left`}
        </Text>
        {!hasVariants && isLowStock(left) ? (
          <Text style={styles.warn}>Running low.</Text>
        ) : null}
      </Field>

      {hasVariants ? (
        <Field label={`Variants (${product.variants.length})`}>
          {product.variants.map((variant) => (
            <VariantRow
              key={variant.id}
              product={product}
              variant={variant}
              currency={currency}
            />
          ))}
        </Field>
      ) : null}
    </ScrollView>
  );
}

/**
 * The product's photography, in the order the seller arranged it — the router
 * already sorts `images` by position, so nothing here re-sorts it.
 */
function Gallery({ product }: { product: ProductDetail }) {
  const { width } = useWindowDimensions();
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
        <Text style={styles.muted}>No images</Text>
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
  const left = unitsLeft(product, variant);
  const label = variantLabel(variant.options, product.options);

  const stock =
    !product.trackInventory || left === null
      ? variant.isAvailable
        ? "Available"
        : "Unavailable"
      : `${left} left`;
  const price = formatMoney(variantPrice(product, variant), currency);

  return (
    /*
     * One variant, one stop. Split, the price of the Medium arrives after the
     * stock count of the Large, which is a way to misread a catalogue that
     * only exists for somebody navigating by swipe.
     */
    <View
      style={styles.variant}
      accessible
      accessibilityLabel={`${label || "Default"}. ${stock}. ${price}`}
    >
      <View style={styles.variantMain}>
        {/* An unlabelled variant is one with no options set — rare, but it
            renders as an empty row unless it says something. */}
        <Text style={styles.variantLabel}>{label || "Default"}</Text>
        <Text style={styles.variantSub}>{stock}</Text>
      </View>
      <Text style={styles.variantPrice}>{price}</Text>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel} accessibilityRole="header">
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  content: { padding: 20, paddingBottom: 48, gap: 20 },
  headline: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontSize: 24, fontWeight: "800", color: "#111827" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  price: { fontSize: 20, fontWeight: "700", color: "#111827" },
  compareAt: {
    fontSize: 15,
    color: "#9ca3af",
    textDecorationLine: "line-through",
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  field: { gap: 6 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  body: { fontSize: 15, color: "#111827", lineHeight: 22 },
  muted: { fontSize: 14, color: "#9ca3af" },
  warn: { fontSize: 13, color: "#b45309" },
  variant: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  variantMain: { flex: 1, gap: 2 },
  variantLabel: { fontSize: 15, fontWeight: "600", color: "#111827" },
  variantSub: { fontSize: 13, color: "#6b7280" },
  variantPrice: { fontSize: 15, fontWeight: "700", color: "#111827" },
});
