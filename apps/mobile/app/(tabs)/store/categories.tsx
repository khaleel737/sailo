import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { captureError } from "@sailo/observability";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  GroupedList,
  ListRow,
  Screen,
  Sheet,
  Skeleton,
  TextField,
  haptics,
} from "@sailo/design-system/native";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * The filter chips at the top of the seller's shop, edited from the phone.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT DO
 *
 * Reorder. `categories.reorder` exists and takes the whole list at once, but
 * dragging a row needs a gesture the design system has no primitive for, and a
 * pair of up/down arrows on every row is a control that looks like a mistake on
 * iOS. Order is still the seller's — new categories append rather than jumping
 * the queue — so nothing here rearranges their shop behind their back; they
 * just cannot rearrange it from the phone yet.
 *
 * WHY A RENAME IS A SHEET AND NOT A ROW THAT BECOMES A FIELD
 *
 * A category has exactly two things a seller can do to it and one of them is
 * destructive. An inline field would have to grow a delete control beside it,
 * which is either a tiny target next to a keyboard or a swipe nobody
 * discovers. The sheet has room to say what deleting actually does — the
 * products stay, they just stop being grouped — which is the question a seller
 * hesitates over.
 */
export default function Categories() {
  const { a, t } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const categories = useQuery(trpc.categories.list.queryOptions());

  /** The new-category field. Cleared by a successful create, not by the tap. */
  const [name, setName] = useState("");
  /** The row being renamed, or null. Holds its own draft so a refetch cannot
      overwrite what is being typed. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [taken, setTaken] = useState(false);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries(trpc.categories.pathFilter()),
    [queryClient, trpc],
  );

  const create = useMutation(
    trpc.categories.create.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setName("");
        setTaken(false);
        await invalidate();
      },
      onError: (error) => onWriteError(error, setTaken, "create"),
    }),
  );

  const rename = useMutation(
    trpc.categories.rename.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setEditing(null);
        setTaken(false);
        await invalidate();
      },
      onError: (error) => onWriteError(error, setTaken, "rename"),
    }),
  );

  const remove = useMutation(
    trpc.categories.delete.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setEditing(null);
        await invalidate();
      },
      onError: (error) => captureError(error, { scope: "mobile:categories:delete" }),
    }),
  );

  const confirmDelete = useCallback(
    (id: string, title: string) => {
      /*
       * The native alert, because this is the destructive one and the system
       * dialog is the one people read rather than dismiss. The body says what
       * survives — a seller who thinks deleting a category deletes the products
       * in it will not tap, and a seller who finds out afterwards that it did
       * has lost their catalogue.
       */
      Alert.alert(title, a.categories.deleteBody, [
        { text: a.common.cancel, style: "cancel" },
        {
          text: a.common.delete,
          style: "destructive",
          onPress: () => remove.mutate({ id }),
        },
      ]);
    },
    [a, remove],
  );

  const refresh = useCallback(() => void categories.refetch(), [categories.refetch]);

  if (categories.error) {
    reportQueryError(categories.error, { scope: "mobile:categories" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(categories.error, a.common.couldntLoad)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={categories.isFetching}
        />
      </Screen>
    );
  }

  const rows = categories.data ?? [];

  return (
    <Screen onRefresh={refresh} refreshing={categories.isFetching} testID="categories">
      <Card padding="lg">
        <TextField
          label={a.categories.nameLabelText}
          placeholder={a.categories.namePlaceholder}
          value={name}
          onChangeText={(next) => {
            setName(next);
            /* The refusal is about the name that was sent, so it stops being
               true the moment the seller edits it. */
            if (taken) setTaken(false);
          }}
          error={taken && !editing ? a.categories.taken : undefined}
          returnKey="done"
          onSubmitEditing={() => name.trim() && create.mutate({ name: name.trim() })}
          maxLength={60}
        />
        <Button
          label={a.common.add}
          icon="add"
          onPress={() => create.mutate({ name: name.trim() })}
          loading={create.isPending}
          /* Nothing to add is not an error worth a message — the button simply
             is not one yet. */
          disabled={name.trim().length === 0}
          fullWidth
        />
      </Card>

      {categories.isPending ? (
        <Skeleton shape="card" count={2} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="tag"
          title={a.categories.empty}
          message={a.categories.emptyBody}
        />
      ) : (
        <GroupedList header={a.categories.title} footer={a.categories.description}>
          {rows.map((category) => (
            <ListRow
              key={category.id}
              title={category.name}
              /* The slug, because it is the storefront URL this category is
                 reachable at and renaming moves it — which is the one
                 consequence of an edit that is not visible on this screen. */
              subtitle={`/${category.slug}`}
              icon="tag"
              trailing="chevron"
              onPress={() => {
                setTaken(false);
                setEditing({ id: category.id, name: category.name });
              }}
            />
          ))}
        </GroupedList>
      )}

      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={a.common.edit}
        closeLabel={a.common.cancel}
        /* Unsaved input: a swipe-down that discarded a half-typed rename would
           be the one gesture on this screen that loses work silently. */
        dismissible={false}
      >
        <TextField
          label={a.categories.nameLabelText}
          value={editing?.name ?? ""}
          onChangeText={(next) => {
            setEditing((current) => (current ? { ...current, name: next } : current));
            if (taken) setTaken(false);
          }}
          error={taken && editing ? a.categories.taken : undefined}
          autoFocus
          maxLength={60}
        />
        <Button
          label={a.common.save}
          onPress={() =>
            editing && rename.mutate({ id: editing.id, name: editing.name.trim() })
          }
          loading={rename.isPending}
          disabled={!editing?.name.trim()}
          fullWidth
        />
        <Button
          label={a.common.delete}
          icon="delete"
          variant="danger"
          loading={remove.isPending}
          onPress={() => editing && confirmDelete(editing.id, editing.name)}
          fullWidth
        />
      </Sheet>
    </Screen>
  );
}

/**
 * A name collision, told apart from a real failure.
 *
 * The router answers `CONFLICT` with `code_taken` when two names slug to the
 * same segment — "T-Shirts" and "t shirts" are one URL — which is the seller
 * being told something true rather than anything going wrong. Reporting it
 * would fill Sentry with people typing.
 */
function onWriteError(
  error: unknown,
  setTaken: (value: boolean) => void,
  scope: string,
): void {
  const conflict =
    error instanceof TRPCClientError &&
    (error.data as { code?: string } | null | undefined)?.code === "CONFLICT";

  haptics.error();
  if (conflict) {
    setTaken(true);
    return;
  }
  captureError(error, { scope: `mobile:categories:${scope}` });
}
