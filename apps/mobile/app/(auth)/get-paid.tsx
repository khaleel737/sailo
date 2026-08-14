import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { Button, Text } from "@sailo/design-native";
import { authClient, useAuthCopy, type AuthCopy } from "../../lib/auth";
import { useTRPC } from "../../lib/query";

/**
 * Where Stripe sends the seller back to, and the reason the sheet closes itself.
 *
 * These two strings are the app's half of a contract whose other half is in
 * `packages/api/src/routers/payments.ts`, which builds the account link with
 * exactly these URLs. `openAuthSessionAsync` watches for a redirect to this
 * scheme and dismisses its own sheet the moment it sees one — which is the
 * whole difference between finishing onboarding and being stranded in a browser
 * with a "please click close in the top left corner to get back to the app"
 * instruction, which is what Stan's app actually ships.
 *
 * Only the scheme has to match for the sheet to close, so the value handed to
 * `openAuthSessionAsync` is the `return` one and the `refresh` case is told
 * apart afterwards by reading the URL that came back. They mean different
 * things: `return` is the seller having finished or given up, `refresh` is
 * Stripe saying the link has gone stale and the flow needs a new one. Only the
 * app can tell them apart, and treating the second as the first leaves a seller
 * looking at a screen that still says "not connected" with nothing explaining
 * why.
 */
const CONNECT_RETURN_URL = "sailo://connect/return";
const CONNECT_REFRESH_PATH = "connect/refresh";

/**
 * How many stale links this screen will replace before it gives up and says so.
 *
 * One. A fresh account link that comes back stale immediately means something
 * is wrong at Stripe's end rather than that the seller was slow, and a loop
 * that keeps fetching would spend the seller's afternoon opening and closing a
 * browser sheet. The bound is stated in the failure rather than hidden in it.
 */
const MAX_REFRESH_ATTEMPTS = 1;

/**
 * Turning on card payments, without leaving the app.
 *
 * This is the step most likely to be abandoned, and almost never because the
 * seller changed their mind: Stripe onboarding happens on Stripe's own pages,
 * and an app that opens them in a browser it does not control has handed the
 * seller to a place with no way back. `WebBrowser.openAuthSessionAsync` is the
 * fix — it is the API that knows to close itself on a redirect to the app's own
 * scheme — and it is why `connectLink` returns `sailo://` URLs rather than
 * website ones.
 *
 * Skippable, and prominently so. Cash, a bank transfer and a WhatsApp handoff
 * are all real ways to be paid, and a seller in a market where nobody uses
 * cards is fully set up without ever touching this screen.
 */
