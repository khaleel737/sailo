import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Chart,
  EmptyState,
  ErrorState,
  GroupedList,
  ListRow,
  Segmented,
  Sheet,
  Skeleton,
  Stat,
  Text,
  TextField,
  type ChartPoint,
  type SegmentedOption,
  type StatDelta,
} from "@sailo/design-native";
import { interpolate } from "@sailo/i18n/native";
import { formatMoney } from "@sailo/core/currency";
import { PLANS, PLAN_IDS, analyticsLimit, type Plan } from "@sailo/core/plans";
import { captureError } from "@sailo/observability";
import { useTRPC } from "../../../lib/query";
import { useT } from "../../../lib/i18n";
import { errorMessage } from "../../../components/states";

/**
 * Insights — what happened, honestly, including when nothing did.
 *
 * WHY THIS IS ONE FILE
 *
 * Every `.ts` and `.tsx` under `app/` is a route: `expo-router/_ctx` builds its
 * context from `/^(?:\.\/).*\.[tj]sx?$/` and only `_layout`, `+api`, `+html`
 * and `+middleware` are exempt. A `delta.ts` beside this one would become
 * `/insights/delta` — a real member of the typed-route union and a dead entry in
 * the dev sitemap. So the sections below are components in this file rather than
 * modules next to it, and the arithmetic sits at the top where it can at least
 * be read in one place. Somewhere testable means `apps/mobile/lib/`, which this
 * work order does not own, and a test runner in `apps/mobile`, which does not
 * exist yet. Both are in the handoff.
 *
 * WHERE THE NUMBERS COME FROM, AND WHY THEY MATCH THE WEB
 *
 * Nothing here counts anything. `analytics.stats`, `.series`, `.breakdown` and
 * `.products` run the same functions in `@sailo/analytics` that render `/admin`,
 * over a window the *server* resolves from the shop's own plan — so a figure
 * here and the same figure on the dashboard cannot disagree unless the shared
 * function is wrong. The one thing this screen must not do is resolve a window
 * itself and ask for that; it asks with a preset, the way the web page does, and
 * reads back what it was given.
 *
 * THE FOUR PLACES A CHART LIES, AND WHAT IS DONE ABOUT EACH
 *
 *   1. **Plotting nothing.** A line over a series of zeroes is a flat line under
 *      an invented axis, and it reads as "you sold nothing" rather than "there
 *      is nothing here yet". Below `MIN_PLOTTABLE_DAYS` this draws guidance
 *      instead of a plot — see `seriesState`.
 *   2. **A window that was cut.** A free shop asking for ninety days is served
 *      thirty. The response says `clamped`, and so does the screen.
 *   3. **An axis that is not the range.** Past sixty days the series is the
 *      window's recent tail while the figures above still count all of it.
 *      `chart.truncated` says so, as the chart's own note.
 *   4. **A percentage with no denominator.** A shop whose previous period was
 *      zero has no percentage — "+100%" on a single visit is true and useless.
 *      `movement` says "up from none" for that, and nothing at all when the plan
 *      cannot reach back far enough for there to be a previous period.
 *
 * WHAT IS NOT HERE
 *
 * Scrubbing. The work order asks for a scrubbable area chart running on the UI
 * thread; `Chart` in `@sailo/design-native` is static, and
 * `react-native-gesture-handler` is not a dependency of anything in this repo.
 * Both are A01's to add, and building a gesture overlay in a screen file is the
 * local-component rule this tab lives inside. Reported rather than worked around.
 */

/**
 * The presets the phone offers.
 *
 * `ANALYTICS_RANGES` in `@sailo/core/plans` has five — 7, 30, 90, 365, 1095 —
 * and `Segmented` says in its own doc that it is for three or four options,
 * "beyond that the segments stop being readable and the answer is a `Sheet` with
 * a list in it, not a smaller font". So the phone shows the three short ones and
 * Custom, and a seller whose plan reaches a year gets there through Custom. The
 * custom sheet states how far back their plan goes, so the longer windows are
 * reachable and named rather than silently missing.
 */
const RANGES = [7, 30, 90] as const;

/** What the server serves when asked for nothing. Mirrors `clampAnalyticsRange`. */
const DEFAULT_RANGE = 30;

/**
 * How many days must carry a figure before a line is worth drawing.
 *
 * Two, because one reading is a dot, and a dot drawn on an axis is where
 * invented precision comes from — a single eight-cent sale becomes a
 * "$0 – $0.08" revenue chart, which is the exact failure this screen is written
 * against. Two readings are the smallest thing that is honestly a line.
 *
 * Counted as days that are not zero rather than days that are positive: a day
 * whose only movement was a refund is a day with something in it.
 */
const MIN_PLOTTABLE_DAYS = 2;

