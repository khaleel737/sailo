/**
 * The toggle on the settings screen, and everything it has to reconcile.
 *
 * The one place where the seller's stored answer, the OS permission and the server's record of
 * this device all have to agree — and where a disagreement is the seller's to resolve rather
 * than ours to guess at.
 */

import { useCallback, useEffect, useState } from "react";
import {
  type PushPermission,
  TOKEN_KEY,
  currentPermission,
  pushSupported,
  readOptOut,
  recall,
} from "./permission";
import { forgetDevice, registerDevice } from "./device";

export function usePushSettings(): {
  enabled: boolean;
  permission: PushPermission;
  busy: boolean;
  /** True when the seller must be sent to the system Settings app. */
  blocked: boolean;
  /**
   * True when this build cannot receive a push at all — a simulator, or a
   * device with no push service. The switch has to be *inert* here rather than
   * live: it was live, so a tap moved it, the registration returned
   * `unsupported`, and it snapped back with nothing said. A control that
   * refuses silently reads as a broken app.
   */
  unsupported: boolean;
  /**
   * True when the OS allowed it and the registration still did not land.
   *
   * Distinct from every other state, and the one that used to be invisible:
   * permission `granted`, token null or the write refused, switch **on**, no
   * device registered. The seller has to be told, because nothing else on the
   * phone will tell them.
   */
  failed: boolean;
  setEnabled: (next: boolean) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [permission, setPermission] = useState<PushPermission>("askable");
  const [optedOut, setOptedOutState] = useState(true);
  const [busy, setBusy] = useState(true);
  /*
   * Whether the last attempt actually put a token on the server.
   *
   * Seeded from the token this device remembers rather than from the
   * permission: a launch that has not re-registered yet has a stored token and
   * a `granted` permission, and that pair *is* a registered device. Asking the
   * permission alone would show the switch off until the first refresh.
   */
  const [registered, setRegistered] = useState(false);
  /* Hardware, not permission — see `pushSupported`. Read once: it cannot change
     for the life of the process. */
  const [supported] = useState(pushSupported);

  const refresh = useCallback(async () => {
    const [next, out, token] = await Promise.all([
      currentPermission(),
      readOptOut(),
      recall(TOKEN_KEY),
    ]);
    setPermission(next);
    setOptedOutState(out);
    setRegistered(supported && next === "granted" && Boolean(token));
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
          const result = await registerDevice({ ask: true });
          setPermission(result.permission);
          setRegistered(result.registered);
          /*
           * Only clear the opt-out if it actually worked. Recording "they want
           * this" after a failed attempt is how the next launch silently
           * re-asks for something that cannot succeed.
           */
          if (result.registered) setOptedOutState(false);
        } else {
          await forgetDevice({ stayOff: true });
          setRegistered(false);
          setOptedOutState(true);
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return {
    /* Registered, not merely permitted — see `PushRegistration.registered`. */
    enabled: registered && !optedOut,
    permission,
    busy,
    unsupported: !supported,
    failed: supported && permission === "granted" && !registered && !optedOut,
    /* Only a genuine refusal sends the seller to the system Settings app. A
       simulator is `unsupported`, which is a different sentence and a different
       control state. */
    blocked: permission === "blocked",
    setEnabled,
    refresh,
  };
}
