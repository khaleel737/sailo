/**
 * Where a tapped notification takes the seller.
 *
 * A notification tapped from a cold start and one tapped while the app is open arrive by
 * different paths, and both have to land on the same screen — which is why the order id is read
 * from the response rather than from whatever the app happened to be showing.
 */

import { useCallback, useEffect } from "react";
import { useRouter } from "expo-router";
import { captureError } from "@sailo/observability";
import * as Notifications from "expo-notifications";

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
export function orderIdFrom(response: Notifications.NotificationResponse | null): string | null {
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
