import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useQueries } from "@tanstack/react-query";
import { formatMoney } from "@sailo/core/currency";
import { interpolate } from "@sailo/i18n/native";
import {
  Banner,
  Card,
  Chart,
  EmptyState,
  ErrorState,
  GroupedList,
  ListRow,
  Screen,
  Segmented,
  Skeleton,
  Stat,
  Text,
} from "@sailo/design-native";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * Insights — what happened, told honestly, including when nothing did.
 *
 * The screen is built around one rule that is easier to state than to hold:
 * **nothing is plotted until there is something to plot.** A brand-new shop has
 * no visits and no revenue, and the tempting thing to draw is an axis anyway —
 * which is what Stan's app does, rendering a $0.00–$0.08 revenue scale and a
 * "where are my customers from" bar chart containing one bar labelled "Other".
 * Both are charts of nothing with invented precision, and both are the first
 * thing a new seller ever sees. `Chart` takes an `emptyMessage` for exactly
 * this reason; the breakdowns below simply do not render under a threshold.
 *
 * The second rule is that a clamp is never silent. A seller on the free plan
 * who asks for a year gets thirty days, and the server says so through
 * `window.clamped` — so the range control says which ranges their plan reaches
 * rather than quietly serving a shorter one and letting them read it as a year
 * in which nothing happened.
 */

/**
 * The presets the control offers, shortest first.
 *
 * A subset of `ANALYTICS_RANGES` — the full list runs to three years, which is
 * a laptop question. What a seller checks on a phone is "this week", "this
 * month", "this quarter", and the segmented control stops being tappable past
 * four options on a narrow screen.
 */
const RANGES = [7, 30, 90] as const;

/** Below this, a ranking is one data point wearing a chart's clothes. */
const MIN_BREAKDOWN_ROWS = 2;

