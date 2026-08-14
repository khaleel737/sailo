import { Stack } from "expo-router";
import { useT } from "../../lib/i18n";

/**
 * The door, as its own stack.
 *
 * Working a door is a task with a start and an end, not a place in the app —
 * somebody picks an event, stands at an entrance for three hours, and leaves.
 * So it lives outside the tab bar rather than inside it, and the work order is
 * explicit about why: door staff should not be able to swipe into Insights by
 * accident while a queue is forming in front of them.
 *
 * **It is pushed, and it should be presented.** A full-screen modal is the
 * shape this wants — no tab bar underneath, no way back except the one this
 * screen offers — and that is a property of how the *parent* stack presents
 * this route, not something a child layout can set for itself. It needs
 * `<Stack.Screen name="checkin" options={{ presentation: "fullScreenModal" }} />`
 * in `app/_layout.tsx`, which belongs to A00 and is not this work order's to
 * edit. Until that lands the flow works correctly and simply arrives the
 * ordinary way.
 *
 * The header is shown here where the root hides it, because these screens are a
 * stack a volunteer navigates rather than tabs they switch between — and the
 * back affordance has to be the platform's, drawn on the correct side, rather
 * than something drawn on this side of the boundary.
 */
export default function CheckinLayout() {
  const { a } = useT();

  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: a.checkin.title }} />
      {/*
        The title is set by the screen itself once the event has a name — the
        event is what the volunteer is actually working, and "Check-in" twice in
        a row tells them nothing about which door they are standing at.
      */}
      <Stack.Screen name="[productId]" />
    </Stack>
  );
}
