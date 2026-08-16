import { useCallback, useState } from "react";
import { Alert, Platform, StyleSheet, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { captureError } from "@sailo/observability";
import { bpToPercent } from "@sailo/core/pricing";
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  GroupedList,
  ListRow,
  Screen,
  Segmented,
  Sheet,
  Skeleton,
  StatusPill,
  Switch,
  TextField,
  haptics,
} from "@sailo/design-native";
import { formatMoney, priceToText, textToPrice } from "../../../components/money";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * Discount codes.
 *
 * TWO UNITS IN ONE FIELD
 *
 * `discountValue` is basis points for a percentage and minor units for a fixed
 * amount, in one column, and the form has to write and read both. The
 * conversion happens in exactly two places — `bpToPercent` on the way out and
 * `saveCoupon` on the way in — because the failure mode is a coupon worth a
 * hundred times what it says, and nothing downstream can tell the difference.
 * The percentage ceiling is the server's: over 100% is a negative order total.
 *
 * WHY EXPIRY IS THE NATIVE PICKER
 *
 * A date typed into a text field is a date in somebody's format, and there is
 * no format thirty-five locales agree on. `DateTimePicker` is the platform's
 * own — it renders a wheel on iOS and a Material dialog on Android, both
 * already localised, both already knowing how many days February has.
 */
