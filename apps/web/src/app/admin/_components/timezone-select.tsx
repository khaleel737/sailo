"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Select } from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { useAdminT } from "./admin-i18n";

/**
 * The shop's clock, chosen from the whole world.
 *
 * This select used to offer nine hand-picked zones — a seller in Nairobi or
 * Manila found their city missing and picked UTC, which then quietly
 * timestamped every order and analytics day wrong. The full IANA table is
 * ~420 rows; grouped by region it scans fine, and it is the same table the
 * runtime itself keeps current.
 *
 * Detection works the way the country field's does: the browser already
 * knows where it is, so the control says so — a one-tap chip rather than a
 * silent overwrite, because "this machine's zone" and "this shop's zone" are
 * the same thing for most sellers and deliberately different for some.
 */
function subscribeToNothing() {
  return () => {};
}

export function TimezoneSelect({
  name = "timeZone",
  defaultValue,
  id,
}: {
  name?: string;
  defaultValue: string;
  id?: string;
}) {
  const a = useAdminT();
  const [value, setValue] = useState(defaultValue);

  /* The browser's own answer — empty on the server, real after hydration. */
  const detected = useSyncExternalStore(
    subscribeToNothing,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    () => "",
  );

  const groups = useMemo(() => {
    const zones = Intl.supportedValuesOf("timeZone");
    /*
     * The stored value must be an option or the browser silently shows the
     * first row while the form still posts the truth — "UTC" is the live
     * case: it is a valid zone the runtime accepts but not a row in
     * `supportedValuesOf` (that table carries "Etc/UTC").
     */
    const all = zones.includes(value) ? zones : [value, ...zones];
    const byRegion = new Map<string, string[]>();
    for (const zone of all) {
      const slash = zone.indexOf("/");
      const region = slash === -1 ? "Other" : zone.slice(0, slash);
      const list = byRegion.get(region) ?? [];
      list.push(zone);
      byRegion.set(region, list);
    }
    return [...byRegion.entries()];
  }, [value]);

  return (
    <div className="space-y-1.5">
      <Select
        id={id}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        {groups.map(([region, zones]) => (
          <optgroup key={region} label={region}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      {detected && detected !== value ? (
        <button
          type="button"
          onClick={() => setValue(detected)}
          className="focus-ring inline-flex items-center rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 transition hover:bg-brand-100 pointer-coarse:min-h-9"
        >
          {interpolate(a.settings.useDetectedZone, {
            zone: detected.replace(/_/g, " "),
          })}
        </button>
      ) : null}
    </div>
  );
}
