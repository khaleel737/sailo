import { useCallback, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { captureError } from "@sailo/observability";
import { countriesByName, countryFlag, countryName } from "@sailo/core/countries";
import { interpolate } from "@sailo/i18n/native";
import {
  Banner,
  Button,
  Card,
  Chip,
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
  Text,
  TextField,
  haptics,
} from "@sailo/design-system/native";
import { formatMoney, priceToText, textToPrice } from "../../../components/money";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * How an order reaches the buyer: postage rates and collection points.
 *
 * THE ZONE IS THE WHOLE SCREEN
 *
 * Everything else here is a name and a number. The zone is the part a seller
 * gets wrong, and the part the server refuses rather than guesses: an empty
 * country list means "anywhere", so "selected countries" with nothing ticked
 * would be stored as the exact opposite of what was asked for. That is why the
 * mode is a control of its own rather than inferred from whether any chips are
 * showing — the two states "I ship worldwide" and "I have not finished picking"
 * look identical in the data and mean opposite things.
 *
 * WHY COLLECTION HAS NO ZONE CONTROL
 *
 * A pickup happens at the seller's address, so filtering it by where the buyer
 * lives is a rule about the buyer rather than about the delivery. The server
 * drops any zone sent with a collection option; this screen does not offer one,
 * so the two agree rather than one silently correcting the other.
 */

type Draft = {
  id: string | null;
  type: string;
  name: string;
  fee: string;
  freeOver: string;
  config: Record<string, string>;
  isEnabled: boolean;
  zone: "anywhere" | "selected";
  countries: string[];
};

export default function Delivery() {
  const { a, t, locale } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const delivery = useQuery(trpc.delivery.list.queryOptions());
  const shop = useQuery(trpc.shop.get.queryOptions());
  const currency = shop.data?.currency ?? "USD";

  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries(trpc.delivery.pathFilter()),
    [queryClient, trpc],
  );

  const save = useMutation(
    trpc.delivery.save.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setDraft(null);
        setRefusal(null);
        await invalidate();
      },
      onError: (error) => {
        haptics.error();
        const reason = refusalOf(error);
        if (reason) {
          setRefusal(reason);
          return;
        }
        captureError(error, { scope: "mobile:delivery:save" });
      },
    }),
  );

  const toggle = useMutation(
    trpc.delivery.toggle.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        await invalidate();
      },
      onError: (error) => {
        haptics.error();
        /*
         * The one refusal a toggle can hit: switching on an option that has no
         * pickup address. The web action returns early here and the switch
         * springs back with nothing said; the router answers `unconfigured` so
         * this can say which.
         */
        if (refusalOf(error) === "unconfigured") {
          Alert.alert(a.delivery.needsPickup, a.delivery.physicalOnly);
          void invalidate();
          return;
        }
        captureError(error, { scope: "mobile:delivery:toggle" });
      },
    }),
  );

  const remove = useMutation(
    trpc.delivery.delete.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setDraft(null);
        await invalidate();
      },
      onError: (error) => captureError(error, { scope: "mobile:delivery:delete" }),
    }),
  );

  const refresh = useCallback(() => {
    void delivery.refetch();
    void shop.refetch();
  }, [delivery.refetch, shop.refetch]);

  const open = useCallback(
    (row?: NonNullable<typeof delivery.data>["methods"][number]) => {
      setRefusal(null);
      setDraft(
        row
          ? {
              id: row.id,
              type: row.type,
              name: row.name,
              fee: priceToText(row.feeCents, currency, locale),
              freeOver:
                row.freeOverCents === null ? "" : priceToText(row.freeOverCents, currency, locale),
              config: (row.config ?? {}) as Record<string, string>,
              isEnabled: row.isEnabled,
              /* Empty means "anywhere" — the same rule the server holds, read
                 the same way round. */
              zone: row.countries.length > 0 ? "selected" : "anywhere",
              countries: [...row.countries],
            }
          : {
              id: null,
              type: "shipping",
              name: "",
              fee: "",
              freeOver: "",
              config: {},
              isEnabled: true,
              zone: "anywhere",
              countries: [],
            },
      );
    },
    [currency, locale],
  );

  if (delivery.error) {
    reportQueryError(delivery.error, { scope: "mobile:delivery" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(delivery.error, a.common.couldntLoad)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={delivery.isFetching}
        />
      </Screen>
    );
  }

  const methods = delivery.data?.methods ?? [];
  const live = methods.filter((method) => method.isEnabled).length;

  return (
    <Screen onRefresh={refresh} refreshing={delivery.isFetching} testID="delivery">
      <Banner tone="info" message={a.delivery.physicalOnly} />

      {delivery.isPending ? (
        <Skeleton shape="card" count={2} />
      ) : methods.length === 0 ? (
        <EmptyState icon="package" title={a.delivery.empty} message={a.delivery.emptyBody} />
      ) : (
        <GroupedList
          header={a.delivery.title}
          footer={interpolate(a.delivery.liveOfCount, {
            live: String(live),
            total: String(methods.length),
          })}
        >
          {methods.map((method) => (
            <ListRow
              key={method.id}
              title={method.name}
              subtitleLines={2}
              subtitle={zoneSummary(method.countries, locale, a)}
              /* A zero fee is free delivery, which is a thing a seller
                 chose — not a missing number, and not an em dash. */
              value={
                method.feeCents === 0
                  ? a.delivery.free
                  : formatMoney(method.feeCents, currency, locale)
              }
              icon="package"
              trailing="chevron"
              /*
                The switch is on the row rather than only inside the sheet,
                because taking an option off at checkout is the one thing a
                seller does in a hurry — a courier stops serving a region and
                the rate has to come down now, not after a form.
              */
              accessory={
                <Switch
                  value={method.isEnabled}
                  onValueChange={() => toggle.mutate({ id: method.id })}
                  busy={toggle.isPending && toggle.variables?.id === method.id}
                  label={a.delivery.offerAtCheckout}
                />
              }
              onPress={() => open(method)}
            />
          ))}
        </GroupedList>
      )}

      <Button
        label={a.delivery.addOption}
        icon="add"
        onPress={() => open()}
        variant="secondary"
        fullWidth
      />

      <Sheet
        visible={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? a.delivery.editExisting : a.delivery.addOption}
        closeLabel={a.common.cancel}
        size="large"
        dismissible={false}
      >
        {draft ? (
          <DeliveryForm
            draft={draft}
            currency={currency}
            refusal={refusal}
            onChange={setDraft}
            onPickCountries={() => setPicking(true)}
            onSave={() =>
              save.mutate({
                id: draft.id,
                type: draft.type,
                name: draft.name,
                feeCents: textToPrice(draft.fee, currency, locale) ?? 0,
                freeOverCents: textToPrice(draft.freeOver, currency, locale),
                config: draft.config,
                isEnabled: draft.isEnabled,
                zone: draft.zone,
                countries: draft.countries,
              })
            }
            saving={save.isPending}
            onDelete={
              draft.id
                ? () =>
                    Alert.alert(draft.name, a.delivery.deleteBody, [
                      { text: a.common.cancel, style: "cancel" },
                      {
                        text: a.common.delete,
                        style: "destructive",
                        onPress: () => draft.id && remove.mutate({ id: draft.id }),
                      },
                    ])
                : undefined
            }
            deleting={remove.isPending}
          />
        ) : null}
      </Sheet>

      <CountryPicker
        visible={picking}
        selected={draft?.countries ?? []}
        onClose={() => setPicking(false)}
        onChange={(countries) =>
          setDraft((current) => (current ? { ...current, countries } : current))
        }
      />
    </Screen>
  );
}

