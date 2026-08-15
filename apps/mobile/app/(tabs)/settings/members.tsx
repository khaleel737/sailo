import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { captureError } from "@sailo/observability";
import { interpolate } from "@sailo/i18n/native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  Segmented,
  Skeleton,
  StatusPill,
  Text,
  haptics,
} from "@sailo/design-native";
import { formatMoney } from "../../../components/money";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * Who is subscribed, and stopping it.
 *
 * THE ONE THING THIS SCREEN MUST GET RIGHT
 *
 * Cancelling a card membership happens at Stripe, not here. Stripe holds a
 * card and will charge it again unless told not to, so telling it is the only
 * thing that actually stops the money — a row that said "cancelled" while
 * Stripe kept billing is the worst outcome this feature has, and it ends in a
 * chargeback. `members.cancel` asks Stripe first and writes nothing if Stripe
 * refuses; this screen surfaces that refusal rather than pretending.
 *
 * AND IT NEVER STOPS IT TODAY
 *
 * A cancellation takes effect at the end of the period the member has already
 * paid for. Not a kindness — ending it today would be taking money for access
 * then withdrawing it. The confirmation says which date, because "cancel" with
 * no date reads as "immediately" and a seller doing a member a favour needs to
 * know what they actually promised.
 */
export default function Members() {
  const { a, t, locale } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<"active" | "canceled" | "all">("active");
  const members = useQuery(trpc.members.list.queryOptions({ status }));

  const cancel = useMutation(
    trpc.members.cancel.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        await queryClient.invalidateQueries(trpc.members.pathFilter());
      },
      onError: (error) => {
        haptics.error();
        const reason = reasonOf(error);
        if (reason === "stripe_refused" || reason === "not_connected") {
          /* Stripe said no and nothing was written, which is the ordering
             working. The seller can try again; the member is still billed
             until they do, and saying so is the honest thing. */
          Alert.alert(a.members.title, a.members.cancelFailed);
          return;
        }
        captureError(error, { scope: "mobile:members:cancel" });
      },
    }),
  );

  const refresh = useCallback(() => void members.refetch(), [members.refetch]);

  const locked =
    members.error instanceof TRPCClientError &&
    (members.error.data as { code?: string } | null | undefined)?.code === "FORBIDDEN";

  if (locked) {
    return (
      <Screen scroll={false} center>
        <EmptyState icon="lock" title={a.members.title} message={a.members.lockedBody} />
      </Screen>
    );
  }

  if (members.error) {
    reportQueryError(members.error, { scope: "mobile:members" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(members.error, a.common.couldntLoad)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={members.isFetching}
        />
      </Screen>
    );
  }

  const rows = members.data ?? [];

  return (
    <Screen onRefresh={refresh} refreshing={members.isFetching} testID="members">
      <Segmented
        options={[
          { value: "active" as const, label: a.common.active },
          { value: "canceled" as const, label: a.members.cancelled },
          { value: "all" as const, label: t.shop.all },
        ]}
        value={status}
        onChange={setStatus}
        accessibilityLabel={a.common.status}
      />

      {members.isPending ? (
        <Skeleton shape="card" count={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon="person" title={a.members.empty} message={a.members.emptyBody} />
      ) : (
        rows.map((member) => (
          <Card key={member.id} padding="lg">
            <View style={styles.head}>
              <Text variant="heading" numberOfLines={1}>
                {/* A membership can outlive the person's client row — both
                    joins are `set null` on delete — so neither name is
                    assumed to be there. */}
                {member.memberName ?? member.memberEmail ?? a.clients.noDetails}
              </Text>
              <StatusPill
                tone={member.cancelAtPeriodEnd ? "warning" : tone(member.status)}
                label={member.cancelAtPeriodEnd ? a.members.cancelling : member.status}
              />
            </View>

            <Text variant="callout" tone="muted">
              {member.productTitle ?? a.members.productGone}
            </Text>

            <Text variant="numeric">
              {formatMoney(member.priceCents, member.currency, locale)}
              {member.interval ? ` / ${member.interval}` : ""}
            </Text>

            {member.currentPeriodEnd ? (
              <Text variant="caption" tone="muted">
                {interpolate(
                  member.cancelAtPeriodEnd ? a.billing.endsOn : a.billing.renewsOn,
                  { date: dayLabel(member.currentPeriodEnd, locale) },
                )}
              </Text>
            ) : null}

            {/*
              `billingMode` decides who is charging. A manual membership has no
              card behind it — the seller marks each period paid — so saying
              which is what tells them whether cancelling reaches Stripe or
              just stops the renewal reminder.
            */}
            <Text variant="caption" tone="muted">
              {member.billingMode === "manual" ? a.members.byHand : a.members.byCard}
            </Text>

            {member.cancelAtPeriodEnd || member.status !== "active" ? null : (
              <Button
                label={a.members.cancel}
                variant="danger"
                loading={cancel.isPending && cancel.variables?.id === member.id}
                onPress={() =>
                  Alert.alert(
                    a.members.cancel,
                    member.currentPeriodEnd
                      ? interpolate(a.members.cancelBody, {
                          date: dayLabel(member.currentPeriodEnd, locale),
                        })
                      : a.members.cancelBodyNoDate,
                    [
                      { text: a.common.cancel, style: "cancel" },
                      {
                        text: a.members.cancel,
                        style: "destructive",
                        onPress: () => cancel.mutate({ id: member.id }),
                      },
                    ],
                  )
                }
                fullWidth
              />
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

function tone(status: string) {
  return status === "active" ? ("success" as const) : ("neutral" as const);
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
