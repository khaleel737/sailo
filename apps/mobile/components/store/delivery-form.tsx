/**
 * A delivery method, as the seller fills it in.
 *
 * The sheet's form, and the `Draft` it edits. The draft type comes with it because the form is
 * the only thing that produces one — the screen reads methods back from the server and never
 * assembles a draft itself.
 *
 * The file it came out of said this was "split out so the screen above stays readable", which is
 * the right instinct and could not be finished: a component beside a route in Expo Router
 * becomes a route.
 */

import { StyleSheet, View } from "react-native";
import { countryFlag, countryName } from "@sailo/core/countries";
import { interpolate } from "@sailo/i18n/native";
import { Banner, Button, Card, Chip, Segmented, Switch, Text, TextField } from "@sailo/design-system/native";
import { useT } from "../../lib/i18n";
import { REFUSALS } from "./delivery-copy";

export type Draft = {
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

/** The form inside the sheet, split out so the screen above stays readable. */
export function DeliveryForm({
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

const styles = StyleSheet.create({
  form: { gap: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