/** The form inside the sheet, split out so the screen above stays readable. */
function DeliveryForm({
  draft,
  currency,
  refusal,
  onChange,
  onPickCountries,
  onSave,
  saving,
  onDelete,
  deleting,
}: {
  draft: Draft;
  currency: string;
  refusal: string | null;
  onChange: (next: Draft) => void;
  onPickCountries: () => void;
  onSave: () => void;
  saving: boolean;
  onDelete?: () => void;
  deleting: boolean;
}) {
  const { a, locale } = useT();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <View style={styles.form}>
      {refusal ? <Banner tone="danger" message={REFUSALS(a)[refusal] ?? a.common.couldntLoad} /> : null}

      <Segmented
        options={[
          { value: "shipping", label: a.delivery.shipsTo },
          { value: "collection", label: a.delivery.needsPickup },
        ]}
        value={draft.type}
        onChange={(next) => set("type", next)}
        accessibilityLabel={a.delivery.kind}
      />

      <TextField
        label={a.delivery.nameBuyersSee}
        value={draft.name}
        onChangeText={(next) => set("name", next)}
        maxLength={60}
      />

      <TextField
        label={interpolate(a.productForm.price, { currency })}
        value={draft.fee}
        onChangeText={(next) => set("fee", next)}
        keyboard="decimal"
      />

      <TextField
        label={a.delivery.freeOverLabel}
        hint={a.common.optional}
        value={draft.freeOver}
        onChangeText={(next) => set("freeOver", next)}
        keyboard="decimal"
      />

      {/*
        Only shipping asks where it reaches. Collection happens at the seller's
        own address, so a zone on it would be a rule about the buyer.
      */}
      {draft.type === "shipping" ? (
        <>
          <Segmented
            options={[
              { value: "anywhere", label: a.delivery.zoneAnywhere },
              { value: "selected", label: a.delivery.zoneSelected },
            ]}
            value={draft.zone}
            onChange={(next) => set("zone", next as Draft["zone"])}
            accessibilityLabel={a.delivery.shipsTo}
          />
          <Text variant="caption" tone="muted">
            {a.delivery.zoneHelp}
          </Text>

          {draft.zone === "selected" ? (
            <Card variant="outlined">
              <View style={styles.chips}>
                {draft.countries.length === 0 ? (
                  <Text variant="caption" tone="muted">
                    {a.delivery.zoneNone}
                  </Text>
                ) : (
                  draft.countries.map((code) => (
                    <Chip
                      key={code}
                      label={`${countryFlag(code)} ${countryName(code, locale)}`}
                      /* Selected because it *is* in the zone; tapping takes it
                         out. A chip is the design system's "one of a set", and
                         removal is deselection rather than a second gesture. */
                      selected
                      onPress={() =>
                        set(
                          "countries",
                          draft.countries.filter((c) => c !== code),
                        )
                      }
                    />
                  ))
                )}
              </View>
              <Button
                label={a.delivery.zoneSearch}
                icon="search"
                variant="ghost"
                onPress={onPickCountries}
                fullWidth
              />
            </Card>
          ) : null}
        </>
      ) : null}

      <Switch
        value={draft.isEnabled}
        onValueChange={(next) => set("isEnabled", next)}
        label={a.delivery.offerAtCheckout}
      />

      <Button label={a.common.save} onPress={onSave} loading={saving} fullWidth />
      {onDelete ? (
        <Button
          label={a.common.delete}
          icon="delete"
          variant="danger"
          onPress={onDelete}
          loading={deleting}
          fullWidth
        />
      ) : null}
    </View>
  );
}

