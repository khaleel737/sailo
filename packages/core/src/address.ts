import { countryName, normalizeCountry } from "./countries";

/**
 * Single-line address for chat messages and admin tables.
 *
 * The country is stored as an alpha-2 code on anything ordered since the
 * checkout grew a country list, and as free text on everything before it. Both
 * shapes pass through here and both have to read as a place: `HR` becomes
 * "Croatia" and "Hrvatska" stays "Hrvatska", because a seller reading a packing
 * slip should never be the one decoding a two-letter column — and a buyer's own
 * words are still the truest thing we have about an older order.
 *
 * One seam on purpose. Ten callers render an address; a code expanded at some
 * of them and not the others is how a WhatsApp message ends up saying `HR`
 * while the invoice beside it says Croatia.
 */
export function formatAddress(
  parts: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  },
  locale = "en",
) {
  const country = normalizeCountry(parts.country);
  return [
    parts.addressLine1,
    parts.addressLine2,
    parts.city,
    parts.region,
    parts.postalCode,
    country ? countryName(country, locale) : parts.country,
  ]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
}
