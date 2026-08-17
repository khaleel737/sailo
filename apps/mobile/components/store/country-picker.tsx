/**
 * Choosing where a zone applies.
 *
 * Has its own ceiling on how many rows it draws before asking the seller to narrow the list —
 * every country on one scroll is not a picker.
 */

import { useMemo, useState } from "react";
import { countriesByName, countryFlag } from "@sailo/core/countries";
import { interpolate } from "@sailo/i18n/native";
import { GroupedList, ListRow, Sheet, StatusPill, Text, TextField } from "@sailo/design-system/native";
import { useT } from "../../lib/i18n";

/**
 * The country list, searchable.
 *
 * Names come from `Intl.DisplayNames` through `countryName`, so a Croatian
 * seller reads "Njemačka" and an English one reads "Germany" without a
 * translated list existing anywhere. Search matches the *rendered* name for
 * that reason — a seller types what they can see.
 */
export function CountryPicker({
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
export const VISIBLE_COUNTRIES = 60;
