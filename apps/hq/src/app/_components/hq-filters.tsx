"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Search, X } from "lucide-react";
import { Button, Input, Select, Spinner } from "@sailo/design-system/web";

export type FilterField = {
  name: string;
  label: string;
  options: { value: string; label: string }[];
};

/** Module-scoped so the default doesn't change identity on every render. */
const NO_FIELDS: FilterField[] = [];

/**
 * The filter row above every list.
 *
 * Current values arrive as props from the page rather than from
 * `useSearchParams`, so this never forces a client-side bailout and always
 * agrees with what the server actually queried — the two can't drift.
 *
 * A dropdown applies immediately; the search box waits for Enter. Firing a
 * query on every keystroke against tables this size is a lot of work to show
 * someone the results for "khal" on the way to "khaleel".
 */
export function HqFilters({
  values,
  fields = NO_FIELDS,
  placeholder = "Search…",
}: {
  values: Record<string, string | undefined>;
  fields?: FilterField[];
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function go(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...values, ...changes })) {
      // "page" is dropped on purpose: page 4 of the old filter is not page 4
      // of the new one, and landing on an empty page reads as "no results".
      if (value && value !== "all" && key !== "page") next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  }

  const dirty = Object.entries(values).some(
    ([key, value]) => key !== "page" && value && value !== "all",
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const typed = String(new FormData(e.currentTarget).get("q") ?? "");
          go({ q: typed.trim() || undefined });
        }}
        className="relative min-w-0 flex-1 basis-64"
      >
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
        {/*
          Uncontrolled, keyed on the applied search. The field belongs to the
          browser until it is submitted, and remounting it on a back
          navigation or a Clear is what keeps it honest without an effect
          copying the URL into state on every render.
        */}
        <Input
          key={values.q ?? ""}
          name="q"
          defaultValue={values.q ?? ""}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 ps-9 pointer-coarse:h-11"
        />
      </form>

      {fields.map((field) => (
        <Select
          key={field.name}
          aria-label={field.label}
          value={values[field.name] ?? "all"}
          onChange={(e) => go({ [field.name]: e.target.value })}
          className="h-10 w-auto min-w-36 pointer-coarse:h-11"
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ))}

      {dirty ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            go(
              Object.fromEntries(
                Object.keys(values).map((key) => [key, undefined]),
              ),
            )
          }
        >
          <X className="size-3.5" />
          Clear
        </Button>
      ) : null}

      {pending ? <Spinner className="text-ink-400" /> : null}
    </div>
  );
}