export default function GetPaid() {
  const router = useRouter();
  const copy = useAuthCopy();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  const [status, setStatus] = useState<
    "idle" | "opening" | "reopening" | "cancelled" | "done"
  >("idle");
  const [failure, setFailure] = useState<"forbidden" | "failed" | null>(null);

  /*
   * A mutation rather than a query, because the first call creates the
   * seller's Stripe account and writes its id onto the shop. Account links are
   * single-use and expire in minutes, so one is fetched per tap and never
   * cached.
   */
  const link = useMutation(trpc.payments.connectLink.mutationOptions());

  /**
   * Whatever surface shows the setup checklist repaints itself on the way back.
   *
   * `pathFilter()` over the whole `shop` namespace rather than `shop.get`
   * specifically, and that is deliberate: the tick the seller is waiting for
   * belongs to `shop.setup`, which A02 has not shipped yet, and invalidating
   * the namespace means it starts refreshing the day it exists without this
   * file being reopened. Today it refreshes `shop.get`, which is the only thing
   * in there.
   */
  const refreshShop = useCallback(() => {
    void queryClient.invalidateQueries(trpc.shop.pathFilter());
  }, [queryClient, trpc]);

  const connect = useCallback(async () => {
    setFailure(null);

    for (let attempt = 0; attempt <= MAX_REFRESH_ATTEMPTS; attempt += 1) {
      setStatus(attempt === 0 ? "opening" : "reopening");

      let url: string;
      try {
        ({ url } = await link.mutateAsync());
      } catch (error) {
        setStatus("idle");
        /*
         * A 403 is the plan gate in `connectLink` — card payments are a
         * Business feature — and it does not get better on a second tap, so it
         * is shown without a retry. Everything else might be the network.
         */
        const httpStatus =
          error instanceof TRPCClientError
            ? (error.data as { httpStatus?: number } | null | undefined)?.httpStatus
            : undefined;
        setFailure(httpStatus === 403 ? "forbidden" : "failed");
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(url, CONNECT_RETURN_URL);

      /*
       * Whatever happened in there, the shop may have changed — a seller can
       * complete onboarding and then dismiss the sheet by hand, which arrives
       * here as a cancel. Refetching on every outcome is cheap; deciding from
       * the browser's result whether Stripe wrote anything is a guess.
       */
      refreshShop();

      if (result.type !== "success") {
        /*
         * `cancel` on iOS, `dismiss` when the sheet is swiped away. Neither is
         * a failure and neither is drawn as one — the seller closed a browser,
         * which they are allowed to do.
         */
        setStatus("cancelled");
        return;
      }

      if (!result.url.includes(CONNECT_REFRESH_PATH)) {
        setStatus("done");
        return;
      }
      // Stale link. Round again for a fresh one, up to the bound above.
    }

    setStatus("idle");
    setFailure("failed");
  }, [link, refreshShop]);

  /*
   * This screen needs a shop, which needs a session. Without the guard, a
   * signed-out seller who deep-links here taps a button that answers
   * UNAUTHORIZED and reads as the feature being broken.
   */
  if (!session?.user) return <Redirect href="/welcome" />;

  const busy = status === "opening" || status === "reopening";

  return (
    <ScrollView style={styles.fill} contentInsetAdjustmentBehavior="automatic">
      <Text variant="body">{copy.getPaid.body}</Text>

      <Button
        label={
          status === "reopening"
            ? copy.getPaid.reopening
            : busy
              ? copy.getPaid.connecting
              : copy.getPaid.connect
        }
        variant="primary"
        fullWidth
        loading={busy}
        onPress={() => void connect()}
        testID="get-paid-connect"
      />

      <Outcome status={status} failure={failure} copy={copy} />

      <Button
        label={copy.getPaid.skip}
        variant="ghost"
        fullWidth
        onPress={() => router.replace("/")}
        testID="get-paid-skip"
      />
    </ScrollView>
  );
}

/**
 * What the sheet came back with.
 *
 * A cancel gets the muted tone and a sentence that does not imply a mistake:
 * closing Stripe's pages is a normal thing to do, and this step is optional by
 * design. Only a refusal is drawn as one.
 */
function Outcome({
  status,
  failure,
  copy,
}: {
  status: string;
  failure: "forbidden" | "failed" | null;
  copy: AuthCopy;
}) {
  if (failure === "forbidden") {
    return (
      <Text variant="callout" tone="warning" testID="get-paid-forbidden">
        {copy.getPaid.forbidden}
      </Text>
    );
  }
  if (failure === "failed") {
    return (
      <Text variant="callout" tone="danger" testID="get-paid-failed">
        {copy.getPaid.failed}
      </Text>
    );
  }
  if (status === "done") {
    return (
      <Text variant="callout" tone="success" testID="get-paid-done">
        {copy.getPaid.done}
      </Text>
    );
  }
  if (status === "cancelled") {
    return (
      <Text variant="callout" tone="muted" testID="get-paid-cancelled">
        {copy.getPaid.cancelled}
      </Text>
    );
  }
  return <View />;
}

/** See the note at the foot of `_layout.tsx`. Fill only; no look. */
const styles = StyleSheet.create({ fill: { flex: 1 } });
