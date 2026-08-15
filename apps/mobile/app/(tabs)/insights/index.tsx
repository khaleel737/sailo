import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useQueries } from "@tanstack/react-query";
import { formatMoney } from "@sailo/core/currency";
/*
 * The same "is there anything worth drawing" test the chart runs on the same
 * series, rather than a local `.some(v => v > 0)`. The screen and the component
 * asking the question two different ways is how a card ends up empty inside a
 * screen that has decided it is not.
 */
import { hasData } from "@sailo/core/chart";
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
   * The days every series is measured over. One array, shared by both charts,
   * because they cover the same window and a card holding a month of visits
   * beside a fortnight of revenue would be a bug nobody could see.
   */
  const days = useMemo(
    () => (series.data?.revenue ?? []).map((row) => row.day),
    [series.data?.revenue],
  );

  /*
   * Revenue, as the three measures the web card has always drawn and this
   * screen could not.
   *
   * **Nothing new is fetched for this.** `getRevenueSeries` has always returned
   * `grossCents` and `refundedCents` alongside the net `cents`, and
   * `analytics.series` has always passed the rows straight through — the old
   * `Chart` simply had no way to be handed a second measure, so two thirds of
   * what the server sent was thrown away on arrival.
   *
   * Cents are divided here rather than inside `Chart`, because the component is
   * told what `unit` it is drawing and a currency chart that also had to know
   * about minor units would be two decisions in one prop.
   */
  const revenueSeries = useMemo(
    () => [
      {
        key: "sales",
        label: a.dashboard.sales,
        depth: 1,
        values: (series.data?.revenue ?? []).map((row) => row.grossCents / 100),
      },
      /* Below the axis: money leaving, on the day it left. Held positive — the
         chart decides which side of the line that belongs on. */
      {
        key: "refunds",
        label: a.dashboard.refunds,
        negative: true,
        depth: 2,
        values: (series.data?.revenue ?? []).map((row) => row.refundedCents / 100),
      },
      /*
       * Reported, never plotted. Net is sales minus refunds and is already on
       * the card twice over; drawing it as a third measure would compete with
       * the two it is derived from while stretching nothing about the axis.
       */
      {
        key: "net",
        label: a.dashboard.net,
        depth: 0,
        readoutOnly: true,
        values: (series.data?.revenue ?? []).map((row) => row.cents / 100),
      },
    ],
    [series.data?.revenue, a],
  );

  /* The gap between the two lines is repeat viewing — the number that tells a
     link that is working from one being refreshed. */
  const visitSeries = useMemo(
    () => [
      {
        key: "visits",
        label: a.dashboard.views,
        values: (series.data?.visits ?? []).map((row) => row.count),
      },
      {
        key: "unique",
        label: a.dashboard.visitors,
        depth: 1,
        values: (series.data?.visits ?? []).map((row) => row.unique),
      },
    ],
    [series.data?.visits, a],
  );

  /*
   * How a day and a figure are written here. Passed to `Chart` rather than
   * decided by it: the component knows the number, not what it is denominated
   * in, and money is punctuated per-locale.
   */
  const formatDay = useCallback((iso: string) => shortDay(iso, locale), [locale]);
  const formatMoneyValue = useCallback(
    (value: number) => formatMoney(Math.round(value * 100), currency, locale),
    [currency, locale],
  );
  const formatCount = useCallback((value: number) => count(value, locale), [locale]);

  const windowLabel = interpolate(a.dashboard.rangeDays, { days: String(days.length) });

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
        /* `preset`, not `days` — the charts below now hold the window's actual
           days in a variable of that name, and one shadowing the other is a
           rename away from a control that offers 7/30/90 and plots something
           else. */
        options={RANGES.map((preset) => ({
          value: String(preset),
          label: interpolate(a.dashboard.rangeDays, { days: String(preset) }),
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

      {/*
        The card no longer carries a heading of its own. `Chart` has one — with
        the window's total under it and the biggest day beside it — and a
        `Text` above that was a second title for the same thing, which is what
        made the old card look like a plot somebody had labelled rather than a
        figure somebody had explained.
      */}
      <Card padding="lg">
        {loading ? (
          <Skeleton shape="card" />
        ) : (
          <Chart
            title={a.dashboard.netRevenue}
            days={days}
            series={revenueSeries}
            tone="money"
            unit="money"
            currency={currency}
            /* Net, not sales. It is the figure a seller means by "how did this
               month go", and it is third in the array above. */
            totalKey="net"
            defaultShape="bar"
            switchable
            shapeLabels={a.chart}
            labels={{
              peak: interpolate(a.dashboard.peak, { label: a.dashboard.sales }),
              window: windowLabel,
            }}
            emptyLabel={a.dashboard.noRevenue}
            truncatedNote={series.data?.chart.truncated ? a.dashboard.chartTruncated : undefined}
            locale={locale}
            formatDay={formatDay}
            formatValue={formatMoneyValue}
            testID="chart-revenue"
          />
        )}
      </Card>

      <Card padding="lg">
        {loading ? (
          <Skeleton shape="card" />
        ) : (
          <Chart
            title={a.dashboard.visits}
            days={days}
            series={visitSeries}
            tone="activity"
            unit="count"
            defaultShape="line"
            switchable
            shapeLabels={a.chart}
            labels={{
              peak: interpolate(a.dashboard.peak, { label: a.dashboard.views }),
              window: windowLabel,
            }}
            emptyLabel={a.dashboard.noVisits}
            truncatedNote={series.data?.chart.truncated ? a.dashboard.chartTruncated : undefined}
            locale={locale}
            formatDay={formatDay}
            formatValue={formatCount}
            testID="chart-visits"
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
      {!loading && !hasData(visitSeries) && !hasData(revenueSeries) ? (
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
