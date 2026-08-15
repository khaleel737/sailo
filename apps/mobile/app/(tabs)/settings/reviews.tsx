import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  Segmented,
  Skeleton,
  Text,
  haptics,
} from "@sailo/design-native";
import { interpolate } from "@sailo/i18n/native";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * The moderation queue: what buyers wrote, and whether it goes on the shop.
 *
 * A review lands unapproved — `reviews.isApproved` defaults to false where
 * neither surface can forget it — so nothing a stranger writes reaches a
 * seller's storefront until they say so. This screen is where they say so.
 *
 * WHY IT OPENS ON PENDING
 *
 * The list defaults to what needs the seller. Opening on everything they have
 * ever approved buries the two rows they came for under a year of five-star
 * ratings, and the whole reason to visit is that something is waiting.
 *
 * WHY "REJECT" IS A DELETE
 *
 * There is nothing a seller would ever do with a queue of things they have
 * already decided against, and keeping the row means a buyer's name and words
 * sit in the database forever because somebody once tapped no. The confirmation
 * says it cannot be undone, because it cannot.
 */

const FILTERS = ["pending", "approved", "all"] as const;
type Filter = (typeof FILTERS)[number];

export default function Reviews() {
  const { a, t, locale } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<Filter>("pending");

  const reviews = useQuery(trpc.reviews.list.queryOptions({ status: filter }));

  const invalidate = useCallback(
    () => queryClient.invalidateQueries(trpc.reviews.pathFilter()),
    [queryClient, trpc],
  );

  const approve = useMutation(
    trpc.reviews.approve.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        await invalidate();
      },
      onError: (error) => captureError(error, { scope: "mobile:reviews:approve" }),
    }),
  );

  const remove = useMutation(
    trpc.reviews.delete.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        await invalidate();
      },
      onError: (error) => captureError(error, { scope: "mobile:reviews:delete" }),
    }),
  );

  const confirmDelete = useCallback(
    (id: string, author: string) => {
      Alert.alert(author, a.reviews.deleteBody, [
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

  const refresh = useCallback(() => void reviews.refetch(), [reviews.refetch]);

  if (reviews.error) {
    reportQueryError(reviews.error, { scope: "mobile:reviews" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(reviews.error, a.common.couldntLoad)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={reviews.isFetching}
        />
      </Screen>
    );
  }

  const rows = reviews.data ?? [];

  return (
    <Screen onRefresh={refresh} refreshing={reviews.isFetching} testID="reviews">
      <Segmented
        options={[
          { value: "pending" as const, label: a.common.pending },
          { value: "approved" as const, label: a.reviews.approved },
          { value: "all" as const, label: t.shop.all },
        ]}
        value={filter}
        onChange={setFilter}
        accessibilityLabel={a.common.status}
      />

      {reviews.isPending ? (
        <Skeleton shape="card" count={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="star"
          title={filter === "pending" ? a.reviews.nonePending : a.reviews.empty}
          message={a.reviews.emptyBody}
        />
      ) : (
        rows.map((review) => (
          <Card key={review.id} padding="lg">
            {/*
              Stars as a word, not only as glyphs. A row of ★ is unreadable to a
              screen reader and ambiguous at a glance about how many are filled;
              the number leads and the glyphs sit beside it as the fast read.
            */}
            <View style={styles.head}>
              <Text variant="heading" numberOfLines={1}>
                {review.authorName}
              </Text>
              <Text
                variant="callout"
                tone="muted"
                accessibilityLabel={interpolate(a.reviews.ratingOf, { rating: String(review.rating) })}
              >
                {"★".repeat(review.rating)}
                {"☆".repeat(5 - review.rating)}
              </Text>
            </View>

            {/*
              What it is about. A moderation queue without the product is
              unusable — "4 stars, lovely" is not something a seller can judge
              without knowing which thing it praises.
            */}
            <Text variant="caption" tone="muted">
              {review.productTitle} · {day(review.createdAt, locale)}
            </Text>

            {review.body ? <Text>{review.body}</Text> : null}

            <View style={styles.actions}>
              {/* Already-approved reviews get no second approve — a button that
                  does nothing is worse than one that is absent. */}
              {review.isApproved ? null : (
                <Button
                  label={a.common.approve}
                  icon="check"
                  onPress={() => approve.mutate({ id: review.id })}
                  loading={approve.isPending && approve.variables?.id === review.id}
                />
              )}
              <Button
                label={a.common.delete}
                icon="delete"
                variant="danger"
                onPress={() => confirmDelete(review.id, review.authorName)}
                loading={remove.isPending && remove.variables?.id === review.id}
              />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

/** The day a review landed, in the reader's own locale. */
function day(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });
  } catch {
    return iso.slice(0, 10);
  }
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  actions: { flexDirection: "row", gap: 8 },
});
