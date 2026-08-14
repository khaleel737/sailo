import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { captureError } from "@sailo/observability";
import { api } from "./api";
import { authClient } from "./auth";

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
 */

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

/**
 * The seller's own answer, kept on the device.
 *
 * Separate from the OS permission on purpose: permission is "may this app
 * notify", this is "do I want it to". A seller who turns the toggle off has not
 * revoked anything at the system level, and without remembering it here the
 * next launch would helpfully register them again.
 */
const OPT_OUT_KEY = "sailo_push_opt_out";

/**
 * The token this device last registered.
 *
 * Kept so that signing out can say *which* row to remove without asking Expo
 * for the token again. That request needs the network and needs the permission
 * the seller may have revoked an hour ago in the system Settings app — and both
 * of those failing is precisely the moment the row most needs deleting, because
 * the phone is about to be signed out with a live address still on the server.
 */
const TOKEN_KEY = "sailo_push_token";

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
  | "blocked"
  /** A simulator, or a device with no push support. No token exists to fetch. */
  | "unsupported";

/**
 * The keychain, treated as advisory.
 *
 * Nothing stored here is authoritative — the server holds the registration and
 * the OS holds the permission — so a keychain that will not answer degrades the
 * feature rather than breaking it. Every read has a defined answer for "no
 * idea", and no write is allowed to throw into a sign-out.
 */
async function recall(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function remember(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch (error) {
    captureError(error, { scope: "mobile:push:store" });
  }
}

async function readOptOut(): Promise<boolean> {
  // Absence means "never said no", which is the right default for a seller who
  // has not been asked yet.
  return (await recall(OPT_OUT_KEY)) === "1";
}

async function writeOptOut(value: boolean): Promise<void> {
  await remember(OPT_OUT_KEY, value ? "1" : null);
}

/** What the OS says today, without prompting anyone. */
export async function currentPermission(): Promise<PushPermission> {
  /*
   * A simulator can display a local notification but can never be issued a push
   * token, and `getExpoPushTokenAsync` fails there with an error that reads
   * like a misconfiguration. Checking first is what keeps that out of the logs
   * and out of the seller's face.
   */
  if (!Device.isDevice) return "unsupported";
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
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("orders", {
      name: "Orders",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#4f46e5",
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
async function deviceToken(): Promise<string | null> {
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
export async function registerDevice(opts?: {
  ask?: boolean;
}): Promise<PushPermission> {
  const permission = opts?.ask
    ? await requestPermission()
    : await currentPermission();
  if (permission !== "granted") return permission;

  await ensureAndroidChannel();

  const token = await deviceToken();
  if (!token) return permission;

  try {
    await api.push.register.mutate({
      token,
      // Expo's token is minted per platform, and the column records which.
      platform: Platform.OS === "android" ? "android" : "ios",
    });
    await writeOptOut(false);
    // Only after the server has it. Remembering a token we failed to register
    // would have sign-out deleting a row that was never written.
    await remember(TOKEN_KEY, token);
  } catch (error) {
    // The seller is signed in and allowed; this is the network. Next launch
    // re-registers, and the upsert on the server makes that free.
    captureError(error, { scope: "mobile:push:register" });
  }
  return permission;
}

/**
 * Forget this device, server-side and locally.
 *
 * **Call this before `signOut`, not after.** Removing the row needs the session
 * that is about to be destroyed, and a token left behind keeps delivering the
 * shop's orders to the lock screen of a phone that has deliberately been signed
 * out of.
 *
 * `stayOff` is the difference between the two callers. The settings toggle
 * passes it, because the seller said no and the next launch must not helpfully
 * undo that. Sign-out does not: leaving the shop is not a preference about
 * notifications, and recording it as one would leave the next seller to sign in
 * on this handset silently un-notified.
 */
export async function forgetDevice(opts?: { stayOff?: boolean }): Promise<void> {
  if (opts?.stayOff) await writeOptOut(true);

  /*
   * The token we registered, not a freshly fetched one. Asking Expo again would
   * put a network round trip and a permission check between the seller and the
   * sign-out they asked for — and it fails exactly when the seller has since
   * revoked notifications in the system Settings app, which is a state where
   * the row very much still needs deleting.
   */
  const token = await recall(TOKEN_KEY);
  if (!token) return;

  try {
    await api.push.unregister.mutate({ token });
    await remember(TOKEN_KEY, null);
  } catch (error) {
    /*
     * Left in the keychain deliberately. The row is still on the server, and
     * keeping the token is what lets the next sign-out — or the re-register on
     * the next launch, which moves the row rather than duplicating it — put
     * things right.
     */
    captureError(error, { scope: "mobile:push:forget" });
  }
}

/** Where a blocked seller has to go, since the app may no longer ask them. */
export async function openSystemSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (error) {
    captureError(error, { scope: "mobile:push:settings" });
  }
}

/**
 * Registers the signed-in seller's device, once per session, at the root.
 *
 * Keyed on the user id rather than run on mount: the app can go from signed out
 * to signed in without remounting, and that transition — not the mount — is the
 * moment there is an account to file a token against. It is also what makes a
 * device handover work, because the second seller's sign-in registers the same
 * token under their id and the server's upsert moves the row.
 *
 * Everything it does is fire-and-forget. Nothing renders differently while it
 * runs and nothing renders differently if it fails, which is the whole point:
 * push is what the app does when the seller is not looking at it, and it must
 * never be something they have to wait for when they are.
 */
export function usePushRegistration(): void {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  /*
   * One attempt per signed-in user. Without this the effect re-runs on every
   * session refresh, and on iOS a second `requestPermissionsAsync` while the
   * first prompt is still up resolves to the wrong answer.
   */
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || asked.current === userId) return;
    asked.current = userId;
    void (async () => {
      if (await readOptOut()) return;
      await registerDevice({ ask: true });
    })();
  }, [userId]);
}

/* -------------------------------------------------------------------------- */
/*  Tapping one                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The taps this process has already acted on.
 *
 * Module scope rather than a ref, because the two things that have to be
 * de-duplicated outlive any one component. `getLastNotificationResponseAsync`
 * keeps answering with the tap that launched the app for as long as the app is
 * running, so a hook that remounts — sign out, sign back in — would read it
 * again and navigate a seller to an order they finished with an hour ago. And
 * the launching tap can arrive from *both* sources: the stored one and the live
 * listener, back to back.
 *
 * A fresh process is a fresh cold start, which is exactly the scope this wants.
 * It grows by one per notification the seller taps in a session, which is a
 * handful.
 */
const routed = new Set<string>();

/**
 * Where a tapped notification should land, or null if it should be ignored.
 *
 * `booking` and `order` both go to the order screen: a booking *is* an order
 * with a `scheduledFor`, and there is one screen for both. The two kinds exist
 * in the payload because the wording of the notification differs, not because
 * the destination does.
 */
function orderIdFrom(response: Notifications.NotificationResponse | null): string | null {
  if (!response) return null;

  const id = response.notification.request.identifier;
  if (routed.has(id)) return null;

  const data = response.notification.request.content.data as
    | { kind?: unknown; orderId?: unknown }
    | undefined;
  const orderId = data?.orderId;
  /*
   * A push payload is a string that travelled through Apple's servers and back,
   * so it is checked rather than trusted. Anything other than a non-empty string
   * is a notification this version of the app does not know how to open, and the
   * right answer is to leave the seller where they are — a future notification
   * kind must not crash an older build.
   */
  if (typeof orderId !== "string" || orderId.length === 0) return null;

  routed.add(id);
  return orderId;
}

/**
 * Open the order a tapped notification is about.
 *
 * Two sources, because a tap can reach the app two ways and they are not
 * interchangeable:
 *
 *   - **Warm.** The app is running, the seller taps the banner or the entry in
 *     the notification centre, and `addNotificationResponseReceivedListener`
 *     fires. This is the only one most implementations handle.
 *   - **Cold.** The app was not running. The tap *launched* it, so there was no
 *     listener at the moment it happened and there never will have been —
 *     `getLastNotificationResponseAsync` is the only way to learn it occurred.
 *     Without it, the seller taps "New order · 240 AED" on a locked phone and
 *     lands on Home, which is the same place the icon would have taken them.
 *
 * Called from `(tabs)/_layout.tsx` rather than from the root, because that is
 * the first point at which there is both a signed-in seller and a router with
 * an `/orders/[id]` route in it. A tap that arrives while signed out is dropped
 * on purpose: routing it would push a shop-scoped screen at somebody the server
 * would refuse anyway.
 *
 * `navigate` rather than `push`, so a seller who taps two notifications about
 * the same order does not end up with two copies of it on the stack to back out
 * through.
 */
export function useNotificationRouting(): void {
  const router = useRouter();

  const open = useCallback(
    (response: Notifications.NotificationResponse | null) => {
      const orderId = orderIdFrom(response);
      if (!orderId) return;
      router.navigate({ pathname: "/orders/[id]", params: { id: orderId } });
    },
    [router],
  );

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        // The await gives the layout time to unmount underneath us.
        if (live) open(last);
      } catch (error) {
        captureError(error, { scope: "mobile:push:coldStart" });
      }
    })();

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      live = false;
      subscription.remove();
    };
  }, [open]);
}