/**
 * The country list, searchable.
 *
 * Names come from `Intl.DisplayNames` through `countryName`, so a Croatian
 * seller reads "Njemačka" and an English one reads "Germany" without a
 * translated list existing anywhere. Search matches the *rendered* name for
 * that reason — a seller types what they can see.
 */
function CountryPicker({
  visible,
  selected,
  onClose,
  onChange,
}: {
  visible: boolean;
  selected: readonly string[];
  onClose: () => void;
  onChange: (next: string[]) => void;
}) {
  const { a, locale } = useT();
  const [term, setTerm] = useState("");

  const all = useMemo(() => countriesByName(locale), [locale]);
  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((country) => country.name.toLowerCase().includes(needle));
  }, [all, term]);

  const chosen = new Set(selected);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={a.delivery.shipsTo}
      closeLabel={a.common.cancel}
      size="large"
    >
      <TextField
        label={a.delivery.zoneSearch}
        value={term}
        onChangeText={setTerm}
        returnKey="search"
      />

      {matches.length === 0 ? (
        <Text variant="callout" tone="muted">
          {a.delivery.zoneNone}
        </Text>
      ) : (
        <GroupedList>
          {/*
            Capped at what a sheet can render without the list becoming its own
            performance problem. The cap admits itself: a seller who searches
            sees everything that matched, and one who scrolls the unfiltered
            list is told there is more and how to reach it.
          */}
          {matches.slice(0, VISIBLE_COUNTRIES).map((country) => (
            <ListRow
              key={country.code}
              title={`${countryFlag(country.code)} ${country.name}`}
              accessory={
                chosen.has(country.code) ? (
                  <StatusPill tone="success" label={a.common.active} />
                ) : undefined
              }
              onPress={() =>
                onChange(
                  chosen.has(country.code)
                    ? selected.filter((code) => code !== country.code)
                    : [...selected, country.code],
                )
              }
            />
          ))}
        </GroupedList>
      )}

      {matches.length > VISIBLE_COUNTRIES ? (
        <Text variant="caption" tone="muted">
          {interpolate(a.delivery.zoneCount, {
            count: String(matches.length - VISIBLE_COUNTRIES),
          })}
        </Text>
      ) : null}
    </Sheet>
  );
}

/** How many rows the picker draws before asking the seller to narrow it. */
const VISIBLE_COUNTRIES = 60;

/** A zone, as one line under a row. */
function zoneSummary(
  countries: readonly string[],
  locale: string,
  a: ReturnType<typeof useT>["a"],
): string {
  if (countries.length === 0) return a.delivery.zoneAnywhere;
  if (countries.length === 1) return countryName(countries[0] ?? null, locale);
  return interpolate(a.delivery.zoneCount, { count: String(countries.length) });
}

/** The server's reasons, in this surface's words. */
function REFUSALS(a: ReturnType<typeof useT>["a"]): Record<string, string> {
  return {
    unknown_type: a.common.couldntLoad,
    no_name: a.delivery.needsName,
    unconfigured: a.delivery.needsPickup,
    empty_zone: a.delivery.needsCountry,
  };
}

function refusalOf(error: unknown): string | null {
  if (!(error instanceof TRPCClientError)) return null;
  const message = String(error.message ?? "");
  return /^[a-z_]+$/.test(message) ? message : null;
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
