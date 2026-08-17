import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { interpolate } from "@sailo/i18n/native";
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
  Switch,
  haptics,
} from "@sailo/design-system/native";
import { formatMoney, priceToText, textToPrice } from "@sailo/core/currency";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";
import {
  DeliveryForm,
  type Draft,
} from "../../../components/store/delivery-form";
import { CountryPicker } from "../../../components/store/country-picker";
import { refusalOf, zoneSummary } from "../../../components/store/delivery-copy";

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
 *
 * The form, the country picker and the refusal copy are in `components/store/` — this file's
 * own comment already called the form "split out so the screen above stays readable", and the
 * only reason it could not finish the job is that a component beside a route in Expo Router
 * becomes a route.
 */

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
