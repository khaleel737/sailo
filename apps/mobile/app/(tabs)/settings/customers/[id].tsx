import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { orderStatusLabel } from "@sailo/core/order-status";
import { interpolate } from "@sailo/i18n/native";
import {
  Button,
  Card,
  Chip,
  ErrorState,
  GroupedList,
  ListRow,
  Screen,
  Section,
  StatRow,
  Skeleton,
  StatusPill,
  Text,
  TextField,
  haptics,
} from "@sailo/design-system/native";
import { formatMoney } from "@sailo/core/currency";
import { orderTone } from "../../orders/index";
import { useT } from "../../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../../lib/query";
import { errorMessage } from "../../../../components/states";

/**
 * One customer: what they have bought, what the seller calls them, and what
 * the seller privately knows about them.
 *
 * THE TAGS ARE THE POINT
 *
 * They look decorative and they are not: a broadcast picks its audience with
 * `tags && '{vip}'`, so a tag is the mechanism by which somebody receives an
 * email. `normalizeTags` folds them — "VIP", "vip" and " vip " are one
 * audience — and it is the same function the web form and the CSV importer
 * call, which is what stops a seller mailing a third of the people they meant
 * to. The chip list shows what was *stored*, not what was typed, so a seller
 * sees the folding happen.
 *
 * The notes are private and stay private. The column is never rendered on the
 * storefront or put in an email, which is what makes it safe for "chased twice
 * about the invoice".
 */
