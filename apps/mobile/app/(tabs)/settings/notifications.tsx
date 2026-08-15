import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import {
  Banner,
  ErrorState,
  GroupedList,
  Screen,
  Skeleton,
  Switch,
  haptics,
} from "@sailo/design-native";
import { openSystemSettings, usePushSettings } from "../../../lib/push";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * Which events are worth interrupting the seller for.
 *
 * TWO LAYERS, AND THEY ARE NOT THE SAME QUESTION
 *
 * The first switch is the *device*: has this handset been allowed to show a
 * notification at all. It lives in `usePushSettings`, it can be refused by the
 * operating system, and turning it off silences this phone and nothing else.
 *
 * The three below it are the *account*: which events Sailo should tell the
 * seller about, on every device and by email. They are stored on the shop and
 * read by senders that do not exist yet — which is why the schema is a
 * `strictObject` and why absence means on.
 *
 * A screen that merged them would be a screen where turning off "order placed"
 * on a spare phone stopped the emails too.
 *
 * ABSENCE MEANS ON
 *
 * `notificationPrefs` is `{}` for a shop that has never opened this screen, and
 * `{}` means everything. So a switch reads `prefs.x !== false` rather than
 * `prefs.x === true` — and a shop that never touched this is subscribed to an
 * event type added next year without anyone running a backfill.
 *
 * WHOLE-OBJECT WRITES
 *
 * The mutation sends every key, not a patch. This screen holds all three
 * switches so it always knows the complete answer, and a merge would make
 * "turned off" and "not mentioned" indistinguishable at exactly the point
 * where absence already carries meaning.
 */

/** The three events, in the order a seller cares about them. */
const EVENTS = [
  { key: "orderPlaced", label: "notifyOrderPlaced", body: "notifyOrderPlacedBody" },
  {
    key: "orderNeedsAction",
    label: "notifyOrderNeedsAction",
    body: "notifyOrderNeedsActionBody",
  },
  {
    key: "bookingRequested",
    label: "notifyBookingRequested",
    body: "notifyBookingRequestedBody",
  },
] as const;

export default function Notifications() {
  const { a, t } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const push = usePushSettings();

  const prefs = useQuery(trpc.account.notificationPrefs.queryOptions());

  const save = useMutation(
    trpc.account.setNotificationPrefs.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        await queryClient.invalidateQueries(trpc.account.pathFilter());
      },
      onError: (error) => {
        haptics.error();
        captureError(error, { scope: "mobile:settings:notifications" });
      },
    }),
  );

  const refresh = useCallback(() => {
    void prefs.refetch();
    void push.refresh();
  }, [prefs.refetch, push.refresh]);

  if (prefs.error) {
    reportQueryError(prefs.error, { scope: "mobile:settings:notifications" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(prefs.error, a.common.couldntLoad)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={prefs.isFetching}
        />
      </Screen>
    );
  }

  if (prefs.isPending) {
    return (
      <Screen>
        <Skeleton shape="card" count={2} />
      </Screen>
    );
  }

  const current = prefs.data;
  /** Absence means on — see the header. */
  const enabled = (key: (typeof EVENTS)[number]["key"]) => current[key] !== false;

  const set = (key: (typeof EVENTS)[number]["key"], value: boolean) =>
    save.mutate({
      /* Every key, every time. The screen holds them all, so it always knows
         the complete answer. */
      orderPlaced: key === "orderPlaced" ? value : enabled("orderPlaced"),
      orderNeedsAction: key === "orderNeedsAction" ? value : enabled("orderNeedsAction"),
      bookingRequested: key === "bookingRequested" ? value : enabled("bookingRequested"),
    });

  return (
    <Screen onRefresh={refresh} refreshing={prefs.isFetching} testID="notifications">
      {/*
        The device layer. Its hint carries the whole difference between "off"
        and "off, and tapping this will not help" — the case where the seller
        said no once and the OS will not let the app ask again.
      */}
      <GroupedList header={a.settings.notifications} footer={a.settings.notificationsBody}>
        <Switch
          value={push.enabled}
          disabled={push.busy || push.blocked}
          busy={push.busy}
          onValueChange={(next) => void push.setEnabled(next)}
          label={a.settings.thisDevice}
          hint={push.permission === "blocked" ? a.checkin.scanBlockedBody : undefined}
        />
      </GroupedList>

      {push.permission === "blocked" ? (
        <Banner
          tone="warning"
          message={a.checkin.scanBlockedBody}
          actionLabel={a.settings.notifications}
          onAction={() => void openSystemSettings()}
        />
      ) : null}

      {/*
        The account layer. Deliberately *not* disabled while the device switch
        is off: these decide email as well, and a seller who has silenced this
        handset has not asked to stop being emailed about a payment that needs
        confirming.
      */}
      <GroupedList header={a.settings.tabNotifications} footer={a.settings.notifyAllDevices}>
        {EVENTS.map((event) => (
          <Switch
            key={event.key}
            value={enabled(event.key)}
            busy={save.isPending && save.variables?.[event.key] !== undefined}
            onValueChange={(next) => set(event.key, next)}
            label={a.settings[event.label]}
            hint={a.settings[event.body]}
            testID={`notify-${event.key}`}
          />
        ))}
      </GroupedList>
    </Screen>
  );
}
