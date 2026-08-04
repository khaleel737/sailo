"use client";

import { createContext, useContext } from "react";
import type { AdminDictionary } from "@/i18n/admin/en";

/**
 * The admin's strings, for client components.
 *
 * Server components read them straight from `getAdminT()`. Client ones —
 * forms, editors, anything with state — can't await, and threading a
 * dictionary through every prop would be noise, so the layout puts it in
 * context once.
 */
const Context = createContext<AdminDictionary | null>(null);

export function AdminI18nProvider({
  value,
  children,
}: {
  value: AdminDictionary;
  children: React.ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAdminT(): AdminDictionary {
  const value = useContext(Context);
  if (!value) {
    // A client component rendered outside the admin layout has no seller to
    // translate for; failing loudly beats shipping blank buttons.
    throw new Error("useAdminT must be used inside AdminI18nProvider");
  }
  return value;
}