export default function Customer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { a, t, locale } = useT();
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const shop = useQuery(trpc.shop.get.queryOptions());
  const customer = useQuery(trpc.clients.get.queryOptions({ id: id ?? "" }, { enabled: !!id }));

  const currency = shop.data?.currency ?? "USD";

  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries(trpc.clients.pathFilter()),
    [queryClient, trpc],
  );

  const setTags = useMutation(
    trpc.clients.setTags.mutationOptions({
      onSuccess: async (result) => {
        haptics.success();
        setTagDraft(null);
        /* The cap admits itself. A seller who pasted a list and lost the
           twenty-first tag is told, rather than left to notice. */
        if (result.truncated) {
          Alert.alert(a.clients.tags, interpolate(a.clients.tagsCapped, { max: String(result.max) }));
        }
        await invalidate();
      },
      onError: (error) => captureError(error, { scope: "mobile:clients:tags" }),
    }),
  );

  const setNotes = useMutation(
    trpc.clients.setNotes.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setNotesDraft(null);
        await invalidate();
      },
      onError: (error) => captureError(error, { scope: "mobile:clients:notes" }),
    }),
  );

  const remove = useMutation(
    trpc.clients.delete.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        await invalidate();
        router.back();
      },
      onError: (error) => captureError(error, { scope: "mobile:clients:delete" }),
    }),
  );

  if (customer.error) {
    reportQueryError(customer.error, { scope: "mobile:clients:get" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(customer.error, a.common.couldntLoad)}
          onRetry={() => void customer.refetch()}
          retryLabel={t.errors.retry}
          retrying={customer.isFetching}
        />
      </Screen>
    );
  }

  if (customer.isPending || !customer.data) {
    return (
      <Screen>
        <Skeleton shape="title" />
        <Skeleton shape="card" count={2} />
      </Screen>
    );
  }

  const { client, orders } = customer.data;
  const tags = tagDraft ?? client.tags.join(", ");
  const notes = notesDraft ?? client.notes ?? "";

  return (
    <Screen
      onRefresh={() => void customer.refetch()}
      refreshing={customer.isFetching}
      testID="customer"
    >
      <Stack.Screen options={{ title: client.name }} />

      {/*
        A `Section` with a `StatRow`, matching Home and Insights.

        It was a hand-built flex row of two figures inside a `padding="lg"`
        card — the third copy of that pattern in the app, and the third one that
        could not wrap. `StatRow` measures the tiles against the window, so a
        lifetime value in a currency with a three-letter code stops truncating
        on a narrow phone.
      */}
      <Section>
        <StatRow
          stats={[
            {
              label: a.clients.lifetimeValue,
              value: formatMoney(
                orders.reduce(
                  (total, order) =>
                    total + (order.status === "cancelled" ? 0 : order.totalCents),
                  0,
                ),
                currency,
                locale,
              ),
            },
            { label: a.columns.orders, value: String(orders.length) },
          ]}
        />
      </Section>

      <GroupedList header={a.clients.contact}>
        <ListRow title={a.common.email} value={client.email ?? "—"} />
        <ListRow title={a.clients.contact} value={client.phone ?? "—"} />
        {/*
          Whether this person may be mailed, as a fact with a date rather than a
          boolean. `marketingConsentAt` is null for everybody a seller typed in
          themselves, and knowing *why* somebody cannot be mailed is the
          difference between a bug and a rule.
        */}
        <ListRow
          title={a.clients.marketing}
          accessory={
            <StatusPill
              tone={client.marketingConsentAt ? "success" : "neutral"}
              label={client.marketingConsentAt ? a.common.active : a.common.off}
            />
          }
        />
      </GroupedList>

      <Card padding="lg">
        <Text variant="label" heading>
          {a.clients.tags}
        </Text>
        {/* What was stored, not what was typed — so the seller sees the folding
            that decides who a broadcast reaches. */}
        {client.tags.length > 0 ? (
          <View style={styles.chips}>
            {client.tags.map((tag) => (
              <Chip key={tag} label={tag} selected onPress={() => undefined} />
            ))}
          </View>
        ) : null}
        <TextField
          label={a.clients.tags}
          hint={a.clients.tagsHint}
          value={tags}
          onChangeText={setTagDraft}
        />
        <Button
          label={a.common.save}
          onPress={() =>
            setTags.mutate({
              id: client.id,
              /* Split here and folded on the server, which is where the rule
                 lives. Splitting on the same characters `normalizeTags` accepts
                 means a seller can paste a comma-separated list from anywhere. */
              tags: tags.split(/[,;\n]/).map((tag) => tag.trim()).filter(Boolean),
            })
          }
          loading={setTags.isPending}
          disabled={tagDraft === null}
          variant="secondary"
          fullWidth
        />
      </Card>

      <Card padding="lg">
        <Text variant="label" heading>
          {a.clients.privateNotes}
        </Text>
        <TextField
          label={a.clients.privateNotes}
          hint={a.common.private}
          placeholder={a.clients.notesPlaceholder}
          value={notes}
          onChangeText={setNotesDraft}
          multiline
          maxLength={5000}
        />
        <Button
          label={a.clients.saveNotesLabel}
          onPress={() => setNotes.mutate({ id: client.id, notes: notes.trim() || null })}
          loading={setNotes.isPending}
          disabled={notesDraft === null}
          variant="secondary"
          fullWidth
        />
      </Card>

      {orders.length > 0 ? (
        <GroupedList header={a.columns.orders}>
          {orders.slice(0, 20).map((order) => (
            <ListRow
              key={order.id}
              title={formatMoney(order.totalCents, order.currency, locale)}
              subtitle={day(order.createdAt, locale)}
              accessory={
                <StatusPill
                  tone={orderTone(order.status)}
                  label={orderStatusLabel(order.status, a.orderStatus)}
                />
              }
              trailing="chevron"
              onPress={() => router.push(`/orders/${order.id}`)}
            />
          ))}
        </GroupedList>
      ) : (
        <Text variant="callout" tone="muted">
          {a.clients.noOrdersYet}
        </Text>
      )}

      <Button
        label={a.common.delete}
        icon="delete"
        variant="danger"
        loading={remove.isPending}
        onPress={() =>
          Alert.alert(client.name, a.clients.deleteBody, [
            { text: a.common.cancel, style: "cancel" },
            {
              text: a.common.delete,
              style: "destructive",
              onPress: () => remove.mutate({ id: client.id }),
            },
          ])
        }
        fullWidth
      />
    </Screen>
  );
}

function day(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