export default function Insights() {
  const { a, t, locale } = useT();
  const trpc = useTRPC();
  const [range, setRange] = useState<string>("30");

  const [shop, stats, series, breakdown] = useQueries({
    queries: [
      /* Only for the currency the money is formatted in — cached and shared
         with Home, so this costs nothing after the first tab switch. */
      trpc.shop.get.queryOptions(),
      trpc.analytics.stats.queryOptions({ range: Number(range) }),
      trpc.analytics.series.queryOptions({ range: Number(range) }),
      trpc.analytics.breakdown.queryOptions({ range: Number(range) }),
    ],
  });

  const queries = [shop, stats, series, breakdown];
  const failed = queries.find((query) => query.error);
  const loading = queries.some((query) => query.isPending);
  const refreshing = queries.some((query) => query.isFetching) && !loading;

  const refresh = useCallback(() => {
    void stats.refetch();
    void series.refetch();
    void breakdown.refetch();
  }, [stats.refetch, series.refetch, breakdown.refetch]);

  const numbers = stats.data?.stats;
  const currency = shop.data?.currency ?? "USD";

  /*
   * The revenue series as the chart wants it: a label per day and a major-unit
   * value. Cents are divided here rather than inside `Chart`, because the
   * component is told what `unit` it is drawing and a currency chart that also
   * had to know about minor units would be two decisions in one prop.
   */
  const revenuePoints = useMemo(
    () =>
      (series.data?.revenue ?? []).map((row) => ({
        label: shortDay(row.day, locale),
        value: row.cents / 100,
      })),
    [series.data?.revenue, locale],
  );

  const visitPoints = useMemo(
    () =>
      (series.data?.visits ?? []).map((row) => ({
        label: shortDay(row.day, locale),
        value: row.count,
      })),
    [series.data?.visits, locale],
  );

  /*
   * "Has this shop ever had a day worth drawing?" — asked of the values, not of
   * the array's length. The series always returns one row per day in the
   * window, so a month of zeroes is sixty points and an `if (points.length)`
   * would happily draw a flat line at nothing.
   */
  const hasRevenue = revenuePoints.some((point) => point.value > 0);
  const hasVisits = visitPoints.some((point) => point.value > 0);

  const sources = breakdown.data?.visits?.sources ?? [];
  const countries = breakdown.data?.visits?.countries ?? [];

  const clamped = stats.data?.window.clamped ?? false;

  if (failed?.error) {
    reportQueryError(failed.error, { scope: "mobile:insights" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(failed.error, a.dashboard.insightsFailed)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={refreshing}
        />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing} testID="insights">
      <Segmented
        options={RANGES.map((days) => ({
          value: String(days),
          label: interpolate(a.dashboard.rangeDays, { days: String(days) }),
        }))}
        value={range}
        onChange={setRange}
        accessibilityLabel={a.dashboard.rangeLabel}
      />

      {/*
        The clamp, said out loud. Without this the seller reads a shorter
        window as a longer one in which nothing happened — which is worse
        than being told their plan does not reach that far.

        A `Banner` rather than a caption in a bare card: this is a *standing
        state of the screen* — the numbers below are not what was asked for —
        and a grey line of small print is the one thing on a dashboard nobody
        reads. `info`, not `warning`: the plan is doing what the plan does.
      */}
      {clamped ? (
        <Banner tone="info" message={a.dashboard.rangeClamped} testID="range-clamped" />
      ) : null}

      <Card padding="lg">
        <View style={styles.stats}>
          <Stat
            label={a.dashboard.netRevenue}
            value={formatMoney(numbers?.netRevenueCents ?? 0, currency, locale)}
            loading={loading}
          />
          <Stat
            label={a.dashboard.orders}
            value={count(numbers?.totalOrders ?? 0, locale)}
            loading={loading}
          />
          <Stat
            label={a.dashboard.visits}
            value={count(numbers?.visitsInRange ?? 0, locale)}
            loading={loading}
          />
        </View>
      </Card>

      <Card padding="lg">
        <Text variant="heading">{a.dashboard.netRevenue}</Text>
        {loading ? (
          <Skeleton shape="card" />
        ) : (
          <Chart
            kind="line"
            points={hasRevenue ? revenuePoints : []}
            unit="currency"
            currency={currency}
            emptyMessage={a.dashboard.noRevenue}
            /* Tapping the plot reads out that day. The value arrives in major
               units — the chart was handed cents/100 — so it goes back through
               formatMoney rather than being printed raw. */
            formatValue={(value) => formatMoney(Math.round(value * 100), currency, locale)}
            truncatedNote={series.data?.chart.truncated ? a.dashboard.chartTruncated : undefined}
            accessibilityLabel={a.dashboard.netRevenue}
          />
        )}
      </Card>

      <Card padding="lg">
        <Text variant="heading">{a.dashboard.visits}</Text>
        {loading ? (
          <Skeleton shape="card" />
        ) : (
          <Chart
            kind="bar"
            points={hasVisits ? visitPoints : []}
            unit="count"
            emptyMessage={a.dashboard.noVisits}
            formatValue={(value) => count(value, locale)}
            truncatedNote={series.data?.chart.truncated ? a.dashboard.chartTruncated : undefined}
            accessibilityLabel={a.dashboard.visits}
          />
        )}
      </Card>

      {/*
        A ranking of one is not a ranking. Stan draws "Other: 1" as a full-
        width bar; below two distinct rows this simply is not on the screen,
        and the seller loses nothing they could have acted on.

        A `GroupedList` with its own header rather than a heading inside a card
        with a list inside it: that was a surface inside a surface, which reads
        as two boxes where there is one thing. The grouped list already *is* the
        iOS idiom for "a titled set of rows".
      */}
      {sources.length >= MIN_BREAKDOWN_ROWS ? (
        <GroupedList header={a.dashboard.sources}>
          {sources.slice(0, 6).map((row) => (
            <ListRow
              key={row.key}
              title={row.key}
              value={count(row.count, locale)}
              trailing="none"
            />
          ))}
        </GroupedList>
      ) : null}

      {countries.length >= MIN_BREAKDOWN_ROWS ? (
        <GroupedList header={a.dashboard.countries}>
          {countries.slice(0, 6).map((row) => (
            <ListRow
              key={row.key}
              title={row.key}
              value={count(row.count, locale)}
              trailing="none"
            />
          ))}
        </GroupedList>
      ) : null}

      {/*
        The whole-screen empty state. It renders when the shop has genuinely
        never been visited — not when a query is still in flight, which the
        `loading` guards above own. There is no action on it because there is
        no honest one: nothing on this screen makes visits happen, and a button
        that sent the seller somewhere else would be a dashboard admitting it
        has nothing to say by changing the subject.
      */}
      {!loading && !hasVisits && !hasRevenue ? (
        <EmptyState
          icon="insights"
          title={a.dashboard.insightsEmpty}
          message={a.dashboard.insightsEmptyBody}
        />
      ) : null}
    </Screen>
  );
}

/** A day label short enough to sit under a bar without rotating. */
function shortDay(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

function count(value: number, locale: string): string {
  try {
    return value.toLocaleString(locale);
  } catch {
    return String(value);
  }
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: 12 },
});
