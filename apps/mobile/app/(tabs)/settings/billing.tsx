import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { captureError } from "@sailo/observability";
import { interpolate } from "@sailo/i18n/native";
import {
  Banner,
  Button,
  Card,
  ErrorState,
  GroupedList,
  ListRow,
  Progress,
  Screen,
  Skeleton,
  StatusPill,
  Text,
} from "@sailo/design-system/native";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * The plan, what it allows, and how much of it is used.
 *
 * WHY THE ENTITLEMENTS COME FROM THE SERVER
 *
 * The tempting shortcut is to read `shop.plan` off the row the app already
 * holds. That column is wrong in two directions that matter: a comped account
 * carries `free` there and its real entitlements in `compPlan`, and a shop
 * whose card was declined keeps `pro` while `subscriptionStatus` has gone
 * `past_due`. `billing.plan` runs the same `planFor` every server-side gate
 * runs, so a lock drawn from it cannot disagree with the API that will refuse.
 *
 * WHY THERE IS NO UPGRADE BUTTON
 *
 * Apple takes a cut of anything a seller can buy inside an iOS app, and a
 * subscription to Sailo bought through the App Store would be a subscription
 * Sailo keeps seventy per cent of. Managing an existing plan through Stripe's
 * own hosted page is not a purchase and is fine; starting one stays on the web.
 * The screen says so rather than showing a button that opens a browser and
 * hopes nobody at Apple reads it.
 */
export default function Billing() {
  const { a, t, locale } = useT();
  const trpc = useTRPC();

  const plan = useQuery(trpc.billing.plan.queryOptions());

  const portal = useMutation(
    trpc.billing.portalLink.mutationOptions({
      onSuccess: async ({ url }) => {
        await WebBrowser.openBrowserAsync(url);
        await plan.refetch();
      },
      onError: (error) => {
        /*
         * `no_subscription` is not a failure — it is a seller on the free plan
         * tapping a button that has nothing to manage. The screen already knows
         * that from `subscription.status`, so this is belt and braces rather
         * than the primary path, and it is deliberately not reported.
         */
        if (reasonOf(error) === "no_subscription") return;
        captureError(error, { scope: "mobile:billing:portal" });
      },
    }),
  );

  const refresh = useCallback(() => void plan.refetch(), [plan.refetch]);

  if (plan.error) {
    reportQueryError(plan.error, { scope: "mobile:billing" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(plan.error, a.common.couldntLoad)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={plan.isFetching}
        />
      </Screen>
    );
  }

  if (plan.isPending) {
    return (
      <Screen>
        <Skeleton shape="card" count={3} />
      </Screen>
    );
  }

  const { id, name, limits, usage, subscription } = plan.data;

  return (
    <Screen onRefresh={refresh} refreshing={plan.isFetching} testID="billing">
      <Card padding="lg">
        <View style={styles.head}>
          <Text variant="title">{name}</Text>
          {subscription.comped ? (
            /* A gift rather than a purchase. Said out loud, because a comped
               seller who opened the portal would find nothing to manage and
               conclude their billing was broken. */
            <StatusPill tone="info" label={a.billing.comped} />
          ) : subscription.status ? (
            <StatusPill
              tone={subscription.status === "active" ? "success" : "warning"}
              label={subscription.status}
            />
          ) : null}
        </View>

        {subscription.currentPeriodEnd ? (
          <Text variant="callout" tone="muted">
            {interpolate(
              subscription.cancelAtPeriodEnd ? a.billing.endsOn : a.billing.renewsOn,
              { date: dayLabel(subscription.currentPeriodEnd, locale) },
            )}
          </Text>
        ) : null}
      </Card>

      {/*
        The limit with the count beside it. A limit on its own is not
        actionable — "10 products" tells a seller nothing about whether their
        next upload will be refused.
      */}
      <Card padding="lg">
        <Text variant="label" heading>
          {a.columns.products}
        </Text>
        {limits.products === null ? (
          <Text variant="callout" tone="muted">
            {a.common.unlimited}
          </Text>
        ) : (
          <>
            <Text variant="numeric">
              {usage.products} / {limits.products}
            </Text>
            <Progress
              value={usage.products / limits.products}
              accessibilityLabel={a.columns.products}
            />
            {usage.atProductLimit ? (
              <Banner tone="warning" message={a.billing.atProductLimit} />
            ) : null}
          </>
        )}
      </Card>

      <GroupedList header={a.settings.tabBilling} footer={a.billing.cancelAnyTime}>
        <ListRow
          title={a.dashboard.rangeLabel}
          value={interpolate(a.billing.analyticsDays, { days: String(limits.analyticsDays) })}
        />
      </GroupedList>

      {subscription.status && !subscription.comped ? (
        <Button
          label={a.billing.managePlan}
          icon="external"
          onPress={() => portal.mutate()}
          loading={portal.isPending}
          variant="secondary"
          fullWidth
        />
      ) : (
        /*
         * No upgrade button on purpose. See the header — buying a plan inside
         * an iOS app is a purchase Apple takes a share of, so the seller is
         * told where to do it rather than shown a control that cannot exist.
         */
        <Banner tone="info" message={interpolate(a.billing.upgradeOnWeb, { plan: id })} />
      )}
    </Screen>
  );
}

function reasonOf(error: unknown): string | null {
  if (!(error instanceof TRPCClientError)) return null;
  const message = String(error.message ?? "");
  return /^[a-z_]+$/.test(message) ? message : null;
}

function dayLabel(iso: string | Date, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return String(iso).slice(0, 10);
  }
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
});
