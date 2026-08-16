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
} from "@sailo/design-system/native";
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
      {/*
        No header and no footer on this group, and that is a fix rather than an
        omission.

        It had `notifications` ("Email notifications") as its header and
        `notificationsBody` ("What Sailo emails you about your own shop") as its
        footer — around a switch that controls this handset's **push**
        permission and has nothing to do with email. Two sentences, both wrong,
        bracketing the one control on the screen a seller comes here to find.
        The row's own label and hint say what it is; the group needed neither.

        The right long-term fix is a dictionary key for the device layer.
        `@sailo/i18n` is A05's path and adding one means thirty-five
        translations, so the wrong words are removed rather than replaced.
      */}
      <GroupedList>
        <Switch
          value={push.enabled}
          /*
           * Inert where it cannot work, not merely ineffective.
           *
           * `unsupported` is a simulator, or a device with no push service.
           * The switch was live in that state: a tap moved it, the
           * registration came back `unsupported`, and it snapped back with
           * nothing said — which is exactly what "I pressed enable and it
           * didn't work" looks like. A control that refuses has to look
           * refused.
           */
          /*
           * `!__DEV__` on the last clause, and it is what makes the whole
           * notification UI testable.
           *
           * A seller can never reach `unsupported` — `Device.isDevice` is false
           * only in a simulator — so gating it on release builds changes
           * nothing anyone using the app will see. In a dev build on a
           * simulator the switch stays live, so tapping it raises the real iOS
           * permission alert; granting that is the only way `simctl push` will
           * *display* anything, which is what lets the banner, the tap-through
           * and the routing be exercised outside a physical phone.
           *
           * Registration still fails there (no APNs token), so the switch
           * lands on `failed` — which is the honest outcome, not a bug.
           */
          disabled={push.busy || push.blocked || (push.unsupported && !__DEV__)}
          busy={push.busy}
          onValueChange={(next) => void push.setEnabled(next)}
          label={a.settings.thisDevice}
          testID="notify-device"
          hint={
            push.permission === "blocked"
              ? a.checkin.scanBlockedBody
              : /*
                 * Dev-only, and deliberately untranslated. `unsupported` is
                 * unreachable on a seller's phone — `Device.isDevice` is false
                 * only in a simulator — so this is a note to whoever is
                 * testing, not copy. Shipping it through the dictionary would
                 * put a sentence about simulators in front of thirty-five
                 * translators for a state none of their users can reach.
                 */
                push.unsupported && __DEV__
                ? "Push needs a physical device — a simulator has no APNs token."
                : undefined
          }
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
        Allowed, and still not registered.

        The state that used to be invisible: the OS said yes, the token or the
        write to the server did not land, and the switch turned on anyway. The
        seller then waits for notifications that can never arrive. Saying so —
        with the one action that can fix it, trying again — is the whole
        difference between a transient network failure and a silent one.
      */}
      {push.failed ? (
        <Banner
          tone="danger"
          title={t.errors.title}
          message={t.errors.body}
          actionLabel={t.errors.retry}
          onAction={() => void push.setEnabled(true)}
          testID="push-failed"
        />
      ) : null}

      {/*
        The account layer. Deliberately *not* disabled while the device switch
        is off: these decide email as well, and a seller who has silenced this
        handset has not asked to stop being emailed about a payment that needs
        confirming.
      */}
      {/* No header: the navigation bar above already says "What to tell me
          about", and a screen that says its own name twice is the double-title
          this pass removed everywhere else. The footer stays — it says
          something the title does not, that these reach email too. */}
      <GroupedList footer={a.settings.notifyAllDevices}>
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