/**
 * The settings toggle's state, and the two things it can do.
 *
 * `enabled` is deliberately derived from the OS and the seller's own answer
 * rather than from a server read. The question the screen is asking is "will
 * this phone buzz", and a row in Postgres cannot answer that — permission
 * revoked in the system Settings app makes a perfectly good token silent, and a
 * toggle reading its state from the server would sit there saying "on".
 */
export function usePushSettings(): {
  enabled: boolean;
  permission: PushPermission;
  busy: boolean;
  /** True when the seller must be sent to the system Settings app. */
  blocked: boolean;
  setEnabled: (next: boolean) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [permission, setPermission] = useState<PushPermission>("askable");
  const [optedOut, setOptedOutState] = useState(true);
  const [busy, setBusy] = useState(true);

  const refresh = useCallback(async () => {
    const [next, out] = await Promise.all([currentPermission(), readOptOut()]);
    setPermission(next);
    setOptedOutState(out);
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      setBusy(true);
      try {
        if (next) {
          setPermission(await registerDevice({ ask: true }));
          setOptedOutState(false);
        } else {
          await forgetDevice({ stayOff: true });
          setOptedOutState(true);
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return {
    enabled: permission === "granted" && !optedOut,
    permission,
    busy,
    blocked: permission === "blocked" || permission === "unsupported",
    setEnabled,
    refresh,
  };
}
