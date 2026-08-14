import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { interpolate } from "@sailo/i18n/native";
import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  Segmented,
  Sheet,
  Skeleton,
  Stat,
  StatusPill,
  Text,
  TextField,
  Toast,
  type StatusTone,
} from "@sailo/design-native";
import { useT } from "../../lib/i18n";
import { useTRPC } from "../../lib/query";
import { newOperationId } from "../../lib/scan-queue";
import { errorMessage } from "../../components/states";

/**
 * The door itself: who is in, who is still outside, and the two ways to change
 * that.
 *
 * WHAT IS HERE AND WHAT IS NOT
 *
 * The guest list and the keypad, both working. **The camera is not**, and its
 * absence is a missing package rather than a missing decision: `expo-camera` is
 * not in `apps/mobile/package.json`, which belongs to A00 and is not this work
 * order's to edit. Rather than render a third tab that cannot start a preview —
 * a dead control is worse than an absent one — the tabs are the two that work,
 * and the scanner joins them as `a.checkin.tabScan` on the day the dependency
 * lands. `lib/scan-queue.ts` is the half of that feature this work order could
 * finish, and it is written and tested behind the same seam.
 *
 * WHY THE TWO PATHS USE DIFFERENT PROCEDURES
 *
 * Tapping a name calls `tickets.admitByTicket`, which takes no idempotency key.
 * Typing a code calls `tickets.admit`, which does. That is A03's distinction and
 * it is a real one: a volunteer tapping a row is looking at the person and the
 * row, so a second tap is a question rather than a duplicate — but a typed code
 * is a request that can be retried by a network this app does not control, and
 * a replay needs to come back with the answer it gave the first time rather than
 * an `already_used` that reads as a refusal.
 *
 * WHY THE LIST IS THE SERVER'S
 *
 * Search, filter and tier are all pushed into the query rather than applied to
 * the rows this phone happens to be holding. A door list is capped at a hundred
 * rows, so filtering locally would answer "nobody matching that" for a guest who
 * is on the list at position two hundred — which at a door means turning away
 * somebody who paid.
 */

/** One screenful of names. The cap is admitted on screen, never silent. */
const PAGE = 100;

/**
 * How long the search box waits before it means it.
 *
 * The same 300ms the orders list uses, and for the same reason: a volunteer
 * typing a surname wants one request, not eight, and the trailing edge means
 * somebody who types "ham" and keeps going never gets the results for "ha".
 */
const SEARCH_DEBOUNCE = 300;

/** Which half of the door the volunteer is using. */
type Pane = "list" | "manual";

/** The filters `DOOR_FILTERS` defines, which this screen must not invent. */
type Filter = "all" | "in" | "out" | "revoked";

