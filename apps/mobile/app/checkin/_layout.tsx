import { Stack } from "expo-router";
import { useT } from "../../lib/i18n";
import { useStackScreenOptions } from "../../lib/navigation";

/**
 * The door, presented rather than pushed.
 *
 * It is a self-contained task with a start and an end — a volunteer works one
 * event for one evening — so it gets its own modal stack outside the tabs. That
 * is not only a navigation preference: a scanner living inside a tab is a
 * scanner somebody swipes out of by accident with a queue in front of them, and
 * the tab bar underneath is four ways to lose the camera mid-shift.
 */
export default function CheckinLayout() {
  const { a } = useT();
  const screenOptions = useStackScreenOptions();

  return (
    /*
     * The sixth stack, and the one that was drawing the platform's default
     * header rather than Sailo's — so the scanner's title bar was white in dark
     * mode while every other stack's was near-black. `headerShown: true` was
     * the only option it set.
     *
     * `headerLargeTitle` is off here, and only here: the screen underneath is a
     * camera viewfinder that fills the window, and a large title collapsing
     * into the bar as it scrolls needs something scrolling to collapse against.
     */
    <Stack screenOptions={{ ...screenOptions, headerShown: true, headerLargeTitle: false }}>
      <Stack.Screen name="index" options={{ title: a.checkin.title }} />
      {/*
        Titled by the screen once the event has loaded — naming it here would
        flash a generic word before the event's own name arrives.
      */}
      <Stack.Screen name="[productId]" options={{ title: "" }} />
    </Stack>
  );
}
