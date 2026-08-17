/**

 * The feature that keeps the app installed: the seller learns about an order
 * without opening anything.
 *
 * Everything here is written around one fact — a push token is worthless on its
 * own. It only becomes a notification once the server has it filed against the
 * right account, so every path below ends in `push.register` or it has failed,
 * however well it went locally.
 *
 * The second thing shaping this file is that saying no is a legitimate answer.
 * iOS gives an app exactly one chance to show the system prompt, and a seller
 * who declines it can never be asked again from inside the app. So a refusal is
 * a state to be rendered, not an error to be retried: nothing here throws at the
 * caller, nothing blocks a screen, and every function answers with what is
 * actually true about this device.
 *
 * WHY THIS IS A FOLDER
 *
 * 670 lines answering four questions that arrive from four different places: may we notify,
 * is this device registered, where does a tap go, and what does the settings toggle do. They
 * shared a file because they share a vendor.
 *
 *   ./permission  the OS answer, and the seller's own
 *   ./device      registering this device, and forgetting it
 *   ./routing     where a tapped notification lands
 *   ./settings    the toggle, and the three states it reconciles
 *
 * The notification handler stays *here* rather than in one of them. It is a module-level side
 * effect that must run exactly once, and putting it in a leaf would mean it runs only if that
 * leaf happens to be imported — which is the kind of ordering bug that shows up as a
 * notification silently not appearing.
 */

import * as Notifications from "expo-notifications";

/**
 * Show a notification that lands while the seller is already looking at the
 * app. Without this, expo-notifications' default is to deliver it silently to
 * the listener and draw nothing — so the one case where the seller is holding
 * the phone is the one case they would see nothing.
 *
 * `shouldSetBadge: false`: a badge is a count of things needing attention, and
 * nothing here clears it. An app badge that only goes up is noise within a day.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/*
 * Named, not `export *`. The split had to export nine internals so the parts could reach each
 * other — the secure-store helpers, the opt-out keys, the Android channel, the token read. Any
 * of those re-exported from here becomes something a screen can reach for, and a screen
 * writing `TOKEN_KEY` directly is how the one place that reconciles registration stops being
 * the only place. What was public before the split is what is public now.
 */
export {
  currentPermission,
  pushSupported,
  requestPermission,
  type PushPermission,
} from "./permission";
export {
  forgetDevice,
  openSystemSettings,
  registerDevice,
  usePushPrimer,
  usePushRegistration,
  type PushRegistration,
} from "./device";
export { useNotificationRouting } from "./routing";
export { usePushSettings } from "./settings";
