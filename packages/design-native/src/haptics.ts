import { Platform } from "react-native";
import * as Expo from "expo-haptics";

/**
 * The taps the phone gives back, as five names instead of two vendor enums.
 *
 * WHY THIS IS IN THE DESIGN SYSTEM AND NOT IN THE SCREENS
 *
 * It was in the screens, and that is how it drifted: `orders/[id].tsx` and
 * `store/index.tsx` both call `notificationAsync(Success)` after a write, and
 * `checkin/[productId].tsx` picks between three types inline — while every
 * button in the app gave no feedback at all. Haptics that some controls have
 * and others do not is worse than none, because the seller learns the buzz
 * means "it worked" and then taps something that worked silently.
 *
 * So the primitives call this, every one of them, and a screen only reaches for
 * it directly when it is confirming something the primitives cannot see — a
 * scan that matched, a payout that landed.
 *
 * THE PART THAT IS ACTUALLY ABOUT PLATFORMS
 *
 * iOS has a Taptic Engine and a documented vocabulary; Android has a vibration
 * motor and an OEM-dependent interpretation of the same API, and on a good
 * chunk of Android hardware `impactAsync(Light)` is indistinguishable from
 * `Medium`. That is fine and it is why the names below are *intents* rather
 * than intensities: `selection` means "you moved between two things", and each
 * platform is allowed to render that however it can.
 *
 * Everything is fire-and-forget and nothing here is awaited. A haptic is
 * feedback about something that already happened; making the handler that
 * caused it wait on the motor is how a button gains 20ms of lag for no reason.
 */

/** Whether this platform has anything to say. Web has no motor at all. */
const supported = Platform.OS === "ios" || Platform.OS === "android";

/**
 * Nothing here may throw.
 *
 * `expo-haptics` rejects on a device with the motor disabled in system
 * settings, in a simulator without one, and on any platform where the native
 * module is missing. Every one of those is a normal state of the world, not an
 * error — and an unhandled rejection from a button's `onPress` is a red box
 * over a screen that worked.
 */
function fire(run: () => Promise<void>): void {
  if (!supported) return;
  try {
    void run().catch(() => {});
  } catch {
    /* Native module absent. The tap still did its job. */
  }
}

export const haptics = {
  /** A control was pressed. The lightest thing the phone can do. */
  tap: () => fire(() => Expo.impactAsync(Expo.ImpactFeedbackStyle.Light)),
  /** Something committed — a sheet opened, a toggle latched. */
  press: () => fire(() => Expo.impactAsync(Expo.ImpactFeedbackStyle.Medium)),
  /** The value under a control changed: a segment, a picker, a stepper. */
  selection: () => fire(() => Expo.selectionAsync()),
  /** It worked. Reserve it for the end of a task, not for every tap. */
  success: () => fire(() => Expo.notificationAsync(Expo.NotificationFeedbackType.Success)),
  /** It did not work, and the seller has to do something about it. */
  error: () => fire(() => Expo.notificationAsync(Expo.NotificationFeedbackType.Error)),
  /** It worked, with something worth reading — a partial scan, a duplicate. */
  warning: () => fire(() => Expo.notificationAsync(Expo.NotificationFeedbackType.Warning)),
} as const;

export type Haptic = keyof typeof haptics;
