"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import {
  COUNTRY_GROUPS,
  countriesByName,
  countryFlag,
  type CountryGroupKey,
} from "@/lib/countries";
import { plural } from "@/i18n";
import { Input } from "@/components/ui";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Where a shipping rate reaches.
 *
 * The mode is a real radio pair rather than "an empty list means anywhere",
 * because in the column an empty list *does* mean anywhere — so a seller who
 * chose "selected countries" and ticked nothing would be saved as the exact
 * opposite of what they asked for. The two questions are separate here so the
 * action can refuse that combination instead of silently inverting it.
 *
 * The countries themselves ride in one hidden field rather than 244 checkbox
 * names, which keeps the request small and keeps the parsing on the server to
 * a single split.
 */
export function CountryPicker({
  defaultCountries,
}: {
  /** What this rate reaches today. Empty is anywhere. */
  defaultCountries: string[];
}) {
  const a = useAdminT();
  const locale = useAdminLocale();

  const [mode, setMode] = useState<"anywhere" | "selected">(
    defaultCountries.length > 0 ? "selected" : "anywhere",
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultCountries),
  );
  const [query, setQuery] = useState("");

  // 244 names through `Intl.DisplayNames` and a collator sort. Cheap once,
  // wasteful on every keystroke in the search box below.
  const all = useMemo(() => countriesByName(locale), [locale]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    // The code as well as the name: a seller who thinks in "DE" shouldn't have
    // to remember whether their admin says Germany or Deutschland.
    return all.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [all, query]);

  const groupLabels: Record<CountryGroupKey, string> = {
    eu: a.delivery.zoneEu,
    eea: a.delivery.zoneEea,
    europe: a.delivery.zoneEurope,
    northAmerica: a.delivery.zoneNorthAmerica,
  };

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {/*
        Radios, not a checkbox: "anywhere" and "selected" are two answers to
        one question, and a checkbox would make "not anywhere" mean "selected
        countries, possibly none of them".
      */}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {(["anywhere", "selected"] as const).map((value) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-2.5 pointer-coarse:min-h-11"
          >
            <input
              type="radio"
              name="zone"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className="size-4 border-ink-300 accent-ink-900 pointer-coarse:size-5"
            />
            <span className="text-sm">
              {value === "anywhere"
                ? a.delivery.zoneAnywhere
                : a.delivery.zoneSelected}
            </span>
          </label>
        ))}
      </div>

      {mode === "selected" ? (
        <div className="space-y-3 rounded-xl border border-ink-200 p-3">
          {/*
            Presets write codes and are then forgotten — nothing records that
            "EU" was clicked. That is deliberate: if the group were stored, the
            day a country joins or leaves would silently rewrite what this rate
            had promised, including on orders already placed.
          */}
          <div className="flex flex-wrap gap-2">
            {COUNTRY_GROUPS.map((group) => (
              <button
                key={group.key}
                type="button"
                onClick={() =>
                  setSelected((prev) => new Set([...prev, ...group.codes]))
                }
                className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
              >
                {groupLabels[group.key]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-500 transition hover:bg-ink-50"
            >
              {a.delivery.zoneClear}
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={a.delivery.zoneSearch}
              aria-label={a.delivery.zoneSearch}
              className="ps-9"
            />
          </div>

          {/*
            A fixed-height scroller. The alternative — a list that grows to 244
            rows — pushes the save button so far down the page that a seller
            editing a rate has to scroll past every country on earth to reach
            it.
          */}
          <div className="max-h-64 overflow-y-auto overscroll-contain rounded-lg">
            {matches.length === 0 ? (
              <p className="px-1 py-3 text-sm text-ink-500">{a.delivery.zoneNone}</p>
            ) : (
              <div className="grid gap-x-3 sm:grid-cols-2">
                {matches.map((country) => {
                  const on = selected.has(country.code);
                  return (
                    <label
                      key={country.code}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-ink-50 pointer-coarse:min-h-11"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(country.code)}
                        // Unnamed on purpose: the hidden field below is what
                        // the form submits, so 244 checkboxes never reach the
                        // request.
                        className="size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
                      />
                      <span className="text-sm text-ink-800">
                        <span aria-hidden="true">{countryFlag(country.code)}</span>{" "}
                        {country.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <p
            className="flex items-center gap-1.5 text-xs text-ink-500"
            // The count is the one thing a seller checks after clicking a
            // preset, so it is announced rather than only drawn.
            aria-live="polite"
          >
            <Check className="size-3.5" />
            {plural(selected.size, a.delivery.zoneCountOne, a.delivery.zoneCount)}
          </p>
        </div>
      ) : null}

      {/*
        Always rendered, including in "anywhere" mode, so switching back and
        forth doesn't lose what was ticked before the save. The server ignores
        it unless the mode says otherwise.
      */}
      <input type="hidden" name="countries" value={[...selected].join(",")} />
    </div>
  );
}
