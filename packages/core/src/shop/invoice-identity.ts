import { countryName, normalizeCountry } from "../place/countries";
import type { Shop } from "@sailo/db/schema";

/**
 * Who the invoice says the seller is.
 *
 * One seam, for the same reason `formatAddress` is one: the PDF, the public
 * invoice page and the /hq account view each rendered the seller's header out
 * of `shop.name` and `shop.location` on their own, and the moment a structured
 * address existed that would have been three places to teach about it — with
 * the usual outcome that the page shows the registered entity and the PDF
 * beside it still shows the trading name.
 *
 * **The fallback is the whole design.** Every field behind this is nullable and
 * most shops will never fill one in: a sole trader selling presets has no
 * registered entity distinct from themselves, and asking for a company number
 * before they may sell anything is answering a question the law has not put to
 * them. So when nothing is set this returns exactly what the invoice printed
 * before these columns existed — trading name, `location`, contact email, tax
 * id — and an invoice issued last year reprints today byte-identical.
 *
 * A seller who does fill them in gets the header a tax authority expects:
 * registered name, structured postal address, company registration number
 * beside the VAT number. Opting in is the only thing that switches it over,
 * which is what makes this safe to deploy to every existing shop at once.
 *
 * No `server-only` and no database access — it takes a row the caller already
 * holds. That is what lets the PDF renderer, a React page and a test all use
 * the same one.
 */

export type InvoiceIdentity = {
  /** The registered entity where there is one, else the trading name. */
  name: string;
  /**
   * The trading name, when it differs from `name`.
   *
   * Null when they are the same, so a caller can render "trading as …" without
   * first having to compare two strings and get the comparison right. A buyer
   * who paid "Ada's Ceramics" and receives an invoice headed "A. Lovelace Ltd"
   * needs the line that connects them, or the invoice looks like it came from
   * a stranger — which is a chargeback waiting to be filed.
   */
  tradingAs: string | null;
  /**
   * The address, one line per element, already localised and already stripped
   * of the empty ones. An array rather than a joined string because the PDF
   * stacks them and the HTML page wants `<br>` between them, and a caller that
   * has to re-split on ", " will eventually split a street name containing one.
   */
  addressLines: string[];
  email: string | null;
  /** VAT/GST registration number — what `taxId` has always held. */
  taxId: string | null;
  /** Companies House number, HRB, SIRET. A different number from `taxId`. */
  registrationNumber: string | null;
};

type IdentityShop = Pick<
  Shop,
  | "name"
  | "location"
  | "contactEmail"
  | "taxId"
  | "invoiceLegalName"
  | "invoiceAddressLine1"
  | "invoiceAddressLine2"
  | "invoiceCity"
  | "invoiceRegion"
  | "invoicePostalCode"
  | "invoiceCountry"
  | "invoiceRegistrationNumber"
>;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Whether this shop has told us who it legally is.
 *
 * The legal name alone decides it, rather than "any field is set". A seller
 * who typed a postcode and wandered off has not given us an invoice header —
 * rendering a structured block from a postcode and nothing else would drop the
 * `location` line that was carrying the address, and produce an invoice that
 * says less than it did before they touched the form.
 */
export function hasInvoiceIdentity(shop: IdentityShop): boolean {
  return clean(shop.invoiceLegalName) !== null;
}

export function invoiceIdentity(
  shop: IdentityShop,
  locale = "en",
): InvoiceIdentity {
  const trading = shop.name.trim();
  const legal = clean(shop.invoiceLegalName);

  const taxId = clean(shop.taxId);
  const email = clean(shop.contactEmail);

  if (!legal) {
    /*
     * The pre-existing header, unchanged.
     *
     * `location` is free text a seller wrote for the storefront caption, so it
     * is passed through as one line rather than parsed — there is no shape to
     * rely on, and guessing which comma separates a city from a country is how
     * a Portuguese address becomes a Brazilian one.
     */
    const location = clean(shop.location);
    return {
      name: trading,
      tradingAs: null,
      addressLines: location ? [location] : [],
      email,
      taxId,
      registrationNumber: clean(shop.invoiceRegistrationNumber),
    };
  }

  const country = normalizeCountry(shop.invoiceCountry);

  /*
   * City, region and postcode share a line, the way every postal format in the
   * world actually prints them, while street lines and the country get their
   * own. Ordering within that line is left alone: "London SW1A 1AA" and
   * "Lisboa 1000-001" both come out right from city-then-postcode, and the
   * places where postcode leads are not worth a per-country layout table on an
   * invoice header nobody posts anything to.
   */
  const cityLine = [clean(shop.invoiceCity), clean(shop.invoiceRegion), clean(shop.invoicePostalCode)]
    .filter(Boolean)
    .join(" ");

  const addressLines = [
    clean(shop.invoiceAddressLine1),
    clean(shop.invoiceAddressLine2),
    cityLine || null,
    country ? countryName(country, locale) : clean(shop.invoiceCountry),
  ].filter((line): line is string => Boolean(line));

  return {
    name: legal,
    // Only when they genuinely differ — a seller who typed their trading name
    // into the legal field should not be handed "Ada's Ceramics, trading as
    // Ada's Ceramics".
    tradingAs: legal.toLowerCase() === trading.toLowerCase() ? null : trading,
    addressLines,
    email,
    taxId,
    registrationNumber: clean(shop.invoiceRegistrationNumber),
  };
}