export default function DoorScreen() {
  const { t, a, locale } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  const [pane, setPane] = useState<Pane>("list");
  const [status, setStatus] = useState<Filter>("all");
  /** What is in the box, which changes on every keystroke. */
  const [typed, setTyped] = useState("");
  /** What the server has been asked for, which does not. */
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [walkUp, setWalkUp] = useState(false);
  const [note, setNote] = useState<{ message: string; tone: StatusTone } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [typed]);

  const door = useQuery(
    trpc.events.door.queryOptions(
      {
        productId,
        search: search || undefined,
        status,
        limit: PAGE,
        offset: 0,
      },
      {
        // Keeps the names on screen while a changed filter loads. Without it
        // every keystroke's debounce ends in a flash of skeletons where the
        // volunteer's results were.
        placeholderData: keepPreviousData,
      },
    ),
  );

  /**
   * Put the counters and the list back in step after every write.
   *
   * The whole `events` path rather than this one query: the picker's "12 of 40"
   * is the same fact as this screen's counter, and a volunteer who backs out to
   * switch rooms must not read a number that stopped being true an hour ago.
   */
  const refetchDoor = useCallback(() => {
    void queryClient.invalidateQueries(trpc.events.pathFilter());
  }, [queryClient, trpc]);

  /**
   * Says what happened, in the seller's language, from the server's own answer.
   *
   * Every branch is a sentence a volunteer can act on. `already_used` is
   * deliberately `warning` rather than `danger`: somebody stepping out for a
   * cigarette and coming back is the most common thing that happens at a door
   * after a clean admission, and a screen that renders it in the same red as a
   * forged ticket teaches the volunteer to ignore red.
   */
  const describe = useCallback(
    (result: {
      status: string;
      attendee?: string | null;
      buyer?: string | null;
      productTitle?: string | null;
      usedAt?: string | Date | null;
    }): { message: string; tone: StatusTone } => {
      const who = result.attendee ?? result.buyer ?? null;

      switch (result.status) {
        case "checked_in":
          return { message: [who, a.checkin.filterIn].filter(Boolean).join(" · "), tone: "success" };
        case "already_used": {
          const at = formatTime(result.usedAt, locale);
          return {
            message: [who, at ? interpolate(a.checkin.inAt, { time: at }) : a.checkin.filterIn]
              .filter(Boolean)
              .join(" · "),
            tone: "warning",
          };
        }
        case "wrong_event":
          return {
            message: result.productTitle
              ? interpolate(a.checkin.wrongEvent, { event: result.productTitle })
              : a.checkin.wrongEventUnknown,
            tone: "danger",
          };
        case "revoked":
          return { message: a.checkin.revoked, tone: "danger" };
        case "not_released":
          return { message: a.checkin.unpaid, tone: "danger" };
        default:
          // `not_found`, and anything a future server learns to say that this
          // build has never heard of. Both are "this code is not on the list",
          // which is the honest answer rather than a crash.
          return { message: a.checkin.noMatches, tone: "danger" };
      }
    },
    [a, locale],
  );

  const onWriteError = useCallback(
    (error: unknown, scope: string) => {
      captureError(error, { scope });
      setNote({ message: errorMessage(error, t.errors.body), tone: "danger" });
    },
    [t],
  );

  const admitByTicket = useMutation(
    trpc.tickets.admitByTicket.mutationOptions({
      onSuccess: (result) => {
        setNote(describe(result));
        refetchDoor();
      },
      onError: (error) => onWriteError(error, "mobile:checkin:admitByTicket"),
    }),
  );

  const admitByCode = useMutation(
    trpc.tickets.admit.mutationOptions({
      onSuccess: (result) => {
        setNote(describe(result));
        // Only clear the box on an answer. A code that came back `not_found`
        // is usually a typo in the last character, and wiping it makes the
        // volunteer read all ten off the ticket again.
        if (result.status === "checked_in" || result.status === "already_used") setCode("");
        refetchDoor();
      },
      onError: (error) => onWriteError(error, "mobile:checkin:admit"),
    }),
  );

  const undo = useMutation(
    trpc.tickets.undoAdmission.mutationOptions({
      onSuccess: () => {
        setNote({ message: a.checkin.undo, tone: "neutral" });
        refetchDoor();
      },
      onError: (error) => onWriteError(error, "mobile:checkin:undo"),
    }),
  );

  const addWalkUp = useMutation(
    trpc.tickets.addWalkUp.mutationOptions({
      onSuccess: () => {
        setWalkUp(false);
        setNote({ message: a.checkin.walkUp, tone: "success" });
        refetchDoor();
      },
      onError: (error) => onWriteError(error, "mobile:checkin:walkUp"),
    }),
  );

  const submitCode = useCallback(() => {
    const entered = code.trim();
    if (!entered) return;
    admitByCode.mutate({
      code: entered,
      productId,
      /*
       * A fresh key per attempt, minted by the offline queue's generator so
       * that a typed code and a queued scan are namespaced the same way. It is
       * the retry that has to reuse a key, not the volunteer — somebody typing
       * the same code twice on purpose is asking a second question.
       */
      idempotencyKey: newOperationId(),
    });
  }, [admitByCode, code, productId]);

  const refresh = useCallback(() => {
    void door.refetch();
  }, [door.refetch]);

  const stats = door.data?.stats;
  const rows = useMemo(() => door.data?.rows ?? [], [door.data?.rows]);
  const total = door.data?.total ?? 0;
  const narrowed = status !== "all" || search !== "";
  /** The write in flight, if any — every control that could start a second one waits. */
  const busy =
    admitByTicket.isPending || admitByCode.isPending || undo.isPending || addWalkUp.isPending;

  const filters = useMemo(
    () => [
      { value: "all" as const, label: a.checkin.filterAll },
      { value: "in" as const, label: a.checkin.filterIn },
      { value: "out" as const, label: a.checkin.filterOut },
      { value: "revoked" as const, label: a.checkin.filterRevoked },
    ],
    [a],
  );

  const panes = useMemo(
    () => [
      { value: "list" as const, label: a.checkin.tabList },
      { value: "manual" as const, label: a.checkin.tabManual },
    ],
    [a],
  );

  /*
   * The counters and the tabs sit above everything and are rendered by all
   * three returns, so they stay put while the rows below them load, fail and
   * reload. React reconciles by position, so the search text and the chosen
   * filter survive the list going from skeletons to names to an error and back.
   */
  const header = (
    <>
      <Stack.Screen options={{ title: a.checkin.title }} />

      <View style={styles.stats}>
        <Stat label={a.checkin.statIn} value={String(stats?.checkedIn ?? 0)} loading={!stats} />
        <Stat label={a.checkin.statOut} value={String(stats?.remaining ?? 0)} loading={!stats} />
        <Stat label={a.checkin.statIssued} value={String(stats?.issued ?? 0)} loading={!stats} />
        {/*
          Capacity is null for an event that does not track inventory, which
          means uncapped rather than zero — so the tile is absent rather than
          showing a nought that reads as a sold-out room.
        */}
        {stats?.capacity != null ? (
          <Stat label={a.checkin.statCapacity} value={String(stats.capacity)} />
        ) : null}
      </View>

      <View style={styles.tabs}>
        <Segmented
          options={panes}
          value={pane}
          onChange={setPane}
          accessibilityLabel={a.checkin.title}
          testID="checkin-pane"
        />
      </View>
    </>
  );

  const feedback = (
    <Toast
      visible={note !== null}
      message={note?.message ?? ""}
      tone={note?.tone ?? "neutral"}
      onDismiss={() => setNote(null)}
      duration="long"
      testID="checkin-outcome"
    />
  );

  if (pane === "manual") {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right"]}>
        {header}
        <View style={styles.manual}>
          <TextField
            label={a.checkin.codeLabel}
            value={code}
            onChangeText={setCode}
            hint={a.checkin.scanHint}
            autoComplete="off"
            returnKey="done"
            onSubmitEditing={submitCode}
            testID="checkin-code"
          />
          <Button
            label={a.checkin.submit}
            variant="primary"
            fullWidth
            onPress={submitCode}
            loading={admitByCode.isPending}
            disabled={busy || code.trim() === ""}
            testID="checkin-submit"
          />
        </View>
        {feedback}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      {header}

      <View style={styles.controls}>
        <TextField
          label={a.checkin.searchLabel}
          placeholder={a.checkin.searchPlaceholder}
          value={typed}
          onChangeText={setTyped}
          returnKey="search"
          testID="checkin-search"
        />
        <Segmented
          options={filters}
          value={status}
          onChange={setStatus}
          accessibilityLabel={a.checkin.searchLabel}
          testID="checkin-filter"
        />
      </View>

      {door.isPending ? (
        <View style={styles.list}>
          <Skeleton shape="row" count={8} />
        </View>
      ) : door.error ? (
        <ErrorState
          message={t.errors.title}
          detail={errorMessage(door.error, t.errors.body)}
          onRetry={refresh}
          retrying={door.isFetching}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.list}
          initialNumToRender={14}
          maxToRenderPerBatch={14}
          windowSize={7}
          removeClippedSubviews
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={door.isFetching && !door.isPending}
              onRefresh={refresh}
            />
          }
          renderItem={({ item }) => (
            <GuestRow
              row={item}
              locale={locale}
              labels={a.checkin}
              busy={busy}
              onAdmit={() => admitByTicket.mutate({ id: item.id, productId })}
              onUndo={() => undo.mutate({ id: item.id })}
            />
          )}
          ListEmptyComponent={
            narrowed ? (
              <EmptyState icon="search" title={a.checkin.noMatches} />
            ) : (
              <EmptyState
                icon="person"
                title={a.checkin.emptyList}
                message={a.checkin.emptyListBody}
              />
            )
          }
          /*
           * The cap, said out loud. A hundred of three hundred and forty names
           * with nothing announcing it is a list a volunteer will scroll to the
           * bottom of and conclude the guest is not on it.
           */
          ListFooterComponent={
            total > rows.length ? (
              <View style={styles.footer}>
                <Text variant="caption" tone="muted" align="center">
                  {interpolate(a.checkin.showingOf, { shown: rows.length, total })}
                </Text>
              </View>
            ) : null
          }
        />
      )}

      <View style={styles.actions}>
        <Button
          label={a.checkin.addGuest}
          icon="add"
          fullWidth
          onPress={() => setWalkUp(true)}
          disabled={busy}
          testID="checkin-walkup"
        />
      </View>

      <WalkUpSheet
        visible={walkUp}
        labels={a.checkin}
        pending={addWalkUp.isPending}
        onClose={() => setWalkUp(false)}
        onSubmit={(guest) => addWalkUp.mutate({ productId, ...guest })}
      />

      {feedback}
    </SafeAreaView>
  );
}