/**
 * How many rows `getVisitBreakdown` returns per dimension — its `limit`
 * parameter, which the router leaves at its default. Mirrored rather than
 * imported because the procedure does not return it, and a ranking that has
 * exactly this many rows is one that may have been cut.
 */
const BREAKDOWN_ROWS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The window meta every analytics procedure returns beside its data. */
type WindowMeta = {
  days: number;
  custom: boolean;
  /** The request reached past the plan and was pulled forward. */
  clamped: boolean;
  since: string;
  /** Exclusive: the last day covered is the day before this. */
  until: string;
};

/** What the range control is showing. Numeric values are days. */
type Choice = "7" | "30" | "90" | "custom";

/** A picked window, as the two `YYYY-MM-DD` bounds the router accepts. */
type CustomRange = { from: string; to: string };

/** The three figures the row shows, from either period. */
type Figures = { visits: number; orders: number; revenueCents: number };

/* -------------------------------------------------------------------------- */
/*  Window arithmetic                                                          */
/* -------------------------------------------------------------------------- */

/** A UTC calendar day as `YYYY-MM-DD`, the only date shape the router takes. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The last day a window covers. `until` is exclusive everywhere in this API. */
function lastDayOf(until: string): string {
  return dayKey(new Date(Date.parse(until) - DAY_MS));
}

/**
 * The equal-length period immediately before the one on screen.
 *
 * The current window is whatever the server resolved: for a preset that is a
 * *rolling* span ending now, for a custom range a pair of calendar days. There
 * is no way to ask for "the rolling span before that" — `from` and `to` are days
 * — so this asks for the N whole UTC days ending the day before the current
 * window opens.
 *
 * The two are the same length and never overlap, which is what a comparison
 * needs. What they are not is exactly abutting: a preset that opened at midday
 * leaves that morning in neither period. Named rather than hidden, because the
 * alternative — moving the *current* window onto calendar days — would make
 * every figure on this screen disagree with the same figure on the web
 * dashboard, and matching those is worth more than half a day of edge.
 */
function precedingRange(meta: WindowMeta): CustomRange {
  const opens = new Date(meta.since);
  opens.setUTCHours(0, 0, 0, 0);
  return {
    from: dayKey(new Date(opens.getTime() - meta.days * DAY_MS)),
    to: dayKey(new Date(opens.getTime() - DAY_MS)),
  };
}

/**
 * Whether the server actually served the previous period that was asked for.
 *
 * It very often cannot, and silently: `resolveAnalyticsWindow` clamps a `from`
 * that reaches past the plan, and a window clamped into nothing falls all the
 * way back to the *default preset*. A free shop looking at its last thirty days
 * asks for the thirty before that, which is entirely outside its allowance, and
 * gets the current thirty days back — so an unchecked comparison would render
 * "0%" on every figure and read as a shop that had stopped moving.
 *
 * Checking the response rather than the plan is deliberate. The client would
 * otherwise have to re-derive an entitlement it is not allowed to be the
 * authority on, and the answer already carries what it is an answer to.
 */
function servedAsAsked(asked: CustomRange, got: WindowMeta, days: number): boolean {
  return (
    got.custom &&
    !got.clamped &&
    got.days === days &&
    dayKey(new Date(got.since)) === asked.from
  );
}

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every `Intl` call here is wrapped, for the reason `formatMoney` is wrapped in
 * `@sailo/core/currency`: Hermes ships a narrower ICU than a browser's, and an
 * unrecognised locale or an unsupported option throws rather than degrading. A
 * bare number is still a truthful number; a screen that crashed on a percentage
 * is not.
 *
 * And every one of them carries `-u-nu-latn`, which is the rule `formatMoney`
 * sets and the reason it sets it: Arabic and a few other locales default to
 * their own digits, and a screen that pinned the money to 0-9 and left the
 * counts alone would read "١٢٠٤ visits" above "$1,204.00" — two numbering
 * systems in one card, which is worse than either. Separators, symbol position
 * and the RTL marks Arabic needs are all still the locale's own.
 */
function latn(locale: string): string {
  return `${locale}-u-nu-latn`;
}

function formatCount(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(latn(locale)).format(value);
  } catch {
    return String(value);
  }
}

/** A percentage, unsigned. */
function formatPercent(fraction: number, locale: string, places = 0): string {
  try {
    return new Intl.NumberFormat(latn(locale), {
      style: "percent",
      maximumFractionDigits: places,
    }).format(fraction);
  } catch {
    return `${(fraction * 100).toFixed(places)}%`;
  }
}

