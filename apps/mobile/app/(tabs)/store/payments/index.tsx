import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { interpolate } from "@sailo/i18n/native";
import {
  Banner,
  Button,
  Card,
  ErrorState,
  GroupedList,
  ListRow,
  Screen,
  Skeleton,
  StatusPill,
  Text,
} from "@sailo/design-native";
import type { IconName, StatusTone } from "@sailo/design-native";
import type { Rail } from "../../../../lib/models";
import { useT } from "../../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../../lib/query";
import { errorMessage } from "../../../../components/states";

/**
 * Every way this shop can be paid, and whether each one actually works.
 *
 * WHY THIS SCREEN IS THE ONE THAT MATTERS MOST
 *
 * A shop with no usable rail cannot take an order at all — the buttons on the
 * storefront are disabled — and until now the only way to fix that was to find
 * a laptop. A seller whose Venmo handle changed, or who wants to add a bank
 * transfer while standing at a market stall, had a broken shop and no way to
 * unbreak it.
 *
 * THREE STATES, NOT ONE
 *
 * `payments.rails` sends `configured`, `available` and `usable` separately and
 * the rows below keep them apart, because a seller needs to act differently on
 * each: "you have not filled this in" is work they can do, "this cannot settle
 * your currency" is not, and "Stripe is still checking you" is waiting. A
 * single "off" flag would send all three to the same dead end.
 *
 * A NOTE ON THE WORDS
 *
 * The rail names, their descriptions and their field labels come from
 * `PAYMENT_METHOD_DEFS` and are **English in every locale** — everything around
 * them (`a.payments.*`) is translated. That is not a shortcut taken here: the
 * web admin renders the same strings from the same place, so this matches it
 * rather than regressing it. Fixing it properly means moving roughly sixty
 * strings into the dictionaries and is a work order of its own; until then, a
 * German seller reads "WhatsApp number" under a translated heading, which is
 * what they already read on the website.
 */

/** The order the sections appear in — settling rails first, chat last. */
const SECTIONS = [
  { key: "online", title: "payOnline", body: "payOnlineBody", icon: "card" },
  { key: "wallet", title: "wallets", body: "walletsBody", icon: "link" },
  { key: "manual", title: "manual", body: "manualBody", icon: "bank" },
  { key: "chat", title: "chatHandoff", body: "chatHandoffBody", icon: "mail" },
] as const satisfies readonly {
  key: string;
  title: keyof AdminPayments;
  body: keyof AdminPayments;
  icon: IconName;
}[];

type Admin = ReturnType<typeof useT>["a"];
type AdminPayments = Admin["payments"];

