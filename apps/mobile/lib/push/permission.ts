/**
 * Whether this device may notify, and whether the seller wants it to.
 *
 * Two different questions, kept apart deliberately: the OS permission is "may this app notify",
 * and `OPT_OUT_KEY` is "do I want it to". A seller who turns the toggle off has revoked nothing
 * at the system level, and without remembering their answer here the next launch would helpfully
 * register them again.
 */

import { Platform } from "react-native";
import { captureError } from "@sailo/observability";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

/**
 * The seller's own answer, kept on the device.
 *
 * Separate from the OS permission on purpose: permission is "may this app
 * notify", this is "do I want it to". A seller who turns the toggle off has not
 * revoked anything at the system level, and without remembering it here the
 * next launch would helpfully register them again.
 */
export const OPT_OUT_KEY = "sailo_push_opt_out";

/**
 * The token this device last registered.
 *
 * Kept so that signing out can say *which* row to remove without asking Expo
 * for the token again. That request needs the network and needs the permission
 * the seller may have revoked an hour ago in the system Settings app — and both
 * of those failing is precisely the moment the row most needs deleting, because
 * the phone is about to be signed out with a live address still on the server.
 */
export const TOKEN_KEY = "sailo_push_token";

/** What this device can actually do, which is not always what we would like. */
export type PushPermission =
  /** Allowed. A token can be fetched. */
  | "granted"
  /** Not yet asked, or Android where asking again is allowed. */
  | "askable"
  /**
   * Refused, and the app may not ask again — the seller has to go to the system
   * Settings app. The distinction matters: showing an in-app "Allow" button
   * that silently does nothing is worse than sending them somewhere real.
   */
  | "blocked";

/**
 * Whether this build can be issued a push token at all.
 *
 * Separate from the permission, and that separation is a fix. `unsupported`
 * used to be a *permission* value returned by checking `Device.isDevice` — so
 * the function that claimed to report "what has the OS allowed" actually
 * reported "what hardware is this", and on a simulator it answered a question
 * nobody asked. The two are genuinely different: a simulator **can display a
 * notification** and cannot **mint an APNs token**, and conflating them meant
 * the app never even asked for permission there, which is why the notification
 * UI could not be exercised anywhere except on a phone.
 */
export function pushSupported(): boolean {
  return Device.isDevice;
}

/**
 * The keychain, treated as advisory.
 *
 * Nothing stored here is authoritative — the server holds the registration and
 * the OS holds the permission — so a keychain that will not answer degrades the
 * feature rather than breaking it. Every read has a defined answer for "no
 * idea", and no write is allowed to throw into a sign-out.
 */
export async function recall(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function remember(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch (error) {
    captureError(error, { scope: "mobile:push:store" });
  }
}

export async function readOptOut(): Promise<boolean> {
  // Absence means "never said no", which is the right default for a seller who
  // has not been asked yet.
  return (await recall(OPT_OUT_KEY)) === "1";
}

export async function writeOptOut(value: boolean): Promise<void> {
  await remember(OPT_OUT_KEY, value ? "1" : null);
}

/** What the OS says today, without prompting anyone. */
export async function currentPermission(): Promise<PushPermission> {
  /*
   * No hardware check here any more — see `pushSupported`. This answers only
   * "what has the OS allowed", which a simulator can answer perfectly well.
   * Whether a *token* can be minted is `registerDevice`'s problem, and it is
   * the one place `Device.isDevice` belongs.
   */
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "granted";
    return canAskAgain ? "askable" : "blocked";
  } catch (error) {
    captureError(error, { scope: "mobile:push:permission" });
    return "blocked";
  }
}

/** Ask, if asking is still possible. Returns where that left us. */
export async function requestPermission(): Promise<PushPermission> {
  const existing = await currentPermission();
  if (existing !== "askable") return existing;
  try {
    const { status, canAskAgain } = await Notifications.requestPermissionsAsync();
    if (status === "granted") return "granted";
    return canAskAgain ? "askable" : "blocked";
  } catch (error) {
    captureError(error, { scope: "mobile:push:request" });
    return "blocked";
  }
}

/**
 * Android shows a heads-up banner only for a channel that asked for one, and a
 * channel it has never heard of gets the default importance — which is the
 * quiet, no-banner one. So the channel has to exist before the first
 * notification arrives, not when one does.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("orders", {
      name: "Orders",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      /*
       * The notification LED, in the brand's green.
       *
       * It was `#4f46e5` — an indigo that appears nowhere else in the product
       * and belongs to the framework default palette this codebase spent a
       * release removing. It is a small surface, but it is the same green
       * `app.json` gives the notification icon two files away, and the two
       * disagreeing is a light of one colour behind an icon of another.
       *
       * `brand-700`, spelled out rather than imported: this module runs from a
       * notification handler with no React tree, so `useTheme()` is not
       * reachable here — and Android's channel colour is a single value that
       * cannot follow the phone's scheme in any case, since the channel is
       * created once and the OS owns it from then on.
       */
      lightColor: "#037740",
    });
  } catch (error) {
    captureError(error, { scope: "mobile:push:channel" });
  }
}

/**
 * This device's Expo push token, or null if it could not be had.
 *
 * The project id is passed explicitly. Expo can infer it in a managed dev
 * client and cannot in a build, and the failure mode when it cannot is a
 * runtime error at exactly the moment the seller agreed to be notified.
 */
export async function deviceToken(): Promise<string | null> {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) {
    captureError(new Error("No EAS project id — cannot fetch a push token"), {
      scope: "mobile:push:token",
    });
    return null;
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (error) {
    // Offline, or push credentials not yet uploaded for this build. Both are
    // temporary, and both are fixed by the next launch trying again.
    captureError(error, { scope: "mobile:push:token" });
    return null;
  }
}

/**
 * Get this device registered, from wherever it currently stands.
 *
 * `ask` is the difference between the two callers. A launch registers a device
 * that is already allowed and, on the first launch after signing in, asks —
 * that being the moment the seller has just demonstrated they care about this
 * shop. The settings toggle always asks, because there the seller reached for
 * it deliberately.
 */