/** A UTC calendar day, short — "12 Aug". */
function formatDay(day: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(latn(locale), {
      day: "numeric",
      month: "short",
      /*
       * The series buckets are UTC calendar days — `getVisitSeries` builds them
       * that way because Postgres `::date` truncates in UTC. Formatting them in
       * the phone's own zone would slide every label by a day for anyone west of
       * Greenwich, and the axis would stop agreeing with the query.
       */
      timeZone: "UTC",
    }).format(new Date(`${day}T00:00:00Z`));
  } catch {
    return day;
  }
}

/**
 * A country's name in the reader's language, falling back to its code.
 *
 * `Intl.DisplayNames` ships every one of these already translated, which is two
 * hundred-odd country names for no dictionary keys. `fallback: "code"` matters:
 * the default returns the literal "Unknown Region", which a seller reads as a
 * bug rather than as a visit the edge could not place. Mirrors `countryName` in
 * `apps/web/src/lib/countries.ts`, which is app-local and cannot be imported.
 */
function countryName(code: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "region", fallback: "code" }).of(
        code.toUpperCase(),
      ) ?? code
    );
  } catch {
    return code;
  }
}

/* -------------------------------------------------------------------------- */
/*  Comparisons                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Which way a figure moved against the period before it, or nothing.
 *
 * The cases that are not a percentage, and what each gives back:
 *
 *   - **Both zero.** Nothing happened either period. `undefined` — a "0%" over
 *     two empty periods is arithmetic dressed up as news.
 *   - **Previous zero, current above it.** There is no denominator. The label
 *     says it went up from nothing rather than inventing "+100%", which is what
 *     a shop's first ever visit would otherwise read as.
 *   - **Previous negative.** Net revenue is sales minus refunds and goes below
 *     zero in a week that refunded more than it sold. Dividing by a negative
 *     base inverts the sign: a month that went from −$100 to −$50 got better,
 *     and the arithmetic would paint that red. No percentage, rather than a
 *     confidently wrong one.
 *   - **No previous period at all.** The caller does not get here: the plan
 *     could not reach back, and no figure gets a delta.
 *
 * The direction comes from the *rounded* percentage rather than the raw change,
 * so the colour and the number never disagree — a 0.4% rise renders "0%", and
 * painting that green would be the tile claiming a movement its own label
 * denies.
 */
function movement(
  current: number,
  previous: number,
  locale: string,
  fromNothing: string,
): StatDelta | undefined {
  if (previous <= 0) {
    return previous === 0 && current > 0
      ? { label: fromNothing, direction: "up" }
      : undefined;
  }

  const whole = Math.round(((current - previous) / previous) * 100);
  const magnitude = formatPercent(Math.abs(whole) / 100, locale);

  /*
   * The sign is composed here rather than through `signDisplay`, which older ICU
   * builds accept and quietly ignore — a silent degradation is worse than none.
   * U+2212 MINUS SIGN and not a hyphen, matching `Money` in the design system:
   * at caption size a hyphen is short enough to read as a stray dash.
   */
  if (whole > 0) return { label: `+${magnitude}`, direction: "up" };
  if (whole < 0) return { label: `−${magnitude}`, direction: "down" };
  return { label: magnitude, direction: "flat" };
}

/* -------------------------------------------------------------------------- */
/*  Series                                                                     */
/* -------------------------------------------------------------------------- */

/** What a series is worth drawing as. See `MIN_PLOTTABLE_DAYS`. */
type SeriesState = "plot" | "thin" | "none";

function seriesState(values: readonly number[]): SeriesState {
  const carrying = values.filter((value) => value !== 0).length;
  if (carrying === 0) return "none";
  return carrying < MIN_PLOTTABLE_DAYS ? "thin" : "plot";
}

/* -------------------------------------------------------------------------- */
/*  The screen                                                                 */
/* -------------------------------------------------------------------------- */