export default function Payments() {
  const { a, t } = useT();
  const trpc = useTRPC();
  const router = useRouter();

  const rails = useQuery(trpc.payments.rails.queryOptions());

  /*
   * A mutation rather than a query, because each call mints a single-use
   * account link that expires in minutes — the router's own note says why. So
   * the seller taps, and only then do we ask Stripe for a URL.
   */
  const connect = useMutation(
    trpc.payments.connectLink.mutationOptions({
      onSuccess: async ({ url }) => {
        /*
         * `openAuthSessionAsync`, not `openBrowserAsync`. It watches for a
         * redirect to `sailo://` and dismisses its own sheet when it sees one —
         * which is the entire reason `payments.ts` points Stripe at our scheme
         * rather than at the website. Opened any other way, the seller finishes
         * onboarding inside a browser with no way back.
         */
        await WebBrowser.openAuthSessionAsync(url, "sailo://connect/return");
        /* Stripe decides separately whether the account may take charges, so
           coming back proves nothing on its own. Re-read rather than assume. */
        await rails.refetch();
      },
      onError: (error) => captureError(error, { scope: "mobile:payments:connect" }),
    }),
  );

  const refresh = useCallback(() => void rails.refetch(), [rails.refetch]);

  const data = rails.data;

  /*
   * How many ways a buyer could actually pay right now. Counted from `usable`
   * rather than from `isEnabled`, because a rail switched on and unconfigured
   * is not a way to order — it is a button that goes nowhere, and counting it
   * would tell a seller their shop works when it does not.
   */
  const liveCount = useMemo(
    () => (data?.rails ?? []).filter((rail) => rail.usable).length,
    [data?.rails],
  );

  if (rails.error) {
    reportQueryError(rails.error, { scope: "mobile:payments" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(rails.error, a.payments.stripeErrorTitle)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={rails.isFetching}
        />
      </Screen>
    );
  }

  if (rails.isPending || !data) {
    return (
      <Screen testID="payments-loading">
        <Skeleton shape="card" count={4} />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={refresh} refreshing={rails.isFetching} testID="payments">
      {/*
        The headline state, said before anything else on the screen.

        A shop nobody can order from is not a settings detail — it is the one
        fact that makes every other row on this screen urgent, and a seller who
        has to count enabled toggles to work it out will not.
      */}
      {liveCount === 0 ? (
        <Banner
          tone="warning"
          title={a.payments.nobodyCanOrder}
          message={a.payments.nobodyCanOrderBody}
          testID="nobody-can-order"
        />
      ) : (
        <Banner
          tone="success"
          message={
            liveCount === 1
              ? a.payments.waysToOrderOne
              : interpolate(a.payments.waysToOrder, { count: String(liveCount) })
          }
        />
      )}

      <CardRail data={data} onConnect={() => connect.mutate()} connecting={connect.isPending} />

      {SECTIONS.map((section) => {
        const inSection = data.rails.filter(
          (rail) => rail.category === section.key && rail.type !== "card",
        );
        /* A section with nothing in it is not an empty state, it is a heading
           over nothing — the wallet section is empty in most currencies. */
        if (inSection.length === 0) return null;

        return (
          <GroupedList
            key={section.key}
            header={a.payments[section.title]}
            footer={a.payments[section.body]}
          >
            {inSection.map((rail) => (
              <ListRow
                key={rail.type}
                title={rail.name}
                subtitle={rail.name === rail.label ? undefined : (rail.label ?? undefined)}
                icon={section.icon}
                trailing="chevron"
                accessory={<RailState rail={rail} a={a} />}
                onPress={() => router.push(`/store/payments/${rail.type}`)}
                /* The pill is a word a screen reader would otherwise read after
                   the name with nothing joining them. */
                accessibilityLabel={`${rail.name}. ${stateWord(rail, a)}`}
              />
            ))}
          </GroupedList>
        );
      })}
    </Screen>
  );
}

/**
 * Card, which is not like the others.
 *
 * It has no fields to fill in — what configures it is a connected Stripe
 * account that Stripe itself has cleared for charges — so it gets a card of its
 * own rather than a row in a list that would offer to edit nothing.
 */
function CardRail({
  data,
  onConnect,
  connecting,
}: {
  data: {
    cardAllowed: boolean;
    stripe: { connected: boolean; chargesEnabled: boolean; detailsSubmitted: boolean };
  };
  onConnect: () => void;
  connecting: boolean;
}) {
  const { a } = useT();
  const { stripe } = data;

  return (
    <Card padding="lg">
      <Text variant="heading" heading>
        {a.payments.cardTitle}
      </Text>

      {!data.cardAllowed ? (
        /* The lock, before the tap rather than after it. `connectLink` refuses
           an un-entitled shop, and a seller who found that out by finishing
           Stripe's onboarding first would have an account and no card button. */
        <Text variant="callout" tone="muted">
          {interpolate(a.payments.cardOnPlan, { plan: "Business" })}
        </Text>
      ) : stripe.chargesEnabled ? (
        <StatusPill tone="success" label={a.common.live} />
      ) : stripe.connected ? (
        <>
          <StatusPill tone="warning" label={a.payments.stripeVerifying} />
          <Text variant="callout" tone="muted">
            {stripe.detailsSubmitted
              ? a.payments.stripeChecking
              : a.payments.stripeNeedsDetails}
          </Text>
          <Button
            label={a.payments.finishSetup}
            onPress={onConnect}
            loading={connecting}
            variant="secondary"
            fullWidth
          />
        </>
      ) : (
        <>
          <Text variant="callout" tone="muted">
            {a.payments.connectHint}
          </Text>
          <Button
            label={a.payments.connectStripe}
            icon="card"
            onPress={onConnect}
            loading={connecting}
            fullWidth
          />
        </>
      )}
    </Card>
  );
}

/** The one-word verdict on a rail, as a pill. */
function RailState({ rail, a }: { rail: Rail; a: Admin }) {
  return <StatusPill tone={stateTone(rail)} label={stateWord(rail, a)} />;
}

function stateTone(rail: Rail): StatusTone {
  if (rail.usable) return "success";
  if (!rail.available) return "neutral";
  return rail.isEnabled ? "warning" : "neutral";
}

/**
 * Which of the three states this rail is in, in words.
 *
 * Ordered so the most actionable answer wins. A rail the currency rules out is
 * reported as unavailable even when it is also unconfigured, because filling
 * the form in would not help — and "not set up" on a rail that can never work
 * here is an instruction to do something pointless.
 */
function stateWord(rail: Rail, a: Admin): string {
  if (rail.usable) return a.common.live;
  if (!rail.available) return a.payments.unavailableHere;
  return a.payments.notSetUp;
}
