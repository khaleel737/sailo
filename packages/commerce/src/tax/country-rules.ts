import {
  IMMEDIATE_OBLIGATION,
  isEuMemberState,
} from "@sailo/core/tax-thresholds";

/**
 * Which countries a shop will take an order from.
 *
 * Two switches decide it and they answer different questions. `disabled` is the
 * seller's own list — a country they turned off, or one the threshold monitor
 * turned off for them and recorded a reason against. `refuseImmediate` is the
 * blanket rule for places that expect registration from the very first sale,
 * where there is no threshold to approach and so nothing will ever warn.
 *
 * Kept pure and free of `server-only` because both sides need it: the storefront
 * builds its country picker from this, and `createOrderIntent` refuses with it.
 * A picker on its own is a suggestion — a server action takes whatever the
 * client sends, and "the dropdown didn't offer it" is not a property of a
 * request.
 */

export type CountryGate = {
  /** Alpha-2, upper-cased. Empty for the shop that never opened the tab. */
  disabled: ReadonlySet<string>;
  /** Refuse the places with an obligation from sale one. */
  refuseImmediate: boolean;
};

export const OPEN_GATE: CountryGate = {
  disabled: new Set<string>(),
  refuseImmediate: false,
};

const IMMEDIATE = new Set(
  IMMEDIATE_OBLIGATION.flatMap((t) => (t.country ? [t.country] : [])),
);

/**
 * True when this shop will not sell into that country.
 *
 * An unknown or absent country is **not** blocked. A digital order has no
 * address and never had one, and refusing every order that failed to state a
 * country would turn a compliance switch into a checkout outage for the
 * majority of Sailo's catalogue. The gate governs stated destinations.
 */
export function isCountryBlocked(
  gate: CountryGate,
  country: string | null | undefined,
): boolean {
  if (!country) return false;
  const code = country.toUpperCase();
  if (gate.disabled.has(code)) return true;
  return gate.refuseImmediate && IMMEDIATE.has(code);
}

/**
 * Every country this shop refuses, as a sorted list.
 *
 * For the storefront, which filters its picker by it. Materialised rather than
 * left as a predicate because it crosses to the browser, where a `Set` and a
 * closure do not survive serialisation.
 */
export function blockedCountries(gate: CountryGate): string[] {
  const out = new Set(gate.disabled);
  if (gate.refuseImmediate) for (const code of IMMEDIATE) out.add(code);
  return [...out].toSorted();
}

/**
 * The country the monitor would switch off next, given a crossed jurisdiction.
 *
 * The EU group is deliberately *not* auto-disabled. Crossing €10,000 does not
 * make selling into the EU unlawful — it changes which rate applies, and the
 * answer is an OSS registration rather than closing twenty-seven markets in one
 * night. Auto-disabling a group threshold would be the panel taking a decision
 * far larger than the one the seller switched on.
 */
export function autoDisableCandidates(
  crossed: readonly { scope: string; country: string | null; registered: boolean }[],
): string[] {
  return crossed
    .flatMap((w) =>
      w.scope !== "eu" && !w.registered && w.country
        ? [w.country.toUpperCase()]
        : [],
    )
    /*
     * A US state crossing nexus disables the whole of the US, which is coarser
     * than the obligation. It is also the only thing the checkout can express —
     * the gate is per country, because that is the field a buyer's address
     * carries reliably and `orders.region` is free text somebody typed. Coarse
     * and honest beats precise and unenforceable, and the seller sees the
     * reason recorded against the row.
     */
    .filter((code, i, all) => all.indexOf(code) === i);
}

/** True where a sale into `country` counts toward the EU's combined figure. */
export function countsTowardEu(
  country: string,
  homeCountry: string | null,
): boolean {
  return (
    isEuMemberState(country) &&
    country.toUpperCase() !== homeCountry?.toUpperCase()
  );
}