export default function Insights() {
  const { a, locale } = useT();
  const trpc = useTRPC();

  const [choice, setChoice] = useState<Choice>(String(DEFAULT_RANGE) as Choice);
  const [applied, setApplied] = useState<CustomRange | null>(null);
  const [page, setPage] = useState(1);
  const [picking, setPicking] = useState(false);
  const [locked, setLocked] = useState<{ days: number; plan: Plan } | null>(null);

  /*
   * One input for every read on the screen, so the figures, the charts, the
   * breakdown and the table cannot end up describing different fortnights. A
   * custom range wins when there is one; otherwise it is a preset, which is the
   * rolling window the web dashboard also asks for.
   */
  const period = useMemo<CustomRange | { range: number }>(
    () => applied ?? { range: Number(choice) },
    [applied, choice],
  );

  const shop = useQuery(trpc.shop.get.queryOptions());
  const stats = useQuery(trpc.analytics.stats.queryOptions(period));
  const series = useQuery(trpc.analytics.series.queryOptions(period));
  const breakdown = useQuery(trpc.analytics.breakdown.queryOptions(period));
  const products = useQuery(trpc.analytics.products.queryOptions({ ...period, page }));

  /*
   * The comparison, which is a second read of the same procedure over the
   * preceding window. It waits for the first: the previous period is defined
   * relative to what the server resolved, not to what was asked for, so there is
   * nothing to request until `stats` has answered. `skipToken` rather than
   * `enabled`, so the disabled state has no query key at all — a disabled query
   * with a stand-in input is one cache hit away from answering with the current
   * period's figures.
   */
  const asked = stats.data ? precedingRange(stats.data.window) : null;
  const before = useQuery(trpc.analytics.stats.queryOptions(asked ?? skipToken));

  const meta: WindowMeta | undefined = stats.data?.window;
  const comparable =
    meta !== undefined &&
    asked !== null &&
    before.data !== undefined &&
    servedAsAsked(asked, before.data.window, meta.days);

  const currency = shop.data?.currency ?? "USD";
  const limit = shop.data ? analyticsLimit(shop.data) : null;

  /**
   * The cheapest plan whose window reaches a range, or null when this shop
   * already has it. `PLAN_IDS` is ordered cheapest-first, which is what makes
   * `find` the right answer rather than a sort.
   */
  const lockedPlan = useCallback(
    (days: number): Plan | null => {
      if (limit === null || days <= limit) return null;
      return (
        PLAN_IDS.map((id) => PLANS[id]).find(
          (plan) => plan.limits.analyticsDays >= days,
        ) ?? null
      );
    },
    [limit],
  );

  const options = useMemo<SegmentedOption<Choice>[]>(
    () => [
      ...RANGES.map((days) => ({
        value: String(days) as Choice,
        label: interpolate(a.insights.rangeDays, { days }),
        /*
         * The plan's name beside a range it cannot reach. There is no `lock` in
         * the design system's icon union, so the badge is what marks the segment
         * as gated — it stays visible and stays tappable, and the tap opens the
         * explanation instead of changing the window. Hiding it would leave a
         * seller no way to learn that ninety days exists.
         */
        badge: lockedPlan(days)?.name,
      })),
      { value: "custom", label: a.range.custom },
    ],
    [a.insights.rangeDays, a.range.custom, lockedPlan],
  );

  const pick = useCallback(
    (next: Choice) => {
      if (next === "custom") {
        setPicking(true);
        return;
      }
      const days = Number(next);
      const plan = lockedPlan(days);
      if (plan) {
        setLocked({ days, plan });
        return;
      }
      setApplied(null);
      setChoice(next);
      setPage(1);
    },
    [lockedPlan],
  );

  const applyCustom = useCallback((range: CustomRange) => {
    setApplied(range);
    setChoice("custom");
    setPage(1);
    setPicking(false);
  }, []);

  /*
   * A pull refetches everything the screen is made of rather than only the
   * figures, because a seller who pulls has just done something — taken an order
   * over the phone, shared their link — and a table that stayed stale under
   * refreshed tiles reads as the pull not having worked.
   */
  const refresh = () => {
    void shop.refetch();
    void stats.refetch();
    void series.refetch();
    void breakdown.refetch();
    void products.refetch();
    void before.refetch();
  };

  const refreshing =
    [shop, stats, series, breakdown, products].some((query) => query.isFetching) &&
    !stats.isPending;

  if (stats.error) {
    captureError(stats.error, { scope: "mobile:insights:stats" });
    return (
      <SafeAreaView style={layout.screen} edges={["left", "right"]}>
        <ErrorState
          message={errorMessage(stats.error, a.insights.failed)}
          onRetry={refresh}
          retrying={stats.isFetching}
          retryLabel={a.insights.retry}
        />
      </SafeAreaView>
    );
  }

  /** "Last 30 days", or the two days a custom window runs between. */
  const windowLabel = meta
    ? meta.custom
      ? interpolate(a.insights.customRange, {
          from: formatDay(dayKey(new Date(meta.since)), locale),
          to: formatDay(lastDayOf(meta.until), locale),
        })
      : interpolate(a.insights.lastDays, { days: meta.days })
    : undefined;

  const now = stats.data?.stats;
  const then = comparable ? before.data?.stats : undefined;

  return (
    <SafeAreaView style={layout.screen} edges={["left", "right"]}>
      <ScrollView
        contentContainerStyle={layout.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <Segmented
          options={options}
          value={choice}
          onChange={pick}
          accessibilityLabel={a.insights.rangeLabel}
        />

        {/*
         * The window was cut, and says so. Server-side clamping is invisible
         * otherwise: the shorter answer arrives looking exactly like the one that
         * was asked for, and a seller reads a quiet quarter rather than a plan
         * boundary.
         */}
        {meta?.clamped ? (
          <Card padding="sm">
            <Text variant="caption" tone="warning">
              {interpolate(a.insights.clamped, { days: meta.days })}
            </Text>
          </Card>
        ) : null}

        <FigureRow
          a={a}
          locale={locale}
          currency={currency}
          caption={windowLabel}
          now={
            now && {
              visits: now.visitsInRange,
              orders: now.totalOrders,
              revenueCents: now.netRevenueCents,
            }
          }
          then={
            then && {
              visits: then.visitsInRange,
              orders: then.totalOrders,
              revenueCents: then.netRevenueCents,
            }
          }
          comparedWith={meta?.days}
          loading={stats.isPending}
          /*
           * Whether the comparison has an answer at all — not whether it found
           * one. While it is in flight, and if it fails, the row says nothing
           * rather than "no earlier period to compare with", which is a claim
           * about the shop's plan and would be the screen guessing.
           */
          compared={before.isSuccess}
        />

        <SeriesCards
          a={a}
          locale={locale}
          currency={currency}
          data={series.data}
          loading={series.isPending}
        />

        <Sources a={a} locale={locale} data={breakdown.data} loading={breakdown.isPending} />

        <Products
          a={a}
          locale={locale}
          currency={currency}
          data={products.data}
          loading={products.isPending}
          onPage={setPage}
        />

        {/*
         * The whole-screen empty state, deliberately last and deliberately about
         * the shop rather than about this window. A shop with two hundred
         * lifetime orders and a slow week has numbers; telling it there is
         * nothing to measure would be this screen misreading a quiet week as an
         * empty account.
         */}
        {now && now.visitsInRange === 0 && now.totalOrders === 0 && now.totalProducts === 0 ? (
          <EmptyState
            icon="insights"
            title={a.insights.nothingYet}
            message={a.insights.nothingYetBody}
          />
        ) : null}
      </ScrollView>

      <CustomSheet
        a={a}
        locale={locale}
        visible={picking}
        limit={limit}
        onApply={applyCustom}
        onClose={() => setPicking(false)}
      />

      <Sheet
        visible={locked !== null}
        onClose={() => setLocked(null)}
        closeLabel={a.insights.close}
        title={
          locked
            ? interpolate(a.insights.locked, {
                days: locked.days,
                plan: locked.plan.name,
              })
            : undefined
        }
      >
        <Text variant="callout" tone="muted">
          {a.insights.lockedBody}
        </Text>
      </Sheet>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sections                                                                   */
/* -------------------------------------------------------------------------- */

/** The admin dictionary, as `useT()` hands it over. */
type Admin = ReturnType<typeof useT>["a"];

/**
 * The three figures a seller reads in two seconds.
 *
 * Two counts across and the money on its own line under them, rather than three
 * across. `Stat` shrinks to share a row and truncates its value to one line, and
 * a formatted amount at title size in a third of a phone's width ellipses on
 * anything past a four-figure sum — at which point the one number a seller
 * opened the app for is the one they cannot read. The counts are short and
 * survive the split; the amount gets the width.
 *
 * `caption` repeats the window on all three on purpose. A screen reader moves
 * through these one at a time, and a figure that only says what it is *of* when
 * read in order is a figure that reads as a lifetime total to everybody else.
 */
function FigureRow({
  a,
  locale,
  currency,
  caption,
  now,
  then,
  comparedWith,
  loading,
  compared,
}: {
  a: Admin;
  locale: string;
  currency: string;
  caption: string | undefined;
  now: Figures | undefined;
  /** Omitted when there is no comparable previous period — see `servedAsAsked`. */
  then: Figures | undefined;
  comparedWith: number | undefined;
  loading: boolean;
  /** The comparison has come back, one way or the other. */
  compared: boolean;
}) {
  const delta = (key: keyof Figures): StatDelta | undefined =>
    now && then ? movement(now[key], then[key], locale, a.insights.fromNothing) : undefined;

  return (
    <Card>
      <View style={layout.stack}>
        <View style={layout.figures}>
          <Stat
            label={a.dashboard.visits}
            value={formatCount(now?.visits ?? 0, locale)}
            delta={delta("visits")}
            caption={caption}
            loading={loading}
          />
          <Stat
            label={a.dashboard.orders}
            value={formatCount(now?.orders ?? 0, locale)}
            delta={delta("orders")}
            caption={caption}
            loading={loading}
          />
        </View>

        <Stat
          label={a.dashboard.netRevenue}
          value={formatMoney(now?.revenueCents ?? 0, currency, locale)}
          delta={delta("revenueCents")}
          caption={caption}
          loading={loading}
        />

        {/*
         * What the deltas are against, said once. Per-tile it would be three
         * copies of one sentence; left out, the arrows would be movement against
         * an unnamed period — which is the shape of comparison a seller has no
         * way to check.
         */}
        {loading || !compared ? null : (
          <Text variant="caption" tone="muted">
            {then && comparedWith !== undefined
              ? interpolate(a.insights.vsPrevious, { days: comparedWith })
              : a.insights.noPrevious}
          </Text>
        )}
      </View>
    </Card>
  );
}

type Series = {
  window: WindowMeta;
  chart: { days: number; truncated: boolean; since: string; until: string };
  visits: readonly { day: string; count: number }[];
  revenue: readonly { day: string; cents: number }[];
};

/** Revenue and traffic, over the days the server said it was plotting. */
function SeriesCards({
  a,
  locale,
  currency,
  data,
  loading,
}: {
  a: Admin;
  locale: string;
  currency: string;
  data: Series | undefined;
  loading: boolean;
}) {
  const revenue = useMemo<ChartPoint[]>(
    () =>
      (data?.revenue ?? []).map((row) => ({
        label: formatDay(row.day, locale),
        value: row.cents,
      })),
    [data?.revenue, locale],
  );

  const visits = useMemo<ChartPoint[]>(
    () =>
      (data?.visits ?? []).map((row) => ({
        label: formatDay(row.day, locale),
        value: row.count,
      })),
    [data?.visits, locale],
  );

  if (loading || !data) {
    return <Skeleton shape="card" count={2} />;
  }

  /*
   * The chart is a window inside a window past sixty days, and the note says
   * which. Taken from `chart.truncated` rather than from the point count,
   * because those differ: a sixty-day tail of a year has sixty points and is
   * still not the year the figures above counted.
   */
  const tail = data.chart.truncated
    ? interpolate(a.insights.chartTail, {
        days: data.chart.days,
        total: data.window.days,
      })
    : undefined;

  /*
   * The axis is read off the buckets, not off `chart.since`/`chart.until`.
   *
   * Those two are instants describing the window — a rolling preset opens at
   * "now minus seven days", which is midday — while the series is zero-filled
   * over whole UTC days built by `utcDayWindow`, and the two disagree by one at
   * each end. Taking the ends from the rows themselves means the sentence a
   * screen reader hears names the days that are actually plotted.
   *
   * Both series are filled over the same keys, so `visits` speaks for both.
   */
  const buckets = data.visits;
  const opens = buckets[0]?.day;
  const closes = buckets[buckets.length - 1]?.day;
  const bounds = {
    from: opens ? formatDay(opens, locale) : "",
    to: closes ? formatDay(closes, locale) : "",
  };
  const span = interpolate(a.insights.customRange, bounds);

  return (
    <>
      <SeriesCard
        a={a}
        title={
          data.window.custom
            ? interpolate(a.dashboard.revenueCustom, { range: span })
            : interpolate(a.dashboard.revenueRange, { days: data.window.days })
        }
        points={revenue}
        unit="currency"
        currency={currency}
        nothing={a.dashboard.noRevenue}
        note={tail}
        accessibilityLabel={interpolate(a.insights.revenueChartLabel, bounds)}
      />

      <SeriesCard
        a={a}
        title={
          data.window.custom
            ? interpolate(a.dashboard.visitsCustom, { range: span })
            : interpolate(a.dashboard.visitsRange, { days: data.window.days })
        }
        points={visits}
        unit="count"
        nothing={a.dashboard.noVisits}
        note={tail}
        accessibilityLabel={interpolate(a.insights.visitsChartLabel, bounds)}
      />
    </>
  );
}

/**
 * One series, drawn or explained.
 *
 * All three states render `Chart`, so the card is the same height whichever one
 * it is in — a plot that collapsed to a line of text when a shop had a quiet
 * week would move everything under it up the screen and back down on the next
 * sale. `thin` adds a line above the box saying why there is no line in it.
 */
function SeriesCard({
  a,
  title,
  points,
  unit,
  currency,
  nothing,
  note,
  accessibilityLabel,
}: {
  a: Admin;
  title: string;
  points: ChartPoint[];
  unit: "currency" | "count";
  currency?: string;
  /** Shown when no day in the window carried anything at all. */
  nothing: string;
  note: string | undefined;
  accessibilityLabel: string;
}) {
  const state = seriesState(points.map((point) => point.value));

  return (
    <Card>
      <View style={layout.stack}>
        <Text variant="label" tone="muted" heading>
          {title}
        </Text>

        {state === "thin" ? (
          <Text variant="callout" weight="semibold" align="center">
            {a.insights.tooLittle}
          </Text>
        ) : null}

        <Chart
          points={state === "plot" ? points : []}
          unit={unit}
          currency={currency}
          emptyMessage={state === "none" ? nothing : a.insights.tooLittleBody}
          truncatedNote={note}
          accessibilityLabel={accessibilityLabel}
        />
      </View>
    </Card>
  );
}

type Breakdown = {
  window: WindowMeta;
  visits: {
    total: number;
    /** Visits the edge could place. Zero in local development. */
    located: number;
    countries: readonly { key: string; count: number }[];
    sources: readonly { key: string; count: number }[];
  };
};

/**
 * Where visitors came from and how they found the shop.
 *
 * Two ranked lists and never a chart. A bar chart of one bar labelled
 * "Other: 1" is the other half of the invented-precision problem this screen is
 * written against: a ranking reads honestly at any length, including one, and a
 * chart of it does not.
 *
 * Each list is the server's top few, and says so — but only when it is long
 * enough to have hit the cap. Telling a seller with two countries that they are
 * seeing "the 2 most common" is noise.
 */
function Sources({
  a,
  locale,
  data,
  loading,
}: {
  a: Admin;
  locale: string;
  data: Breakdown | undefined;
  loading: boolean;
}) {
  if (loading || !data) return <Skeleton shape="card" />;

  if (data.visits.total === 0) {
    return (
      <Card>
        <Text variant="callout" tone="muted">
          {a.traffic.noVisits}
        </Text>
      </Card>
    );
  }

  const capped = (rows: readonly unknown[]) =>
    rows.length >= BREAKDOWN_ROWS
      ? interpolate(a.insights.topOnly, { count: rows.length })
      : undefined;

  return (
    <>
      <GroupedList
        header={a.traffic.countries}
        footer={
          data.visits.countries.length === 0
            ? /*
               * Nothing placed is two different facts. Zero *located* visits
               * means the edge never resolved any of them — which is what
               * happens in local development and before a shop is live — and is
               * a different message from "we placed them and there were none".
               */
              data.visits.located === 0
              ? a.traffic.geoEdge
              : a.traffic.noLocation
            : capped(data.visits.countries)
        }
      >
        {data.visits.countries.map((row) => (
          <ListRow
            key={row.key}
            title={countryName(row.key, locale)}
            value={formatCount(row.count, locale)}
          />
        ))}
      </GroupedList>

      <GroupedList
        header={a.traffic.howTheyFound}
        footer={
          data.visits.sources.length === 0
            ? a.traffic.allDirect
            : capped(data.visits.sources)
        }
      >
        {data.visits.sources.map((row) => (
          <ListRow
            key={row.key}
            /*
             * The stored key, not a prettified one. `apps/web` maps these
             * through a `SOURCE_LABELS` table that is app-local, and inventing a
             * second one here is how the two surfaces come to call the same
             * traffic source different things.
             */
            title={row.key}
            value={formatCount(row.count, locale)}
          />
        ))}
      </GroupedList>

      <Text variant="caption" tone="muted">
        {interpolate(a.traffic.rangeSummary, {
          days: data.window.days,
          count: formatCount(data.visits.total, locale),
        })}
      </Text>
    </>
  );
}

type Performance = {
  rows: readonly {
    key: string;
    title: string;
    views: number;
    orders: number;
    revenueCents: number;
    /** Orders per view, or null when there were no views to divide by. */
    conversion: number | null;
  }[];
  total: number;
  page: number;
  perPage: number;
};

/**
 * Views, orders, conversion and revenue per product, a page at a time.
 *
 * The pager exists because the server pages: `getProductPerformance` slices
 * fifty rows and returns the total, and a screen showing the slice without the
 * total would be presenting the top fifty as the whole catalogue. `showingTop`
 * counts everything seen so far rather than this page's fifty, which is what
 * keeps it true on page two.
 */
function Products({
  a,
  locale,
  currency,
  data,
  loading,
  onPage,
}: {
  a: Admin;
  locale: string;
  currency: string;
  data: Performance | undefined;
  loading: boolean;
  onPage: (next: number) => void;
}) {
  if (loading || !data) return <Skeleton shape="card" />;

  if (data.rows.length === 0) {
    return (
      <GroupedList header={a.performance.title}>
        <ListRow title={a.traffic.noData} subtitle={a.performance.empty} />
      </GroupedList>
    );
  }

  const seen = (data.page - 1) * data.perPage + data.rows.length;
  const paged = data.total > data.perPage;

  return (
    <>
      <GroupedList
        header={a.performance.title}
        footer={
          paged
            ? interpolate(a.performance.showingTop, { shown: seen, total: data.total })
            : undefined
        }
      >
        {data.rows.map((row) => (
          <ListRow
            key={row.key}
            title={row.title}
            /*
             * Three label-and-figure pairs on one line, joined rather than laid
             * out in columns: `ListRow` has one subtitle slot and this package
             * has no table. Every label comes from the dictionary and nothing
             * here composes a sentence out of them — it is a readout, and the
             * separator survives mirroring.
             */
            subtitle={[
              `${a.dashboard.views} ${formatCount(row.views, locale)}`,
              `${a.columns.orders} ${formatCount(row.orders, locale)}`,
              `${a.performance.conversion} ${
                /* Null, not zero: no views is "we cannot say", not "nobody bought". */
                row.conversion === null ? "—" : formatPercent(row.conversion, locale, 1)
              }`,
            ].join(" · ")}
            value={formatMoney(row.revenueCents, currency, locale)}
          />
        ))}
      </GroupedList>

      {paged ? (
        <View style={layout.figures}>
          <Button
            label={a.performance.previous}
            onPress={() => onPage(Math.max(1, data.page - 1))}
            disabled={data.page <= 1}
          />
          <Button
            label={a.performance.next}
            onPress={() => onPage(data.page + 1)}
            disabled={seen >= data.total}
          />
        </View>
      ) : null}
    </>
  );
}

/**
 * The custom range picker: two days, typed.
 *
 * Two `TextField`s rather than a calendar, because the design system has no date
 * field and this tab does not build its own components. The format is stated in
 * the placeholder and validated before anything is requested — the router
 * ignores a malformed date and silently serves the default preset, which would
 * otherwise look like a range that had been applied and had done nothing.
 *
 * The earliest day the plan can read is shown rather than only enforced. The
 * server clamps regardless; a seller who can see the floor does not have to
 * discover it by being refused. It is also the only place on this screen that
 * says how to reach a window longer than ninety days.
 */
function CustomSheet({
  a,
  locale,
  visible,
  limit,
  onApply,
  onClose,
}: {
  a: Admin;
  locale: string;
  visible: boolean;
  /** The plan's window in days, or null while the shop is still loading. */
  limit: number | null;
  onApply: (range: CustomRange) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const today = dayKey(new Date());
  /* Counted the way the presets count: a 30-day allowance is 29 days plus today. */
  const floor = limit === null ? null : dayKey(new Date(Date.now() - (limit - 1) * DAY_MS));
  const reach = floor === null ? undefined : interpolate(a.insights.earliest, {
    day: formatDay(floor, locale),
  });

  const malformed = (value: string) => value.length > 0 && !DAY_PATTERN.test(value);
  const complete = DAY_PATTERN.test(from) && DAY_PATTERN.test(to);
  const tooEarly = floor !== null && DAY_PATTERN.test(from) && from < floor;
  const inverted = complete && from > to;

  /* Today, as the shape the field wants — the format shown rather than described. */
  const format = interpolate(a.insights.dayFormat, { example: today });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={a.range.custom}
      closeLabel={a.insights.close}
    >
      <View style={layout.stack}>
        <TextField
          label={a.range.from}
          value={from}
          onChangeText={setFrom}
          placeholder={today}
          hint={reach}
          error={malformed(from) ? format : tooEarly ? reach : undefined}
          keyboard="number"
        />

        <TextField
          label={a.range.to}
          value={to}
          onChangeText={setTo}
          placeholder={today}
          error={malformed(to) ? format : inverted ? a.insights.inverted : undefined}
          keyboard="number"
        />

        <Button
          label={a.range.apply}
          onPress={() => onApply({ from, to })}
          disabled={!complete || inverted || tooEarly}
          variant="primary"
          fullWidth
        />
      </View>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*  Flow                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The only styles in this tab, and every one of them is flow.
 *
 * No colour, no radius, no type — those belong to `@sailo/design-native` and
 * stay there. What is here is the arrangement of components on a page, which
 * that package has no way to express: it ships twenty components and no layout
 * primitive, exports no theme, and forbids a `style` prop on everything it does
 * ship. There is no way to put air between two cards with it.
 *
 * The numbers are the theme's own `space.md` and `space.lg`, written out rather
 * than imported because `@sailo/tokens` is not a declared dependency of
 * `apps/mobile`, and `metro.config.js` sets `disableHierarchicalLookup` — an
 * undeclared workspace package does not resolve, and that failure is at bundle
 * time rather than at typecheck.
 *
 * **What to ask A01 for, to delete this block:** a `Screen`/`Stack` container
 * taking `padding` and `gap` as named sizes. The four objects below become two
 * components, and the app has one fewer place where a spacing decision is made
 * in a screen file.
 */
const layout = {
  screen: { flex: 1 },
  /** The scroll body: a page margin, and air between the sections. */
  page: { padding: 16, gap: 16, flexGrow: 1 },
  /** Air between two things inside one card or sheet. */
  stack: { gap: 16 },
  /** Two of a thing across the width, sharing it evenly. */
  figures: { flexDirection: "row" as const, gap: 12 },
};
