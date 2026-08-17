import { StyleSheet, View } from "react-native";
import { interpolate } from "@sailo/i18n/native";
import { ListRow, StatusPill } from "@sailo/design-system/native";
import { formatMoney } from "@sailo/core/currency";
import { variantLabel } from "@sailo/core/variants";
import type { Product } from "../../lib/models";
import { useStoreCopy } from "./copy";

/**
 * One product in the seller's list, and the badge that says whether buyers can
 * see it.
 *
 * `PublishBadge` is exported because `store/[id].tsx` shows the same badge on
 * the detail screen. It used to import it from `store/index.tsx` — one route
 * file reaching into another — which is the arrangement this file exists to
 * end.
 */

export function ProductRow({
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
      valueTone="strong"
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

