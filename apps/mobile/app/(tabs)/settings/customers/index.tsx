import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { captureError } from "@sailo/observability";
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  GroupedList,
  ListRow,
  Screen,
  Sheet,
  Skeleton,
  TextField,
  haptics,
} from "@sailo/design-native";
import { formatMoney } from "../../../../components/money";
import { useT } from "../../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../../lib/query";
import { errorMessage } from "../../../../components/states";

/**
 * The people who have bought from this shop.
 *
 * WHY THE NUMBERS ARE ON THE ROW
 *
 * `clients.list` sends `orderCount` and `spentCents` with each row, and this
 * screen leads with the second one. A name with no history beside it is a
 * contact, not a customer — a seller scanning this list is looking for who is
 * worth a message, and that question is answered by what somebody has spent
 * rather than by how their name is spelled.
 *
 * WHY A SELLER CANNOT RECORD CONSENT HERE
 *
 * `clients.add` takes no `marketingConsentAt` and this form offers no control
 * for one. Consent is a fact about a moment a person agreed to something; a
 * seller typing a contact in is making a claim on their behalf. The banner says
 * so rather than leaving the seller to discover it when a broadcast skips half
 * their list.
 */

/** How long the search waits before it means it. Matches the Orders tab. */
const DEBOUNCE_MS = 300;
const PAGE = 50;

export default function Customers() {
  const { a, t, locale } = useT();
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<{ name: string; email: string; phone: string } | null>(
    null,
  );
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const shop = useQuery(trpc.shop.get.queryOptions());
  const clients = useQuery(
    trpc.clients.list.queryOptions(
      { search: search || undefined, limit: PAGE },
      {
        /* Without this every keystroke's debounce ends in a flash of skeletons
           over a list that already had rows in it. */
        placeholderData: keepPreviousData,
      },
    ),
  );

  const currency = shop.data?.currency ?? "USD";

  const add = useMutation(
    trpc.clients.add.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setAdding(null);
        setRefusal(null);
        await queryClient.invalidateQueries(trpc.clients.pathFilter());
      },
      onError: (error) => {
        haptics.error();
        const code =
          error instanceof TRPCClientError
            ? (error.data as { code?: string } | null | undefined)?.code
            : undefined;
        /* Both refusals are the seller being told something true rather than
           anything going wrong, so neither is reported. */
        if (code === "CONFLICT") return setRefusal("already_listed");
        if (code === "BAD_REQUEST") return setRefusal("needs_contact");
        captureError(error, { scope: "mobile:clients:add" });
      },
    }),
  );

  const refresh = useCallback(() => void clients.refetch(), [clients.refetch]);

  if (clients.error) {
    reportQueryError(clients.error, { scope: "mobile:clients" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(clients.error, a.common.couldntLoad)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={clients.isFetching}
        />
      </Screen>
    );
  }

  const rows = clients.data ?? [];

  return (
    <Screen onRefresh={refresh} refreshing={clients.isFetching} testID="customers">
      <TextField
        label={t.common.search}
        value={typed}
        onChangeText={setTyped}
        returnKey="search"
      />

      {clients.isPending ? (
        <Skeleton shape="card" count={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="person"
          title={search ? a.clients.noneTagged : a.clients.empty}
          message={search ? a.clients.noneTaggedBody : a.clients.emptyBody}
        />
      ) : (
        <GroupedList header={a.clients.all}>
          {rows.map((client) => (
            <ListRow
              key={client.id}
              title={client.name}
              /* Contact first, because it is what a seller acts on — the tags
                 are how they were *found*, not what to do next. */
              subtitle={client.email ?? client.phone ?? a.clients.noDetails}
              valueTone="strong"
              value={formatMoney(client.spentCents, currency, locale)}
              icon="person"
              trailing="chevron"
              onPress={() => router.push(`/settings/customers/${client.id}`)}
              /* One sentence rather than three stops: a name, a contact and an
                 amount read separately are three things a listener has to
                 pair up themselves. */
              accessibilityLabel={`${client.name}. ${a.columns.orders} ${client.orderCount}. ${a.clients.lifetimeValue} ${formatMoney(client.spentCents, currency, locale)}`}
            />
          ))}
        </GroupedList>
      )}

      <Button
        label={a.clients.add}
        icon="add"
        variant="secondary"
        onPress={() => {
          setRefusal(null);
          setAdding({ name: "", email: "", phone: "" });
        }}
        fullWidth
      />

      <Sheet
        visible={adding !== null}
        onClose={() => setAdding(null)}
        title={a.clients.add}
        closeLabel={a.common.cancel}
        dismissible={false}
      >
        <View style={styles.form}>
          {/*
            Said before the form rather than after the save. A seller adding a
            contact from a fair is usually adding them *in order to* mail them,
            and finding out afterwards that this one cannot be mailed is finding
            out that the work was pointless.
          */}
          <Banner tone="info" message={a.clients.addConsentNote} />

          {refusal ? (
            <Banner
              tone="danger"
              message={
                refusal === "already_listed" ? a.clients.alreadyListed : a.clients.needsContact
              }
            />
          ) : null}

          <TextField
            label={a.common.name}
            value={adding?.name ?? ""}
            onChangeText={(next) =>
              setAdding((current) => (current ? { ...current, name: next } : current))
            }
            maxLength={120}
            autoFocus
          />
          <TextField
            label={a.common.email}
            hint={a.common.optional}
            value={adding?.email ?? ""}
            onChangeText={(next) =>
              setAdding((current) => (current ? { ...current, email: next } : current))
            }
            keyboard="email"
            autoComplete="email"
          />
          <TextField
            label={a.clients.contact}
            hint={a.common.optional}
            value={adding?.phone ?? ""}
            onChangeText={(next) =>
              setAdding((current) => (current ? { ...current, phone: next } : current))
            }
            keyboard="phone"
          />

          <Button
            label={a.common.add}
            onPress={() =>
              adding &&
              add.mutate({
                name: adding.name.trim(),
                email: adding.email.trim() || null,
                phone: adding.phone.trim() || null,
              })
            }
            loading={add.isPending}
            disabled={!adding?.name.trim()}
            fullWidth
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: 16 } });
