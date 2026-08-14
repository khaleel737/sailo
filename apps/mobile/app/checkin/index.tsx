import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { interpolate } from "@sailo/i18n/native";
import {
  EmptyState,
  ErrorState,
  GroupedList,
  ListRow,
  Screen,
  Skeleton,
} from "@sailo/design-native";
import { useT } from "../../lib/i18n";
import { reportQueryError, useTRPC } from "../../lib/query";
import { errorMessage } from "../../components/states";

/**
 * Which door am I working tonight?
 *
 * The list runs thirty days back as well as forward, which `events.list`
 * decides and this screen states. A door is still being worked an hour after
 * the advertised start — that is when the stragglers arrive — and an organiser
 * reconciling attendance the next morning needs last night's event to still be
 * reachable.
 */
export default function CheckinPicker() {
  const { a, t, locale } = useT();
  const trpc = useTRPC();
  const router = useRouter();

  const events = useQuery(trpc.events.list.queryOptions());

  const refresh = useCallback(() => {
    void events.refetch();
  }, [events.refetch]);

  if (events.error) {
    reportQueryError(events.error, { scope: "mobile:checkin:list" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(events.error, a.checkin.title)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={events.isFetching}
        />
      </Screen>
    );
  }

  if (events.isPending) {
    return (
      <Screen scroll={false} testID="checkin-loading">
        <Skeleton shape="row" count={4} />
      </Screen>
    );
  }

  const rows = events.data ?? [];

  return (
    <Screen onRefresh={refresh} refreshing={events.isFetching} testID="checkin">
      {rows.length === 0 ? (
        <EmptyState icon="ticket" title={a.checkin.noEvents} message={a.checkin.noEventsBody} />
      ) : (
        <GroupedList header={a.checkin.description}>
          {rows.map((event) => (
            <ListRow
              key={event.id}
              title={event.title}
              /*
               * The counter is the useful line, not the date: a volunteer
               * picking a door wants to know which one is mid-shift. Both
               * numbers come from the server so this never counts anything
               * itself.
               */
              subtitle={interpolate(a.checkin.inOf, {
                checkedIn: count(event.checkedIn, locale),
                issued: count(event.issued, locale),
              })}
              trailing="chevron"
              onPress={() =>
                router.push({
                  pathname: "/checkin/[productId]",
                  // The title travels with the id so the door can name itself
                  // on its first frame. `events.door` returns counters and
                  // rows, not the event, and a screen that waited for a second
                  // query to learn its own name would open blank.
                  params: { productId: event.id, title: event.title },
                })
              }
            />
          ))}
        </GroupedList>
      )}
    </Screen>
  );
}

function count(value: number, locale: string): string {
  try {
    return value.toLocaleString(locale);
  } catch {
    return String(value);
  }
}
