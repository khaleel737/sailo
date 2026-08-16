import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { interpolate } from "@sailo/i18n/native";
import {
  Avatar,
  Button,
  Card,
  GroupedList,
  ListRow,
  Screen,
  Skeleton,
  Text,
} from "@sailo/design-system/native";
import { authClient } from "../../../lib/auth";
import { forgetDevice, usePushSettings } from "../../../lib/push";
import { useT } from "../../../lib/i18n";
import { useTRPC } from "../../../lib/query";

/**
 * Who the seller is signed in as, whether their phone will buzz, and the way
 * out.
 *
 * There is no save button, and that is the design rather than an omission: a
 * settings screen that batches changes behind one is a screen that can be left
 * in a state the seller believes they set and did not. Each control commits on
 * the spot and reports what it actually achieved — notably the notification
 * toggle, which can fail to turn on for a reason that has nothing to do with
 * this app.
 *
 * Grouped lists rather than accordions. Stan's settings screen hides both of
 * its sections behind disclosure triangles, which costs a tap per task and
 * means the screen never shows what it contains; on iOS a grouped list is the
 * convention precisely because it is scannable at rest.
 */
export default function Settings() {
  const { a } = useT();
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: session, isPending } = authClient.useSession();
  const shop = useQuery(trpc.shop.get.queryOptions());
  const push = usePushSettings();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    /*
     * Order matters and it is not cosmetic. Unregistering needs the session
     * that `signOut` is about to destroy, and a token left behind on the server
     * keeps this shop's orders arriving on the lock screen of a phone that has
     * been deliberately signed out of.
     *
     * Not remembered as an opt-out: signing out is not "stop notifying me", and
     * treating it as one would leave the next seller to sign in on this handset
     * silently un-notified with a toggle that says otherwise.
     */
    await forgetDevice();
    await authClient.signOut();
    /*
     * The cache still holds the previous seller's shop, and on a shared handset
     * it would paint their orders from cache before the first request even goes
     * out — which looks exactly like a cross-tenant leak, and is one on the
     * client side of the boundary the router defends on the server side.
     */
    queryClient.clear();
    setSigningOut(false);
  }, [queryClient]);

  const deleteAccount = useCallback(() => {
    /*
     * The native alert, not a custom sheet: this is the most destructive thing
     * in the app and the system dialog is the one users have learned to read
     * rather than dismiss.
     *
     * Deletion itself lives on the web, and the button opens it rather than
     * doing it. That is deliberate — `account.delete` refuses while a shop has
     * outstanding obligations, and the refusal needs to explain which ones and
     * offer the way through. Reproducing that whole flow on a phone to serve an
     * action taken once per account would be a screen nobody sees and nobody
     * maintains. What matters for App Store 5.1.1(v) is that the path starts
     * inside the app and is easy to find, which it does and is.
     */
    Alert.alert(a.security.deleteTitle, a.security.deleteBody, [
      { text: a.common.cancel, style: "cancel" },
      {
        text: a.common.view,
        style: "destructive",
        onPress: () => {
          void openAccountSettings().catch((error: unknown) => {
            captureError(error, { scope: "mobile:settings:delete" });
          });
        },
      },
    ]);
  }, [a]);

  const refresh = useCallback(() => {
    void shop.refetch();
    void push.refresh();
  }, [shop.refetch, push.refresh]);

  return (
    /*
     * `Screen` owns the inset, and the edge it does *not* claim is the top one:
     * the stack header above this screen already consumes it, and taking it
     * again is the second gap under a large title that nobody can find the
     * source of. It also sets `contentInsetAdjustmentBehavior="automatic"`, so
     * the large title collapses correctly as this scrolls.
     */
    <Screen onRefresh={refresh} refreshing={shop.isFetching} testID="settings">
      {/*
        Who is signed in, as a face rather than as two rows of a table.

        The name and the address are also in the list below, and that is not a
        duplication to remove: the list is where a seller *checks* a value, and
        this is where they confirm at a glance that they are in the right
        account — which on a shared handset is the first question the screen has
        to answer. `Avatar` derives its initials from the same name.
      */}
      <Card padding="lg">
        <View style={styles.identity}>
          <Avatar name={session?.user?.name || session?.user?.email || "?"} size="lg" />
          <View style={styles.identityText}>
            <Text variant="heading" numberOfLines={1}>
              {session?.user?.name || a.common.name}
            </Text>
            <Text variant="callout" tone="muted" numberOfLines={1}>
              {session?.user?.email ?? "—"}
            </Text>
          </View>
        </View>
      </Card>

      <GroupedList header={a.settings.identity}>
        <ListRow title={a.common.name} value={session?.user?.name || "—"} />
        <ListRow title={a.common.email} value={session?.user?.email ?? "—"} />
        {/*
          The shop is its own read and can still be in flight, or can fail on
          its own. It says which rather than rendering an em dash, which would
          claim the seller has no shop name.

          It is also the way in to editing it now, which is why it has a
          chevron: the row was already answering "what is my shop called", and
          the next question a seller has after reading it is how to change it.
        */}
        <ListRow
          title={a.settings.shopName}
          value={shop.isError ? a.common.couldntLoad : (shop.data?.name ?? undefined)}
          accessory={shop.isPending ? <Skeleton shape="text" /> : undefined}
          trailing="chevron"
          onPress={() => router.push("/settings/shop")}
        />
      </GroupedList>

      {/*
        The two screens about the people on the other side of the shop. Under
        Settings rather than under Store because neither is part of building a
        shop — one is a list of who has bought, and the other is a queue of
        things waiting for a decision.
      */}
      <GroupedList header={a.clients.title}>
        <ListRow
          title={a.clients.title}
          subtitleLines={2}
          subtitle={a.clients.emptyBody}
          icon="person"
          trailing="chevron"
          onPress={() => router.push("/settings/customers")}
          testID="settings-customers"
        />
        <ListRow
          title={a.members.title}
          subtitleLines={2}
          subtitle={a.members.description}
          icon="ticket"
          trailing="chevron"
          onPress={() => router.push("/settings/members")}
          testID="settings-members"
        />
        <ListRow
          title={a.reviews.title}
          subtitleLines={2}
          subtitle={a.reviews.emptyBody}
          icon="star"
          trailing="chevron"
          onPress={() => router.push("/settings/reviews")}
          testID="settings-reviews"
        />
      </GroupedList>

      {/*
        One row where there were two switches.

        This block used to hold the device toggle directly, labelled with the
        one event it happened to control. That was honest when `orderPlaced`
        was the only notification Sailo sent and became a lie the moment
        `notificationPrefs` grew two more keys — a seller reading "Order
        placed" here had no way to know a booking request was governed
        somewhere they could not reach.

        The footer still carries the device's own state, because whether this
        handset can buzz at all is the thing worth knowing before tapping in.
      */}
      <GroupedList header={a.settings.notifications} footer={explain(push, a)}>
        <ListRow
          title={a.settings.tabNotifications}
          icon="bell"
          trailing="chevron"
          onPress={() => router.push("/settings/notifications")}
          testID="settings-notifications"
        />
      </GroupedList>

      {/*
        The door, reachable. It is a whole feature that is otherwise only a URL:
        the scanner is presented from here rather than living in a tab, because
        a volunteer works one event for one evening and a tab bar under a camera
        is four ways to lose it mid-shift.
      */}
      <GroupedList header={a.checkin.title}>
        <ListRow
          title={a.checkin.title}
          subtitleLines={2}
          subtitle={a.checkin.description}
          icon="scan"
          trailing="chevron"
          onPress={() => router.push("/checkin")}
        />
      </GroupedList>

      <GroupedList header={a.settings.tabBilling}>
        <ListRow
          title={a.settings.tabBilling}
          subtitleLines={2}
          subtitle={a.billing.cancelAnyTime}
          icon="card"
          trailing="chevron"
          onPress={() => router.push("/settings/billing")}
          testID="settings-billing"
        />
      </GroupedList>

      <GroupedList header={a.settings.tabSecurity}>
        <ListRow
          title={a.security.deleteTitle}
          icon="delete"
          destructive
          onPress={deleteAccount}
        />
      </GroupedList>

      <View style={styles.out}>
        <Button
          label={a.shell.signOut}
          icon="signOut"
          onPress={() => void signOut()}
          loading={signingOut}
          disabled={isPending}
          variant="secondary"
          fullWidth
        />
        {/* The build, so a bug report can name it. Selectable because the
            person reading it out is usually on a call. */}
        <Text variant="caption" tone="muted" align="center" selectable>
          {interpolate(a.shell.version, { version: version() })}
        </Text>
      </View>
    </Screen>
  );
}

/**
 * The line under the toggle. It carries the whole difference between "off" and
 * "off, and tapping this will not help" — the case where the seller said no
 * once and the OS will not let the app ask again.
 */
function explain(
  push: ReturnType<typeof usePushSettings>,
  a: ReturnType<typeof useT>["a"],
): string {
  if (push.busy) return a.common.pending;
  switch (push.permission) {
    case "blocked":
      return a.checkin.scanBlockedBody;
    default:
      return a.settings.notificationsBody;
  }
}

async function openAccountSettings(): Promise<void> {
  const { openBrowserAsync } = await import("expo-web-browser");
  const base = process.env.EXPO_PUBLIC_AUTH_URL ?? "https://sailo.store";
  await openBrowserAsync(`${base}/admin/settings/security`);
}

/**
 * The build, read from the manifest rather than from an env var.
 *
 * `expo-constants` reports what the running bundle actually is, which is the
 * thing a bug report has to name — an env var baked at a different time can
 * disagree with it after an over-the-air update.
 */
function version(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  identityText: { flex: 1, gap: 2 },
  out: { gap: 8, marginTop: 8 },
});
