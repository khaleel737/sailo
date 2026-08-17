/**
 * Registering this device with the server, and forgetting it.
 *
 * The token is what a push is addressed to, so this is the part that has to be idempotent: a
 * relaunch, a permission change and a sign-in all arrive here, and each must leave exactly one
 * live registration for this device.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import { captureError } from "@sailo/observability";
import { api } from "../api";
import { authClient } from "../auth";
import {
  type PushPermission,
  TOKEN_KEY,
  currentPermission,
  deviceToken,
  ensureAndroidChannel,
  pushSupported,
  readOptOut,
  recall,
  remember,
  requestPermission,
  writeOptOut,
} from "./permission";

export type PushRegistration = {
  /** What the OS says about showing notifications. */
  permission: PushPermission;
  /** False on a simulator — no APNs token exists to register. */
  supported: boolean;
  /**
   * Whether the token actually reached the server.
   *
   * **This field was missing, and its absence was a lie told to the seller.**
   * This function used to return the *permission* alone, and `usePushSettings`
   * drove its switch off that — so "allow the prompt, then fail to mint a token
   * or fail to reach the server" ended with `granted`, a switch that turned
   * **on**, and a device registered nowhere. The seller believed they would be
   * told about their next order, and they would not have been. Silently.
   *
   * Permission is what the OS allows. Registration is what happened. A switch
   * that reports the first while meaning the second can only ever be wrong in
   * the direction that costs somebody a sale.
   */
  registered: boolean;
};

export async function registerDevice(opts?: {
  ask?: boolean;
}): Promise<PushRegistration> {
  const supported = pushSupported();
  const permission = opts?.ask
    ? await requestPermission()
    : await currentPermission();

  /* Asked for anyway, even on a simulator: granting it is what lets a notification
     be *displayed* there, which is the only way the banner, the tap-through and
     the routing get exercised outside a physical device. */
  if (!supported) return { permission, supported, registered: false };
  if (permission !== "granted") return { permission, supported, registered: false };

  await ensureAndroidChannel();

  const token = await deviceToken();
  if (!token) return { permission, supported, registered: false };

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
    // re-registers, and the upsert on the server makes that free — but this
    // attempt did *not* register, and the caller has to be told so.
    captureError(error, { scope: "mobile:push:register" });
    return { permission, supported, registered: false };
  }
  return { permission, supported, registered: true };
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
   * session refresh, and a second registration mid-flight races the first.
   */
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || done.current === userId) return;
    done.current = userId;
    void (async () => {
      if (await readOptOut()) return;
      /*
       * `ask: false`. THIS USED TO PROMPT, AND THAT WAS THE BUG.
       *
       * The first launch after signing in fired the system permission dialog
       * with nothing on screen explaining it — a seller who had just finished
       * creating an account got an iOS alert asking to send them notifications,
       * about a shop with no orders in it, before they had seen the app.
       *
       * **iOS gives exactly one chance.** `requestPermissionsAsync` shows the
       * system alert once per install; after a "Don't Allow" it resolves
       * immediately with `canAskAgain: false` for ever, and the only route back
       * is the system Settings app. So the cost of asking at the wrong moment
       * is not a lower opt-in rate — it is a seller who can never be told an
       * order arrived, permanently, from one tap on their first minute.
       *
       * Registering without asking still does the useful half: a seller who has
       * already allowed notifications — a reinstall, a second device, anyone who
       * granted it from Settings — gets their token registered silently on every
       * launch, which is what keeps the row fresh.
       *
       * The *asking* moved to where there is room to say why: `usePushPrimer`
       * below, which Home offers as a banner the seller can decline without
       * spending the one prompt.
       */
      await registerDevice({ ask: false });
    })();
  }, [userId]);
}

/**
 * Whether to offer notifications, and the way to accept.
 *
 * The other half of the change above. iOS's one-shot prompt has to be spent on
 * a seller who has already said they want this, so something in the app has to
 * ask first — in the app's own words, with a decline that costs nothing.
 *
 * `askable` is the only state that offers: `granted` needs nothing, `blocked`
 * cannot be fixed from here (the banner would be a button that does nothing),
 * and `unsupported` is a simulator or a device with no push service.
 *
 * A decline is remembered as the same opt-out a sign-out writes, so the offer
 * does not reappear on the next launch. It is not permanent — the Settings
 * toggle clears it, which is the deliberate reach that should always work.
 */
export function usePushPrimer(): {
  /** True when there is a prompt worth making. */
  offer: boolean;
  /** Spend the one system prompt. */
  accept: () => Promise<void>;
  /** Not now — remembered, and undone by the Settings toggle. */
  decline: () => Promise<void>;
} {
  const [offer, setOffer] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [permission, out] = await Promise.all([currentPermission(), readOptOut()]);
      if (alive) setOffer(permission === "askable" && !out);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const accept = useCallback(async () => {
    setOffer(false);
    await registerDevice({ ask: true });
  }, []);

  const decline = useCallback(async () => {
    setOffer(false);
    await writeOptOut(true);
  }, []);

  return { offer, accept, decline };
}
