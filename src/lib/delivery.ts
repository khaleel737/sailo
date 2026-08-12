import type { DeliveryConfig } from "@/db/schema";
import { normalizeCountry, type CountryCode } from "@/lib/countries";

export const DELIVERY_METHOD_TYPES = ["shipping", "collection"] as const;
export type DeliveryMethodType = (typeof DELIVERY_METHOD_TYPES)[number];

export type DeliveryFieldKey = keyof DeliveryConfig;

export type DeliveryMethodDef = {
  type: DeliveryMethodType;
  name: string;
  description: string;
  /** Whether choosing this asks the buyer for an address. */
  needsAddress: boolean;
  fields: {
    key: DeliveryFieldKey;
    label: string;
    placeholder?: string;
    multiline?: boolean;
  }[];
};

export const DELIVERY_METHOD_DEFS: Record<
  DeliveryMethodType,
  DeliveryMethodDef
> = {
  shipping: {
    type: "shipping",
    name: "Shipping",
    description: "You post or courier the order to the buyer's address.",
    needsAddress: true,
    fields: [
      {
        key: "estimate",
        label: "Delivery estimate",
        placeholder: "2–3 working days",
      },
      {
        key: "instructions",
        label: "Notes for the buyer",
        placeholder: "We ship every Tuesday and Friday.",
        multiline: true,
      },
    ],
  },
  collection: {
    type: "collection",
    name: "Collection",
    description: "The buyer picks the order up from you.",
    needsAddress: false,
    fields: [
      {
        key: "address",
        label: "Pickup address",
        placeholder: "412 NE Alberta Street, Portland",
        multiline: true,
      },
      {
        key: "hours",
        label: "Opening hours",
        placeholder: "Mon–Fri, 10am–6pm",
      },
      {
        key: "instructions",
        label: "Notes for the buyer",
        placeholder: "Ring the bell at the side entrance.",
        multiline: true,
      },
    ],
  },
};

export const DELIVERY_METHOD_LIST = DELIVERY_METHOD_TYPES.map(
  (t) => DELIVERY_METHOD_DEFS[t],
);

export function isDeliveryMethodType(v: string): v is DeliveryMethodType {
  return (DELIVERY_METHOD_TYPES as readonly string[]).includes(v);
}

/** Collection needs a pickup address to be usable; shipping is fine bare. */
export function isDeliveryConfigured(type: string, config: DeliveryConfig) {
  if (!isDeliveryMethodType(type)) return false;
  if (type === "collection") return Boolean(config.address?.trim());
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Zones                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * As much of a delivery method as a zone question needs.
 *
 * Structural rather than `Pick<DeliveryMethod, …>` so the storefront's
 * `CheckoutDelivery` — which is a narrowed copy sent to the browser, not a row
 * — satisfies it too. One function answers for both, which is the point: a
 * rule enforced on the server and re-implemented in the panel is the twin-sink
 * bug this codebase keeps finding.
 */
export type DeliveryZone = {
  type: string;
  /**
   * Optional, though the column is `NOT NULL`.
   *
   * The storefront's copy of this comes out of `getCheckoutOptions`, which is
   * a `"use cache"` entry with `cacheLife("max")` — so the first render after
   * this feature deploys can be served a payload written by the build before
   * it, with no `countries` on it at all. Typed as absent-able so the read
   * below has to say what that means (anywhere, like an empty one) instead of
   * throwing on `undefined.length` and taking the checkout panel down.
   */
  countries?: readonly string[];
};

/**
 * Does this rate reach that country?
 *
 * **An empty zone is "anywhere", not "nowhere".** Every rate written before
 * zones existed has one, so reading it the other way would stop every existing
 * shop selling.
 *
 * A restricted rate refuses a country it cannot check. That is deliberate: the
 * alternative is letting an order through *because* the buyer left the field
 * blank, which turns the whole feature into an opt-out.
 */
export function shipsTo(method: DeliveryZone, country: string | null | undefined) {
  // Nothing is being posted, so where the buyer lives is not the seller's
  // business — a pickup happens at the seller's address either way.
  if (method.type === "collection") return true;
  // Absent and empty are the same answer — anywhere. See `DeliveryZone`.
  const zone = method.countries;
  if (!zone || zone.length === 0) return true;
  const code = normalizeCountry(country);
  if (!code) return false;
  return zone.includes(code);
}

/**
 * The countries a buyer may be offered, or `null` for "all of them".
 *
 * Null is what makes the checkout's dropdown worth having. When every shipping
 * rate a shop offers is restricted, the union of their zones is the complete
 * list of places that shop posts to — so a Croatia-only shop shows a dropdown
 * holding Croatia and nothing else, and the buyer learns the rule by reading
 * it rather than by being refused at the end.
 *
 * Any unrestricted rate, or no shipping rates at all, and there is nothing to
 * narrow: a collection-only shop must still let a buyer say where they live.
 */
export function shippableCountries(options: DeliveryZone[]): string[] | null {
  const shipping = options.filter((o) => o.type !== "collection");
  if (shipping.length === 0) return null;
  // Absent counts as unrestricted here too, and has to: a stale cached payload
  // narrowing the buyer's country list to nothing would be worse than one that
  // simply doesn't narrow it. See `DeliveryZone`.
  if (shipping.some((o) => !o.countries || o.countries.length === 0)) return null;
  return [...new Set(shipping.flatMap((o) => o.countries ?? []))];
}

/**
 * What the seller ticked, as codes worth storing.
 *
 * Deduped and sorted so two identical zones compare equal in a diff, and
 * unknown values are dropped rather than rejected — the input is a form, and a
 * stale code from an older build is not a reason to refuse the seller's save.
 * An empty result is refused by the caller instead, because "selected
 * countries" with none selected would be stored as "anywhere" and mean the
 * exact opposite of what was asked for.
 */
export function parseCountries(values: string[]): CountryCode[] {
  const codes = new Set<CountryCode>();
  for (const value of values) {
    const code = normalizeCountry(value);
    if (code) codes.add(code);
  }
  return [...codes].toSorted();
}