/**
 * One name on the list, and the one thing that can be done about it.
 *
 * The action is `admit` or `undo` and never both: a row is in or it is out, and
 * offering two buttons per row on a phone at a door is how a volunteer taps the
 * wrong one in the dark. A revoked ticket offers neither — reinstating it is a
 * decision about a refund, which belongs on the seller's own screen rather than
 * in a stranger's hands at an entrance.
 */
function GuestRow({
  row,
  locale,
  labels,
  busy,
  onAdmit,
  onUndo,
}: {
  row: {
    id: string;
    code: string;
    status: string;
    name: string | null;
    tier: string | null;
    source: string;
    usedAt: string | Date | null;
    checkedInBy: string | null;
    payable: boolean;
  };
  locale: string;
  labels: Record<string, string>;
  busy: boolean;
  onAdmit: () => void;
  onUndo: () => void;
}) {
  const inside = row.status === "used";
  const revoked = row.status === "void";
  const at = formatTime(row.usedAt, locale);

  const subtitle = [
    row.code,
    row.tier,
    // A comp and a walk-up are not sales, and a volunteer looking at a name
    // with no order behind it should be able to see why rather than assume a
    // bug. `source` is the row's own word for it.
    row.source === "manual" ? labels.walkUp : row.source === "import" ? labels.comp : null,
    inside && at ? interpolate(labels.inAt ?? "", { time: at }) : null,
    inside && row.checkedInBy ? interpolate(labels.byWhom ?? "", { name: row.checkedInBy }) : null,
    !row.payable && !inside ? labels.unpaid : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const tone: StatusTone = revoked ? "danger" : inside ? "success" : "neutral";
  const badge = revoked ? labels.filterRevoked : inside ? labels.filterIn : labels.filterOut;

  return (
    <ListRow
      title={row.name ?? row.code}
      subtitle={subtitle}
      icon="person"
      accessory={
        <View style={styles.rowEnd}>
          <StatusPill label={badge ?? ""} tone={tone} size="sm" />
          {revoked ? null : (
            <Button
              label={(inside ? labels.undo : labels.admit) ?? ""}
              size="sm"
              variant={inside ? "ghost" : "primary"}
              onPress={inside ? onUndo : onAdmit}
              disabled={busy}
              testID={`checkin-${inside ? "undo" : "admit"}-${row.id}`}
            />
          )}
        </View>
      }
      accessibilityLabel={[row.name ?? row.code, subtitle, badge].filter(Boolean).join(", ")}
      testID={`checkin-row-${row.id}`}
    />
  );
}

/**
 * Somebody who turned up without a ticket and is being let in anyway.
 *
 * Writes them onto the list *and* admits them in one call, which is what
 * `tickets.addWalkUp` does — the two halves as separate taps would leave a guest
 * standing at the door between them, on the list and not through it.
 *
 * The email is optional and says so. Asking a stranger for one at an entrance
 * to get past a required field is how door lists fill up with `a@a.com`.
 */
function WalkUpSheet({
  visible,
  labels,
  pending,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  labels: Record<string, string>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (guest: { name: string; email: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  /*
   * Cleared when the sheet opens rather than when it closes. A volunteer who
   * dismisses it by accident mid-name and reopens it has not lost the name;
   * one who adds a guest and opens it again for the next person gets an empty
   * form rather than the last person's details to delete.
   */
  useEffect(() => {
    if (visible) return;
    setName("");
    setEmail("");
  }, [visible]);

  const ready = name.trim().length > 0;

  return (
    <Sheet visible={visible} onClose={onClose} title={labels.addGuest} dismissible={!pending}>
      <View style={styles.sheet}>
        <Text variant="callout" tone="muted">
          {labels.addGuestBody}
        </Text>
        <TextField
          label={labels.guestName ?? ""}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          maxLength={120}
          testID="walkup-name"
        />
        <TextField
          label={labels.guestEmail ?? ""}
          value={email}
          onChangeText={setEmail}
          keyboard="email"
          autoComplete="email"
          maxLength={200}
          testID="walkup-email"
        />
        <Button
          label={labels.addAndAdmit ?? ""}
          variant="primary"
          fullWidth
          loading={pending}
          disabled={!ready || pending}
          onPress={() => onSubmit({ name: name.trim(), email: email.trim() || null })}
          testID="walkup-submit"
        />
      </View>
    </Sheet>
  );
}

/**
 * The time an admission happened, in the seller's language.
 *
 * Time only, not the date: everything on this screen happened tonight, and a
 * date beside every name is four words of noise per row. Built per call rather
 * than memoised because it runs on the rows actually rendered, which is a
 * screenful — and wrapped in a `try` because Hermes' ICU is narrower than a
 * browser's and an absent `Intl` must degrade rather than throw at a door.
 */
function formatTime(value: string | Date | null | undefined, locale: string): string | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return null;
  try {
    return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(at);
  } catch {
    return new Date(at).toISOString().slice(11, 16);
  }
}

/*
 * Layout only — flex and spacing, nothing with a colour, a radius or a font size
 * in it. Every visual decision belongs to `@sailo/design-native`; what is left
 * is where the boxes sit relative to each other. No `left` or `right` anywhere,
 * so Arabic mirrors without this file being reopened.
 */
const styles = StyleSheet.create({
  safe: { flex: 1 },
  stats: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  tabs: { paddingHorizontal: 16, paddingTop: 12 },
  controls: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
  footer: { paddingVertical: 12 },
  actions: { paddingHorizontal: 16, paddingVertical: 8 },
  manual: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  rowEnd: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheet: { gap: 12 },
});
