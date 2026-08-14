import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { interpolate } from "@sailo/i18n/native";
import {
  Button,
  Card,
  EmptyState,
  Screen,
  Stat,
  Text,
  haptics,
} from "@sailo/design-native";
import { useT } from "../../lib/i18n";
import { useTRPC } from "../../lib/query";
import { useScanQueue, type ScanOutcome } from "../../lib/scan-queue";

/**
 * The door.
 *
 * Everything on this screen is shaped by two facts about the job. The first is
 * that it is done fast — a person every few seconds with a queue behind them —
 * so the answer has to be readable without being read: a full-bleed colour and
 * a distinct haptic, not a line of text somebody has to focus on in the dark.
 *
 * The second is that the venue has no signal. `useScanQueue` never waits on the
 * network to answer, so a scan is accepted, felt, and drawn immediately; the
 * server hears about it whenever it can. The counter of unsent scans is on
 * screen rather than hidden, because a volunteer handing the phone over at the
 * end of a shift needs to know whether the night has been filed.
 */

/** How long an outcome stays on screen before the camera is armed again. */
const OUTCOME_MS = 900;

export default function Door() {
  const { productId, title } = useLocalSearchParams<{ productId: string; title?: string }>();
  const { a, locale } = useT();
  const trpc = useTRPC();
  const navigation = useNavigation();

  const [permission, requestPermission] = useCameraPermissions();
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const { scan, drain, pending, draining } = useScanQueue(productId ?? null);

  /*
   * A door screen that dims mid-shift is a door screen somebody has to wake up
   * between every guest. Scoped to this screen, so it releases the moment the
   * volunteer leaves rather than holding the display on for the rest of the app.
   */
  useKeepAwake();

  const door = useQuery(
    trpc.events.door.queryOptions({ productId: productId ?? "" }, { enabled: Boolean(productId) }),
  );

  /*
   * The event names its own screen from the first frame. The title arrives as a
   * route param rather than from a query, because `events.door` returns
   * counters and rows and knows nothing about the event — waiting for a second
   * request would open the door screen blank.
   */
  useEffect(() => {
    if (title) navigation.setOptions({ title });
  }, [title, navigation]);

  /*
   * One scan at a time. `CameraView` fires `onBarcodeScanned` continuously
   * while a code is in frame — dozens of times a second — and without a latch
   * a single wristband becomes fifty requests and fifty haptics.
   */
  const busy = useRef(false);

  const onScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (busy.current || !data) return;
      busy.current = true;

      const result = await scan(data);
      setOutcome(result);

      /*
       * The haptic carries the answer, because the phone is usually not being
       * looked at. Three distinct patterns, and `already` is deliberately not
       * an error: somebody coming back in is a normal thing that happens all
       * night, and buzzing it like a refusal trains volunteers to ignore the
       * refusals that matter.
       */
      /*
       * Through the design system's own vocabulary rather than through
       * `expo-haptics` directly. Three screens each reached for the vendor enum
       * and every control in the app buzzed differently or not at all;
       * `haptics.ts` says why that is worse than none. It is also fire-and-
       * forget — this used to be awaited, so the counter refetch on the next
       * line waited on a vibration motor.
       */
      if (result === "admitted") haptics.success();
      else if (result === "invalid") haptics.error();
      else haptics.warning();

      // Counters only move on a confirmed admission; a queued scan has not been
      // counted by anything yet and showing it as counted would be a lie the
      // reconciliation the next morning would catch.
      if (result === "admitted") void door.refetch();

      setTimeout(() => {
        setOutcome(null);
        busy.current = false;
      }, OUTCOME_MS);
    },
    [scan, door.refetch],
  );

  if (!permission) return null;

  /*
   * Permission is asked for here rather than on mount, with the reason on
   * screen — the volunteer is looking at a door, so "we need the camera to read
   * tickets" is self-evident and the prompt lands in context. A refusal is a
   * rendered state, never a dead camera: iOS gives one chance at the system
   * prompt, and a blocked volunteer needs the guest list, not a button that
   * silently does nothing.
   */
  if (!permission.granted) {
    return (
      <Screen scroll={false} center>
      <EmptyState
        icon="camera"
        title={a.checkin.scanBlocked}
        message={a.checkin.scanBlockedBody}
        action={
          permission.canAskAgain
            ? { label: a.checkin.tabScan, onPress: () => void requestPermission() }
            : undefined
        }
      />
      </Screen>
    );
  }

  const stats = door.data?.stats;

  return (
    /*
     * `scroll={false}`, because the viewfinder fills whatever is left and a
     * camera inside a scroll view is a camera with no height. `Screen` also
     * paints the page, which matters here more than anywhere: the letterbox
     * around a 4:3 sensor on a tall handset was the platform's default white,
     * on the one screen somebody uses in a dark room.
     */
    <Screen scroll={false} testID="scanner">
      <Card padding="md">
        <View style={styles.stats}>
          <Stat
            label={a.checkin.statIn}
            value={count(stats?.checkedIn ?? 0, locale)}
            loading={door.isPending}
          />
          <Stat
            label={a.checkin.statOut}
            value={count(Math.max(0, (stats?.issued ?? 0) - (stats?.checkedIn ?? 0)), locale)}
            loading={door.isPending}
          />
          <Stat
            label={a.checkin.statIssued}
            value={count(stats?.issued ?? 0, locale)}
            loading={door.isPending}
          />
        </View>
      </Card>

      <View style={styles.camera}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          // Only the symbologies a ticket actually uses. Left open, the reader
          // fires on a barcode on somebody's shopping and burns a scan slot.
          barcodeScannerSettings={{ barcodeTypes: ["qr", "pdf417", "code128"] }}
          onBarcodeScanned={outcome ? undefined : (event) => void onScanned(event)}
        />

        {/*
          The answer, full-bleed over the viewfinder. Colour first because it is
          read at arm's length in the dark; the word is for the case where two
          volunteers disagree about what they just saw.
        */}
        {outcome ? (
          <View style={[StyleSheet.absoluteFill, styles.flash, flashStyle(outcome)]}>
            <Text variant="title" tone="inverse" align="center">
              {
                {
                  admitted: a.checkin.statIn,
                  already: a.checkin.inAt.replace("{time}", ""),
                  invalid: a.checkin.revoked,
                  queued: a.checkin.submit,
                }[outcome]
              }
            </Text>
          </View>
        ) : (
          <View style={styles.hint} pointerEvents="none">
            <Text variant="callout" tone="inverse" align="center">
              {a.checkin.scanReady}
            </Text>
          </View>
        )}
      </View>

      {/*
        The unsent count, always visible when it is not zero. A volunteer
        handing the phone over at the end of the night has to be able to see
        that the door has been filed — a queue that drains silently is a queue
        nobody notices has not.
      */}
      {pending > 0 ? (
        <Card variant="outlined" padding="md">
          <Text variant="caption" tone="warning">
            {interpolate(a.checkin.showingOf, {
              shown: count(pending, locale),
              total: count(pending, locale),
            })}
          </Text>
          <Button
            label={a.common.save}
            onPress={() => void drain()}
            loading={draining}
            variant="secondary"
            size="sm"
          />
        </Card>
      ) : null}
    </Screen>
  );
}