export default function Coupons() {
  const { a, t, locale } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const shop = useQuery(trpc.shop.get.queryOptions());
  const coupons = useQuery(trpc.coupons.list.queryOptions());
  const currency = shop.data?.currency ?? "USD";

  const [draft, setDraft] = useState<Draft | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries(trpc.coupons.pathFilter()),
    [queryClient, trpc],
  );

  const save = useMutation(
    trpc.coupons.save.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setDraft(null);
        setRefusal(null);
        await invalidate();
      },
      onError: (error) => {
        haptics.error();
        const reason = reasonOf(error);
        if (reason) return setRefusal(reason);
        captureError(error, { scope: "mobile:coupons:save" });
      },
    }),
  );

  const toggle = useMutation(
    trpc.coupons.toggle.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        await invalidate();
      },
      onError: (error) => captureError(error, { scope: "mobile:coupons:toggle" }),
    }),
  );

  const remove = useMutation(
    trpc.coupons.delete.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setDraft(null);
        await invalidate();
      },
      onError: (error) => captureError(error, { scope: "mobile:coupons:delete" }),
    }),
  );

  const refresh = useCallback(() => void coupons.refetch(), [coupons.refetch]);

  /*
   * Coupons are a paid feature and the router refuses without it. A lock read
   * off the error rather than off the plan, because this is the one screen
   * where the two cannot disagree — whatever `coupons.list` says is what
   * `coupons.save` will say.
   */
  const locked =
    coupons.error instanceof TRPCClientError &&
    (coupons.error.data as { code?: string } | null | undefined)?.code === "FORBIDDEN";

  if (locked) {
    return (
      <Screen scroll={false} center>
        <EmptyState
          icon="lock"
          title={a.coupons.discountCodes}
          message={a.coupons.discountCodesBody}
        />
      </Screen>
    );
  }

  if (coupons.error) {
    reportQueryError(coupons.error, { scope: "mobile:coupons" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(coupons.error, a.common.couldntLoad)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={coupons.isFetching}
        />
      </Screen>
    );
  }

  const rows = coupons.data ?? [];

  return (
    <Screen onRefresh={refresh} refreshing={coupons.isFetching} testID="coupons">
      {/*
        ADD SITS ABOVE THE LIST, NOT UNDER IT.

        `a.coupons.emptyBody` is the web's string — "Create a code *above* and
        share it with your customers" — and the web's form genuinely is above
        its list. With the button underneath, the empty state pointed at
        nothing: the only way to make a coupon was the control below the
        sentence telling you to look up. Moving one element makes the sentence
        true in all thirty-five locales, which adding a phone-only string would
        not have done for any of them until it was translated.

        It also matches `./categories.tsx`, where the name field and its Add
        have always been the first thing on the screen.
      */}
      <Button
        label={a.common.add}
        icon="add"
        variant="secondary"
        onPress={() => {
          setRefusal(null);
          setDraft(blank());
        }}
        fullWidth
      />

      {coupons.isPending ? (
        <Skeleton shape="card" count={2} />
      ) : rows.length === 0 ? (
        <EmptyState icon="tag" title={a.coupons.empty} message={a.coupons.emptyBody} />
      ) : (
        <GroupedList header={a.coupons.title} footer={a.coupons.description}>
          {rows.map((coupon) => (
            <ListRow
              key={coupon.id}
              title={coupon.code}
              subtitle={discountLabel(coupon, currency, locale)}
              /* Three states a seller acts on differently: spent, over, or off.
                 A single "inactive" would hide which. */
              accessory={
                <StatusPill
                  tone={couponState(coupon) === "live" ? "success" : "neutral"}
                  label={stateLabel(couponState(coupon), a)}
                />
              }
              trailing="chevron"
              onPress={() => {
                setRefusal(null);
                setDraft(toDraft(coupon, currency, locale));
              }}
            />
          ))}
        </GroupedList>
      )}

      <Sheet
        visible={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? a.common.edit : a.common.add}
        closeLabel={a.common.cancel}
        size="large"
        dismissible={false}
      >
        {draft ? (
          <View style={styles.form}>
            {refusal ? <Banner tone="danger" message={REFUSALS(a)[refusal] ?? a.common.couldntLoad} /> : null}

            <TextField
              label={a.common.code}
              placeholder={a.coupons.codePlaceholder}
              value={draft.code}
              onChangeText={(next) => setDraft({ ...draft, code: next })}
              /* Stored uppercase whatever is typed — a buyer entering `summer`
                 has to match a seller who typed `Summer`. Shown that way too,
                 so the field is not quietly different from the row. */
              maxLength={40}
            />

            <Segmented
              options={[
                { value: "percent" as const, label: a.coupons.percentOff },
                { value: "fixed" as const, label: a.coupons.fixedOff },
              ]}
              value={draft.discountType}
              onChange={(next) => setDraft({ ...draft, discountType: next })}
              accessibilityLabel={a.common.type}
            />

            <TextField
              label={draft.discountType === "percent" ? "%" : a.coupons.amount}
              value={draft.value}
              onChangeText={(next) => setDraft({ ...draft, value: next })}
              keyboard="decimal"
            />

            <TextField
              label={a.coupons.minSpend}
              hint={a.common.optional}
              value={draft.minSpend}
              onChangeText={(next) => setDraft({ ...draft, minSpend: next })}
              keyboard="decimal"
            />

            <TextField
              label={a.coupons.usageLimit}
              hint={a.common.optional}
              placeholder={a.coupons.usageLimitPlaceholder}
              value={draft.maxRedemptions}
              onChangeText={(next) => setDraft({ ...draft, maxRedemptions: next })}
              keyboard="number"
            />

            <GroupedList>
              <ListRow
                title={a.common.expires}
                value={draft.expiresAt ? dayLabel(draft.expiresAt, locale) : a.columns.never}
                icon="calendar"
                onPress={() => setShowPicker(true)}
              />
              {draft.expiresAt ? (
                <ListRow
                  title={a.delivery.zoneClear}
                  destructive
                  onPress={() => setDraft({ ...draft, expiresAt: null })}
                />
              ) : null}
            </GroupedList>

            {showPicker ? (
              <DateTimePicker
                value={draft.expiresAt ?? tomorrow()}
                mode="date"
                /* The platform's own presentation. iOS 14+ renders a compact
                   field that expands; Android puts up its Material dialog and
                   dismisses itself, which is why the handler closes on both
                   `set` and `dismissed`. */
                display={Platform.OS === "ios" ? "inline" : "default"}
                minimumDate={new Date()}
                onChange={(event, date) => {
                  if (Platform.OS !== "ios") setShowPicker(false);
                  if (event.type === "set" && date) setDraft({ ...draft, expiresAt: date });
                }}
              />
            ) : null}

            <Switch
              value={draft.isActive}
              onValueChange={(next) => setDraft({ ...draft, isActive: next })}
              label={a.common.active}
            />

            <Button
              label={a.common.save}
              onPress={() =>
                save.mutate({
                  id: draft.id,
                  code: draft.code,
                  discountType: draft.discountType,
                  /*
                   * A percentage stays a plain number and a fixed amount becomes
                   * minor units. `saveCoupon` converts the percentage to basis
                   * points itself — one column holds both units, and doing that
                   * conversion in two places is how they come to disagree.
                   */
                  value:
                    draft.discountType === "percent"
                      ? Number(draft.value.replace(",", ".")) || 0
                      : (textToPrice(draft.value, currency, locale) ?? 0),
                  minSubtotalCents: textToPrice(draft.minSpend, currency, locale) ?? 0,
                  maxRedemptions: draft.maxRedemptions
                    ? Number(draft.maxRedemptions.replace(/\D/g, "")) || null
                    : null,
                  expiresAt: draft.expiresAt,
                  isActive: draft.isActive,
                })
              }
              loading={save.isPending}
              disabled={!draft.code.trim() || !draft.value.trim()}
              fullWidth
            />

            {draft.id ? (
              <>
                <Button
                  label={draft.isActive ? a.common.disable : a.common.active}
                  variant="secondary"
                  onPress={() => draft.id && toggle.mutate({ id: draft.id })}
                  loading={toggle.isPending}
                  fullWidth
                />
                <Button
                  label={a.common.delete}
                  icon="delete"
                  variant="danger"
                  loading={remove.isPending}
                  onPress={() =>
                    Alert.alert(draft.code, a.coupons.deleteBody, [
                      { text: a.common.cancel, style: "cancel" },
                      {
                        text: a.common.delete,
                        style: "destructive",
                        onPress: () => draft.id && remove.mutate({ id: draft.id }),
                      },
                    ])
                  }
                  fullWidth
                />
              </>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

export type Coupon = {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  minSubtotalCents: number;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: string | null;
  isActive: boolean;
};

type Draft = {
  id: string | null;
  code: string;
  discountType: "percent" | "fixed";
  value: string;
  minSpend: string;
  maxRedemptions: string;
  expiresAt: Date | null;
  isActive: boolean;
};

function blank(): Draft {
  return {
    id: null,
    code: "",
    discountType: "percent",
    value: "",
    minSpend: "",
    maxRedemptions: "",
    expiresAt: null,
    isActive: true,
  };
}

function toDraft(coupon: Coupon, currency: string, locale: string): Draft {
  return {
    id: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType === "fixed" ? "fixed" : "percent",
    /* Back through the same conversion it was stored with. `bpToPercent` is
       the shared inverse of `percentToBp`, so a 12.5% coupon reopens as 12.5
       rather than as 1250. */
    value:
      coupon.discountType === "fixed"
        ? priceToText(coupon.discountValue, currency, locale)
        : String(bpToPercent(coupon.discountValue)),
    minSpend:
      coupon.minSubtotalCents > 0 ? priceToText(coupon.minSubtotalCents, currency, locale) : "",
    maxRedemptions: coupon.maxRedemptions === null ? "" : String(coupon.maxRedemptions),
    expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt) : null,
    isActive: coupon.isActive,
  };
}

/** What a coupon takes off, in one line. */
function discountLabel(coupon: Coupon, currency: string, locale: string): string {
  const off =
    coupon.discountType === "fixed"
      ? formatMoney(coupon.discountValue, currency, locale)
      : `${bpToPercent(coupon.discountValue)}%`;
  return coupon.maxRedemptions === null
    ? off
    : `${off} · ${coupon.timesRedeemed}/${coupon.maxRedemptions}`;
}

/**
 * Why a coupon is not working, told apart.
 *
 * Three different facts a seller acts on differently: they switched it off,
 * it ran out of uses, or the date passed. A single "inactive" pill would send
 * all three to the same shrug.
 */
export function couponState(coupon: Coupon): "live" | "off" | "usedUp" | "expired" {
  if (!coupon.isActive) return "off";
  if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) {
    return "usedUp";
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) return "expired";
  return "live";
}

function stateLabel(value: ReturnType<typeof couponState>, a: ReturnType<typeof useT>["a"]): string {
  switch (value) {
    case "live":
      return a.common.live;
    case "usedUp":
      return a.coupons.usedUp;
    case "expired":
      return a.coupons.expired;
    default:
      return a.common.off;
  }
}

function REFUSALS(a: ReturnType<typeof useT>["a"]): Record<string, string> {
  return {
    code_too_short: a.coupons.codeTooShort,
    value_not_positive: a.coupons.valueNotPositive,
    percent_too_high: a.coupons.percentTooHigh,
    code_taken: a.coupons.codeTaken,
    not_found: a.common.couldntLoad,
  };
}

function reasonOf(error: unknown): string | null {
  if (!(error instanceof TRPCClientError)) return null;
  const message = String(error.message ?? "");
  return /^[a-z_]+$/.test(message) ? message : null;
}

function dayLabel(date: Date, locale: string): string {
  try {
    return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** The earliest expiry worth offering — today would be a coupon already dead. */
function tomorrow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date;
}

const styles = StyleSheet.create({ form: { gap: 16 } });
