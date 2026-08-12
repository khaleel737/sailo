"use client";

import { createContext, useContext, useMemo } from "react";
import type { AdminDictionary } from "@sailo/i18n/admin/en";

/**
 * The admin's strings, for client components.
 *
 * Server components read them straight from `getAdminT()`. Client ones —
 * forms, editors, anything with state — can't await, and threading a
 * dictionary through every prop would be noise, so the layout puts it in
 * context once.
 */
/**
 * The locale rides along with the strings.
 *
 * Money and dates are translated too — `1.234,56 €` and `7. Aug. 2026` are
 * German the same way "Bezahlt" is — and `Intl` needs the tag, not the
 * dictionary. Passing it through props everywhere would be the same noise
 * this context exists to avoid.
 */
type AdminI18n = { dictionary: AdminDictionary; locale: string };

const Context = createContext<AdminI18n | null>(null);

export function AdminI18nProvider({
  value,
  locale,
  children,
}: {
  value: AdminDictionary;
  locale: string;
  children: React.ReactNode;
}) {
  const i18n = useMemo(() => ({ dictionary: value, locale }), [value, locale]);
  return <Context.Provider value={i18n}>{children}</Context.Provider>;
}

function useAdminI18n(): AdminI18n {
  const value = useContext(Context);
  if (!value) {
    // A client component rendered outside the admin layout has no seller to
    // translate for; failing loudly beats shipping blank buttons.
    throw new Error("useAdminT must be used inside AdminI18nProvider");
  }
  return value;
}

export function useAdminT(): AdminDictionary {
  return useAdminI18n().dictionary;
}

/** The seller's locale, for `Intl` — money, dates, numbers. */
export function useAdminLocale(): string {
  return useAdminI18n().locale;
}
