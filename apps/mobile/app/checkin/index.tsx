import { useCallback, useMemo } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { interpolate } from "@sailo/i18n/native";
import {
  EmptyState,
  ErrorState,
  ListRow,
  Skeleton,
} from "@sailo/design-native";
import { useT } from "../../lib/i18n";
import { useTRPC } from "../../lib/query";
import { errorMessage } from "../../components/states";

/**
 * Which door am I working tonight?
 *
 * The first screen of the check-in flow, and deliberately a list rather than a
 * guess. A venue running four rooms on one night has four doors, and a screen
 * that helpfully picked the soonest event would put a volunteer on the wrong
 * one — where every ticket they scan reads `wrong_event` and the queue does not
 * move.
 *
 * WHY PAST EVENTS ARE STILL HERE
 *
 * `events.list` returns the last thirty days as well as everything upcoming,
 * and that is the router's decision rather than this screen's: a door is still
 * being worked an hour after the advertised start — that is when the stragglers
 * arrive — and an organiser reconciling attendance the next morning needs the
 * list to still be there. The window is stated on screen rather than assumed,
 * because a list that silently ends thirty days back reads as a shop with no
 * older events.
 */
export default function EventPickerScreen() {
  const { a, locale } = useT();
  const trpc = useTRPC();
  const router = useRouter();

  const events = useQuery(trpc.events.list.queryOptions({ pastDays: PAST_DAYS }));

  /**
   * The date each event starts, in the seller's language.
   *
   * Built once per locale rather than per row: a door list is a few dozen
   * events and `DateTimeFormat` is not cheap to construct. Wrapped in a `try`
   * for the same reason `@sailo/core/currency` wraps `NumberFormat` — Hermes
   * ships a narrower ICU than a browser's, and the fallback is an ISO date,
   * which is at least unambiguous everywhere rather than English-shaped.
   */
  const when = useMemo(() => {
    let format: Intl.DateTimeFormat | null = null;
    try {
      format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      format = null;
    }
    return (value: string | Date | null): string | null => {
      if (!value) return null;
      const at = new Date(value).getTime();
      if (Number.isNaN(at)) return null;
      return format ? format.format(at) : new Date(at).toISOString().slice(0, 16).replace("T", " ");
    };
  }, [locale]);

  const refresh = useCallback(() => {
    void events.refetch();
  }, [events.refetch]);

  const open = useCallback(
    (productId: string) => {
      router.navigate({ pathname: "/checkin/[productId]", params: { productId } });
    },
    [router],
  );

  if (events.isPending) {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right"]}>
        <View style={styles.list}>
          <Skeleton shape="row" count={6} />
        </View>
      </SafeAreaView>
    );
  }

  if (events.error) {
    captureError(events.error, { scope: "mobile:checkin:events" });
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right"]}>
        <ErrorState
          message={a.checkin.title}
          detail={errorMessage(events.error, a.checkin.description)}
          onRetry={refresh}
          retrying={events.isFetching}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      <FlatList
        data={events.data}
        keyExtractor={(event) => event.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={events.isFetching && !events.isPending}
            onRefresh={refresh}
          />
        }
        renderItem={({ item }) => {
          /*
           * "12 of 40 in" — the one number a volunteer wants before they have
           * even chosen a door, because it says at a glance which room is
           * mid-rush and which has not opened yet.
           */
          const progress = interpolate(a.checkin.inOf, {
            checkedIn: item.checkedIn,
            issued: item.issued,
          });
          const starts = when(item.startsAt);
          const subtitle = [
            starts ? interpolate(a.checkin.startsAt, { when: starts }) : null,
            item.online ? null : item.location,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <ListRow
              title={item.title}
              subtitle={subtitle}
              value={progress}
              icon="ticket"
              trailing="chevron"
              onPress={() => open(item.id)}
              /*
               * One sentence rather than four stops. A screen reader announcing
               * "12 of 40 in" on its own has not said which door it is about.
               */
              accessibilityLabel={[item.title, subtitle, progress].filter(Boolean).join(", ")}
              testID={`checkin-event-${item.id}`}
            />
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="calendar"
            title={a.checkin.noEvents}
            message={a.checkin.noEventsBody}
          />
        }
      />
    </SafeAreaView>
  );
}

/**
 * How far back the list reaches, stated rather than hidden.
 *
 * The router defaults to the same thirty days; it is repeated here because the
 * screen is the thing that would have to say so, and a default that lives only
 * on the server is one this screen cannot describe honestly.
 */
const PAST_DAYS = 30;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
});
