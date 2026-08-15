import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { interpolate } from "@sailo/i18n/native";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  Skeleton,
  Text,
} from "@sailo/design-native";
import { formatMoney } from "../../../components/money";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * Which products actually sell, and which are only looked at.
 *
 * `analytics.products` has existed, been tested and returned this exact shape
 * since the analytics package was written, and nothing has ever called it. It
 * is the one question the Insights tab could not answer: the charts say the
 * shop made money and the breakdowns say where the visitors came from, and
 * neither says which of the seller's forty products is carrying the other
 * thirty-nine.
 *
 * CONVERSION IS NULL, NOT ZERO
 *
 * `conversionRate` returns null when a product had no views, and this screen
 * renders that as "—" rather than as 0%. The difference matters: 0% is "people
 * looked and nobody bought", which is a product with a problem, and null is
 * "nobody looked", which is a product with a *marketing* problem. Collapsing
 * them sends a seller to rewrite a description that was never read.
 *
 * PAGED, AND THE PAGE SAYS SO
 *
 * The query answers `{ rows, total, page, perPage }` and the screen prints
 * "top 20 of 380" rather than implying twenty is the catalogue. A silent cap
 * on a performance table is how a seller concludes their long tail sells
 * nothing.
 */
export default function ProductPerformance() {
  const { range } = useLocalSearchParams<{ range?: string }>();
  const { a, t, locale } = useT();
  const trpc = useTRPC();

  const [page, setPage] = useState(1);

  const shop = useQuery(trpc.shop.get.queryOptions());
  const performance = useQuery(
    trpc.analytics.products.queryOptions(
      { range: Number(range) || 30, page },
      /* Paging without this flashes skeletons over a table that already had
         rows in it, which reads as the page reloading rather than advancing. */
      { placeholderData: keepPreviousData },
    ),
  );

  const currency = shop.data?.currency ?? "USD";
  const refresh = useCallback(() => void performance.refetch(), [performance.refetch]);

  if (performance.error) {
    reportQueryError(performance.error, { scope: "mobile:insights:products" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(performance.error, a.dashboard.insightsFailed)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={performance.isFetching}
        />
      </Screen>
    );
  }

  if (performance.isPending) {
    return (
      <Screen>
        <Skeleton shape="card" count={4} />
      </Screen>
    );
  }

  const { rows, total, perPage } = performance.data;
  const shown = (page - 1) * perPage + rows.length;

  if (rows.length === 0) {
    return (
      <Screen scroll={false} center>
        <EmptyState icon="insights" title={a.performance.title} message={a.performance.empty} />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={refresh} refreshing={performance.isFetching} testID="performance">
      {/* Never a silent cap. */}
      {total > perPage ? (
        <Banner
          tone="info"
          message={interpolate(a.performance.showingTop, {
            shown: String(shown),
            total: String(total),
          })}
        />
      ) : null}

      {rows.map((row) => (
        <Card key={row.key} padding="lg">
          <Text variant="heading" numberOfLines={2}>
            {row.title}
          </Text>

          <View style={styles.figures}>
            <Figure label={a.dashboard.views} value={count(row.views, locale)} />
            <Figure label={a.columns.orders} value={count(row.orders, locale)} />
            <Figure
              label={a.performance.revenue}
              value={formatMoney(row.revenueCents, currency, locale)}
            />
            <Figure
              label={a.performance.conversion}
              /*
               * "—" and not "0%". Null means nobody looked, which is a
               * different problem from people looking and not buying, and a
               * seller sent to fix the wrong one wastes an afternoon.
               */
              value={
                row.conversion === null
                  ? "—"
                  : `${(row.conversion * 100).toFixed(1).replace(/\.0$/, "")}%`
              }
            />
          </View>
        </Card>
      ))}

      {total > perPage ? (
        <View style={styles.pager}>
          <Button
            label={a.performance.previous}
            variant="secondary"
            disabled={page === 1}
            onPress={() => setPage((current) => Math.max(1, current - 1))}
          />
          <Button
            label={a.performance.next}
            variant="secondary"
            disabled={shown >= total}
            onPress={() => setPage((current) => current + 1)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

/** One measure and its name, sized so four fit across a phone. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="callout" weight="semibold" tabular numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function count(value: number, locale: string): string {
  try {
    return value.toLocaleString(locale);
  } catch {
    return String(value);
  }
}

const styles = StyleSheet.create({
  figures: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  figure: { minWidth: 72, flexGrow: 1, gap: 2 },
  pager: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
});
