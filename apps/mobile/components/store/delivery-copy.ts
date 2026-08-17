/**
 * The server's refusals, in this surface's words, and a zone as one line.
 *
 * Separate because these are the strings a seller reads when a save is rejected, and a screen
 * that holds its own copy of them is a screen that will drift from the server's actual reasons.
 */

import { TRPCClientError } from "@trpc/client";
import { countryName } from "@sailo/core/countries";
import { interpolate } from "@sailo/i18n/native";
import type { useT } from "../../lib/i18n";

/** A zone, as one line under a row. */
export function zoneSummary(
  countries: readonly string[],
  locale: string,
  a: ReturnType<typeof useT>["a"],
): string {
  if (countries.length === 0) return a.delivery.zoneAnywhere;
  if (countries.length === 1) return countryName(countries[0] ?? null, locale);
  return interpolate(a.delivery.zoneCount, { count: String(countries.length) });
}

/** The server's reasons, in this surface's words. */
export function REFUSALS(a: ReturnType<typeof useT>["a"]): Record<string, string> {
  return {
    unknown_type: a.common.couldntLoad,
    no_name: a.delivery.needsName,
    unconfigured: a.delivery.needsPickup,
    empty_zone: a.delivery.needsCountry,
  };
}

export function refusalOf(error: unknown): string | null {
  if (!(error instanceof TRPCClientError)) return null;
  const message = String(error.message ?? "");
  return /^[a-z_]+$/.test(message) ? message : null;
}