/**
 * The full-bleed answer over the viewfinder.
 *
 * The four values are `brand-700`, `warning`, `danger` and `ink-600` at 92%
 * opacity — the palette's own greens, ambers and reds, written here with an
 * alpha channel because they are drawn *over a camera feed* rather than over a
 * page. That is also why they do not switch with the phone's colour scheme:
 * what is behind them is whatever the room looks like, and a dark-mode variant
 * of "admitted" would be a green nobody could read at arm's length in a lit
 * doorway. This is the one place in the app where a colour is correctly not a
 * function of the theme.
 */
function flashStyle(outcome: ScanOutcome) {
  return {
    admitted: { backgroundColor: "rgba(3, 119, 64, 0.92)" },
    already: { backgroundColor: "rgba(181, 71, 8, 0.92)" },
    invalid: { backgroundColor: "rgba(180, 35, 24, 0.92)" },
    queued: { backgroundColor: "rgba(85, 82, 75, 0.92)" },
  }[outcome];
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
  camera: { flex: 1, borderRadius: 20, overflow: "hidden" },
  flash: { alignItems: "center", justifyContent: "center", padding: 24 },
  /* Logical insets, not `left`/`right`. The hint is centred so the difference
     is invisible today — and it is exactly the kind of physical edge that is
     still there, wrong, the day somebody aligns it to one side. */
  hint: {
    position: "absolute",
    insetInlineStart: 0,
    insetInlineEnd: 0,
    bottom: 24,
    paddingHorizontal: 24,
  },
});
