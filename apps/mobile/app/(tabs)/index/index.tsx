import { useCallback } from "react";
import { Platform, RefreshControl, ScrollView, Share, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQueries } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { formatMoney } from "@sailo/core/currency";
import { orderStatusLabel } from "@sailo/core/order-status";
import { interpolate } from "@sailo/i18n/native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  GroupedList,
  ListRow,
  Skeleton,
  Stat,
  StatusPill,
  Text,
} from "@sailo/design-native";
import type { Order } from "../../../lib/models";
import { useT } from "../../../lib/i18n";
import { useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";
import { useRelativeTime } from "../orders/index";

/**
 * Home — the seller's shop link, today's numbers, and what just came in.
 *
 * This replaces the placeholder dashboard that used to be `(tabs)/index.tsx`.
 * What was worth keeping from it was never the layout: it was the data layer
 * underneath, and that is unchanged. `useTRPC()` hands back a typed builder,
 * `queryOptions()` derives the cache key from the procedure path and its input,
 * and the four states — loading, error, empty, refreshing — are the reason it
 * exists rather than another `useState`/`useEffect` pair.
 *
 * Sign out has gone, and did not move here: it lives on the Settings tab, which
 * is where a seller looks for it and which owns the token cleanup that has to
 * happen around it.
 *
 * WHAT IS NOT ON THIS SCREEN YET, AND WHY
 *
 * **The setup checklist.** `setupSteps()` in `@sailo/core/onboarding` derives
 * four steps from live shop data, and the phone can answer three of them from
 * `shop.get` and `analytics.stats`. It cannot answer the fourth: "turn on a way
 * to get paid" counts *enabled payment rails*, which live in their own table
 * that no tRPC procedure exposes. Passing `enabledRailCount: 0` would compile
 * and would tell every cash-on-delivery seller their shop cannot take money —
 * which is the exact mistake `onboarding.ts`'s header warns against, and a
 * wrong tick is worse than no card. It lands whole the day `packages/api`
 * grows a procedure that returns the count, which is a change this work order
 * does not own.
 */

/**
 * How many recent orders the phone shows before handing over to the Orders tab.
 *
 * Five, and the list says so rather than implying it is everything: the "View
 * all" control under it is the admission, not a nicety.
 */
const RECENT = 5;

/**
 * Where a seller's shop lives.
 *
 * The *web* origin, which is a different host from the API one `lib/api.ts`
 * resolves — that file's note explains why the two are separate, and why its
 * own fallback stopped being `sailo.store`. This is the half that genuinely is
 * `sailo.store`: it is what a buyer types, and what goes on a business card.
 */
const SITE = process.env.EXPO_PUBLIC_APP_URL ?? "https://sailo.store";

export default function Home() {
  const { t, a, locale } = useT();
  const trpc = useTRPC();
  const router = useRouter();
  const ago = useRelativeTime(locale);

  /*
   * Today, spelled the way `resolveAnalyticsWindow` reads it. Computed during
   * render rather than memoised on mount, so an app left open across midnight
   * asks for the new day on its next refetch instead of holding yesterday's
   * key for as long as it stays in the background.
   *
   * `range: 1` would not work: `ANALYTICS_RANGES` is [7, 30, 90, 365, 1095] and
   * anything off that list falls back to thirty days. A one-day custom window
   * is the only way to ask this question, and the resolver already knows how to
   * clamp it against the seller's plan.
   */
  const today = utcDay(new Date());

  /*
   * All three reads as one unit, because the screen is one unit: a header that
   * has arrived above a list that hasn't is a layout that jumps under the
   * seller's thumb. `useQueries` gives a single place to ask "is any of this
   * still loading" without either query knowing about the other.
   */
  const [shop, stats, recent] = useQueries({
    queries: [
      trpc.shop.get.queryOptions(),
      trpc.analytics.stats.queryOptions({ from: today, to: today }),
      trpc.orders.list.queryOptions({ limit: RECENT }),
    ],
  });

  const queries = [shop, stats, recent];
  const failed = queries.find((query) => query.error);
  const loading = queries.some((query) => query.isPending);
  // `isFetching` rather than `isRefetching`, so the spinner is honest about a
  // background refresh the seller did not ask for as well as one they did.
  const refreshing = queries.some((query) => query.isFetching) && !loading;

  const now = Date.now();

  const refresh = useCallback(() => {
    void shop.refetch();
    void stats.refetch();
    void recent.refetch();
  }, [shop.refetch, stats.refetch, recent.refetch]);

  const handle = shop.data?.handle;
  const shopUrl = handle ? `${SITE}/${handle}` : null;

  const openShop = useCallback(() => {
    if (!shopUrl) return;
    /*
     * The in-app browser rather than handing the URL to Safari or Chrome: it
     * renders the seller's real storefront in their real theme and closes back
     * onto this screen, where leaving the app is a trip the seller has to find
     * their own way back from.
     *
     * This is also where the Preview sheet the work order specifies will go.
     * That one is an embedded `WebView` with share and copy chrome around it,
     * and `react-native-webview` is not a dependency of this app —
     * `apps/mobile/package.json` belongs to A00. What is here opens the same
     * page and is emphatically not a mockup, which was the point of demoting
     * Preview from a tab in the first place.
     */
    void WebBrowser.openBrowserAsync(shopUrl).catch((error: unknown) => {
      captureError(error, { scope: "mobile:home:openShop" });
    });
  }, [shopUrl]);

  const shareShop = useCallback(() => {
    if (!shopUrl) return;
    /*
     * iOS wants a `url` so the sheet offers the link's own actions — AirDrop,
     * Messages, and the Copy the seller would otherwise need a clipboard
     * dependency for. Android has no `url` field and reads `message`. Passing
     * both would share the address twice on iOS.
     */
    void Share.share(
      Platform.OS === "ios" ? { url: shopUrl } : { message: shopUrl },
    ).catch((error: unknown) => {
      captureError(error, { scope: "mobile:home:share" });
    });
  }, [shopUrl]);

  const openOrder = useCallback(
    (id: string) => {
      router.navigate({ pathname: "/orders/[id]", params: { id } });
    },
    [router],
  );

  if (failed?.error) {
    captureError(failed.error, { scope: "mobile:home" });
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <ErrorState
          message={t.errors.title}
          detail={errorMessage(failed.error, t.errors.body)}
          onRetry={refresh}
          retrying={refreshing}
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    /*
     * Skeletons in the shape of what is coming — the link block, the three
     * numbers, the five rows — rather than a spinner in the middle of an empty
     * screen. A spinner collapses the layout and then jumps it back.
     */
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.body}>
          <Skeleton shape="card" />
          <Skeleton shape="title" />
          <Skeleton shape="row" count={RECENT} />
        </View>
      </SafeAreaView>
    );
  }

  /*
   * `shop.get` is typed as possibly absent because `findFirst` is. In practice
   * `shopProcedure` has already refused a caller with no shop, so reaching here
   * means the row was deleted mid-session — which is a failure, not an empty
   * state, and gets the failure's treatment.
   */
  if (!shop.data || !shopUrl) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <ErrorState message={t.errors.title} detail={t.errors.body} onRetry={refresh} retrying={refreshing} />
      </SafeAreaView>
    );
  }

  const currency = shop.data.currency;
  /*
   * The first page of `orders.list`, which is all Home asks for. Its
   * `nextCursor` is deliberately dropped: paging belongs to the Orders tab, and
   * a home screen that could scroll into the shop's history would be a second
   * orders list with a worse filter on it.
   */
  const latest = recent.data?.items ?? [];
  const window = stats.data?.window;
  const numbers = stats.data?.stats;
  /*
   * The caption comes from the window the *server answered with*, never from
   * the one this screen asked for. They are usually the same day; they are not
   * when the plan clamped the range or the resolver rejected the input and fell
   * back to its default, and a "Today" label over thirty days of revenue is the
   * kind of wrong that reads as a very good day.
   */
  const covers = window ? windowLabel(window, locale) : "";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {/*
          The link is the product, so it leads the screen — the web dashboard
          opens the same way, and its comment explains why that block is ink
          rather than brand green: the URL should be the brightest thing in it,
          not the background. `Card` has no inverted variant yet, so this is an
          ordinary surface today. **That variant is a request for A01**, not
          something to paint here: a screen that reached for a hex would be the
          one file dark mode forgets.
        */}
        <Card variant="plain" padding="lg">
          <View style={styles.linkBlock}>
            <View style={styles.linkHead}>
              <Text variant="label" tone="muted">
                {t.handle.label}
              </Text>
              {/*
                The live dot from the web block, as a word. A coloured dot with
                nothing beside it is a state only a sighted seller can read, and
                a pill already carries its own label — which is the rule
                `StatusPill` states: the tone is never the only signal.
              */}
              <StatusPill
                label={shop.data.isPublished ? a.common.live : a.common.hidden}
                tone={shop.data.isPublished ? "success" : "neutral"}
                size="sm"
              />
            </View>

            {/*
              Wrapped in an LTR isolate. A URL is left-to-right in every
              language, and dropped bare into an Arabic layout the punctuation
              migrates — `sailo.store/amina` renders as `amina/sailo.store`.
              React Native's `Text` has no `dir`, so the direction is carried by
              the string itself: U+2066 opens the isolate, U+2069 closes it, and
              any text engine that understands bidi understands these.
            */}
            <Text variant="title" numberOfLines={1} selectable>
              {`⁦${shopUrl.replace(/^https?:\/\//, "")}⁩`}
            </Text>

            <View style={styles.linkActions}>
              <Button label={t.nav.viewShop} icon="external" onPress={openShop} />
              <Button
                label={t.share.shopTitle}
                icon="share"
                variant="ghost"
                onPress={shareShop}
              />
            </View>
          </View>
        </Card>

        {/*
          Today's three numbers.

          Each carries its own `caption`, rather than one heading above the row,
          and that is `Stat`'s contract rather than a layout preference: a
          figure over a windowed query that does not say so reads as a total,
          and a screen reader announces one `Stat` at a time with no heading in
          earshot.

          The date is the honest version of the word "Today". The window is
          resolved in UTC — `resolveAnalyticsWindow` works in UTC midnights, as
          the web dashboard's own range labels do — so a seller several hours
          ahead is looking at a named calendar day rather than at their own
          rolling one. Naming the day is what makes that readable instead of
          quietly wrong.
        */}
        <View style={styles.stats}>
          <Stat
            label={a.dashboard.netRevenue}
            value={formatMoney(numbers?.netRevenueCents ?? 0, currency, locale)}
            caption={covers}
            loading={stats.isPending}
          />
          <Stat
            label={a.dashboard.orders}
            value={count(numbers?.totalOrders ?? 0, locale)}
            caption={covers}
            loading={stats.isPending}
          />
          <Stat
            label={a.dashboard.visits}
            value={count(numbers?.visitsInRange ?? 0, locale)}
            caption={covers}
            loading={stats.isPending}
          />
        </View>

        {/*
          Renders only once the query has answered — the loading branch above
          returns first — so a seller never reads "No orders yet" about a
          request that is still in flight.

          No action on the empty state, and `EmptyState`'s note says to omit one
          only when there genuinely isn't one: here the way out is the link
          block two inches up the same screen, and a second "share your shop"
          control under it would be the card competing with the page it sits on.
        */}
        {latest.length > 0 ? (
          <View style={styles.recent}>
            <GroupedList header={a.dashboard.recentOrders}>
              {latest.map((order) => (
                <RecentRow
                  key={order.id}
                  order={order}
                  locale={locale}
                  statusLabels={a.orderStatus}
                  andMore={a.orders.andMore}
                  ago={ago}
                  now={now}
                  onPress={openOrder}
                />
              ))}
            </GroupedList>
            {/*
              Five is a bound, so the screen admits it. This is the only route
              from here to the rest of them.
            */}
            <Button
              label={a.common.viewAll}
              variant="ghost"
              icon="chevronEnd"
              iconPosition="end"
              onPress={() => router.navigate("/orders")}
            />
          </View>
        ) : (
          <EmptyState
            icon="orders"
            title={a.dashboard.noOrders}
            message={a.dashboard.noOrdersBody}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One of the five most recent orders.
 *
 * No status pill, unlike the Orders tab's rows: this list is five lines under a
 * block of numbers, and the status reads better as the middle of a sentence
 * than as a third column competing with the amount. The word itself is the same
 * one — `orderStatusLabel` over the same dictionary — so the two surfaces
 * cannot disagree about what an order's state is called.
 */
function RecentRow({
  order,
  locale,
  statusLabels,
  andMore,
  ago,
  now,
  onPress,
}: {
  order: Order;
  locale: string;
  statusLabels: Record<string, string>;
  /** `a.orders.andMore` — "+ {count} more", still holding its placeholder. */
  andMore: string;
  ago: (iso: string, now: number) => string;
  now: number;
  onPress: (id: string) => void;
}) {
  const subtitle = [
    order.customerName,
    orderStatusLabel(order.status, statusLabels),
    order.itemCount > 1 ? interpolate(andMore, { count: order.itemCount - 1 }) : null,
    ago(order.createdAt, now),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ListRow
      title={order.productTitle}
      subtitle={subtitle}
      value={formatMoney(order.totalCents, order.currency, locale)}
      trailing="chevron"
      onPress={() => onPress(order.id)}
      accessibilityLabel={[
        order.productTitle,
        subtitle,
        formatMoney(order.totalCents, order.currency, locale),
      ]
        .filter(Boolean)
        .join(", ")}
      testID={`recent-${order.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Dates and counts                                                           */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in UTC — the spelling `resolveAnalyticsWindow` parses. */
function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * What the numbers above actually cover, named rather than assumed.
 *
 * `until` is exclusive, so the last day on screen is the one just inside it —
 * the same arithmetic the web dashboard does for its own range label. A window
 * of a single day reads as that day; anything wider reads as both ends, which
 * is what a seller sees when a plan clamp or a rejected input has quietly
 * widened what they asked for.
 *
 * Formatted in UTC, because the bounds are UTC midnights: rendering them in the
 * phone's zone would name a day either side of the one that was counted.
 */
function windowLabel(
  window: { since: string; until: string; days: number },
  locale: string,
): string {
  const since = new Date(window.since);
  const lastDay = new Date(new Date(window.until).getTime() - 1);
  if (Number.isNaN(since.getTime()) || Number.isNaN(lastDay.getTime())) return "";

  let format: (date: Date) => string;
  try {
    const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
    format = (date) => formatter.format(date);
  } catch {
    // No usable Intl. An ISO day is unambiguous in every locale, which is the
    // property that matters at the point the runtime has stopped helping.
    format = (date) => utcDay(date);
  }

  const oneDay = window.until && new Date(window.until).getTime() - since.getTime() <= DAY_MS;
  return oneDay ? format(since) : `${format(since)} – ${format(lastDay)}`;
}

/**
 * A count, grouped the way the seller's language groups digits.
 *
 * Wrapped for the same reason every other formatter on the phone is: Hermes
 * ships a narrower ICU than a browser's, and an unrecognised locale throws
 * rather than degrading. The bare digits are still a truthful number.
 */
function count(value: number, locale: string): string {
  try {
    return value.toLocaleString(locale);
  } catch {
    return String(value);
  }
}

/*
 * Layout only — flex and spacing, nothing with a colour, a radius or a font
 * size in it. Every visual decision on this screen belongs to
 * `@sailo/design-native`; what is left is where the boxes sit relative to each
 * other, which is the one thing no component can decide on a screen's behalf.
 */
const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: 16, paddingBottom: 48, gap: 20 },
  linkBlock: { gap: 8 },
  linkHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  linkActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  stats: { flexDirection: "row", gap: 12 },
  recent: { gap: 8 },
});
