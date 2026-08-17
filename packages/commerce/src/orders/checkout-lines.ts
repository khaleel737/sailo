/**
 * How a basket describes itself to Stripe.
 *
 * The Checkout Session used to carry `product_data: { name }` and nothing
 * else, so the page the buyer pays on was a column of bare titles and prices —
 * no picture, no description, and nothing to say whether "Studio session" was
 * a file, an appointment on Thursday, or a door they had to turn up at. It is
 * the last screen before the money moves and it looked like the least
 * considered one in the product.
 *
 * Everything needed was already at the call site and simply never travelled:
 * `ResolvedLine` carries the whole product row, and `imageUrl` now resolves to
 * the product's cover rather than only a variant's photo.
 *
 * Pure on purpose. No database, no Stripe client, no `Intl` construction — the
 * labels and the date formatter arrive as arguments, so the whole matrix of
 * kinds can be exercised in a unit test without a network or a clock, and so
 * this module has no opinion about which language the seller writes in.
 */
import { normalizeCountry } from "@sailo/core/countries";

/**
 * The handful of strings this needs from the shop's dictionary.
 *
 * A bag rather than a `t` function so the module stays independent of the
 * dictionary's shape, and so a test can pass five plain strings.
 */
export type CheckoutLineLabels = {
  /** `shop.kindDigital` — "Instant download". */
  digital: string;
  /** `shop.kindEvent` — "Event ticket". */
  event: string;
  /** `checkout.online` — "Online". */
  online: string;
  /** `checkout.inPerson` — "In person". */
  inPerson: string;
  /** `checkout.duration` interpolated — "Takes 45 minutes". */
  duration: (minutes: number) => string;
  /** Localised and in the *shop's* time zone. See `formatWhen` in the caller. */
  dateTime: (value: Date) => string;
};

/**
 * The order's delivery address, in the shape Stripe takes — or nothing, for an
 * order that isn't going anywhere.
 *
 * `addressLine1` is the test rather than the product kinds, and it is a better
 * one than it looks: Sailo asks for an address only when the basket needs
 * delivering (`Quote.needsAddress`), so a row that has one is by construction
 * an order with something to ship. A cart of downloads never reaches this, and
 * neither does a collection order, because neither was ever asked.
 *
 * Stripe requires `name` and `address.line1` together and rejects a `shipping`
 * object missing either, so both are checked before anything is built —
 * failing a sale over an incomplete address would be the worst possible trade
 * for a field that is only ever read after the money has arrived.
 *
 * Takes the columns rather than an `Order`, so it stays out of `server-only`
 * and can be exercised without a database.
 */
export function checkoutShipping(order: {
  customerName: string | null;
  customerPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}): CheckoutShipping | null {
  const line1 = order.addressLine1?.trim();
  const name = order.customerName?.trim();
  if (!line1 || !name) return null;

  /*
   * Stripe wants ISO 3166-1 alpha-2. Older orders stored whatever the buyer
   * typed into a free-text box, and "Hrvatska" is not a country code —
   * `normalizeCountry` returns null for those rather than having Stripe reject
   * the whole session over one legacy row.
   */
  const country = normalizeCountry(order.country);

  return {
    name,
    ...(order.customerPhone ? { phone: order.customerPhone } : {}),
    address: {
      line1,
      ...(order.addressLine2 ? { line2: order.addressLine2 } : {}),
      ...(order.city ? { city: order.city } : {}),
      ...(order.region ? { state: order.region } : {}),
      ...(order.postalCode ? { postal_code: order.postalCode } : {}),
      ...(country ? { country } : {}),
    },
  };
}

/**
 * Checkout's own shipping shape, restated rather than imported.
 *
 * `Stripe.Checkout.SessionCreateParams.PaymentIntentData.Shipping` and
 * `Stripe.PaymentIntentCreateParams.Shipping` look identical and are not — the
 * first requires `address.line1` and the second doesn't, which is exactly the
 * field the guard above is about. Naming the shape here keeps this module free
 * of the Stripe types while still failing a build that drops `line1`.
 */
export type CheckoutShipping = {
  name: string;
  phone?: string;
  address: {
    line1: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
};

/**
 * Just the corner of the shop dictionary this needs.
 *
 * Structural rather than the dictionary's own type, so adding a key three
 * screens away can't ripple into a test of this file, and so a test can build
 * one by hand in four lines.
 */
export type CheckoutDictionary = {
  shop: { kindDigital: string; kindEvent: string };
  checkout: { online: string; inPerson: string; duration: string };
};

/**
 * Binds the dictionary and the shop's clock into the six strings the builder
 * asks for.
 *
 * The time zone is the *shop's*, not the buyer's, and that is the only correct
 * answer: "Thu 3 Mar, 14:00" on a booking means the hour the seller will be
 * standing there. Rendering it in the buyer's zone would show a Spanish
 * customer 15:00 for an appointment in London and be wrong by exactly the
 * amount that makes someone miss it.
 *
 * The *language* is the shop's for a different reason — it is the language the
 * storefront the buyer just left was written in. Stripe's own chrome around
 * these strings follows the buyer's browser, which is Checkout's `locale:
 * "auto"` default and is deliberately left alone.
 */
export function checkoutLabels(
  dictionary: CheckoutDictionary,
  locale: string,
  timeZone: string,
): CheckoutLineLabels {
  // One formatter for the whole basket. Constructing `Intl.DateTimeFormat` is
  // expensive and a ten-line cart would otherwise build ten identical ones.
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });

  return {
    digital: dictionary.shop.kindDigital,
    event: dictionary.shop.kindEvent,
    online: dictionary.checkout.online,
    inPerson: dictionary.checkout.inPerson,
    duration: (minutes) =>
      dictionary.checkout.duration.replace("{duration}", humanMinutes(minutes, locale)),
    dateTime: (value) => when.format(value),
  };
}

/**
 * "90" → "1 hr 30 min", in the reader's language where the runtime can manage
 * it. `Intl.NumberFormat` with a unit style is the only built-in that
 * translates "minutes", and it does not do compound durations — so an hour and
 * a half is formatted as its two parts rather than invented as a string.
 */
function humanMinutes(minutes: number, locale: string): string {
  const unit = (value: number, which: "hour" | "minute") => {
    try {
      return new Intl.NumberFormat(locale, {
        style: "unit",
        unit: which,
        unitDisplay: "short",
      }).format(value);
    } catch {
      // A runtime without the unit style, or a locale it dislikes. The number
      // alone is still readable beside "Takes".
      return String(value);
    }
  };

  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? unit(hours, "hour") : `${unit(hours, "hour")} ${unit(rest, "minute")}`;
}

/** Everything about one line that could reasonably reach a checkout page. */
export type CheckoutLineSource = {
  title: string;
  variantLabel: string | null;
  kind: string;
  sku: string | null;
  imageUrl: string | null;
  /** The seller's own copy for the product. Already in their language. */
  description?: string | null;
  durationMinutes?: number | null;
  serviceMode?: string | null;
  serviceLocation?: string | null;
  /** When the buyer booked, for a service. */
  scheduledFor?: Date | null;
  /** When the doors open, for an event. */
  eventStartsAt?: Date | null;
};

/** What `createCheckoutSession` puts in `price_data.product_data`. */
export type CheckoutLine = {
  name: string;
  description?: string;
  images?: string[];
  unitPriceCents: number;
  quantity: number;
};

/**
 * Stripe's ceiling for a line's description is generous, but a checkout page
 * is not a place to read a paragraph. Long enough for a sentence and the
 * details beside it; short enough that the line stays one line.
 */
const MAX_DESCRIPTION = 300;

/** " · " reads as a separator at a glance and survives every script we ship in. */
const SEPARATOR = " · ";

/**
 * Only an absolute HTTPS URL is worth sending.
 *
 * Stripe fetches these from its own servers, so anything relative resolves
 * against nothing and anything local resolves to a machine Stripe cannot see.
 * A rejected image would fail the whole session — and failing a sale over a
 * thumbnail is not a trade worth making — so a URL that isn't obviously
 * fetchable is dropped rather than sent hopefully.
 */
function usableImage(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return trimmed.startsWith("https://") ? trimmed : null;
}

/** "Speckled mug — Large", the way a receipt should name a line. */
export function checkoutLineName(line: Pick<CheckoutLineSource, "title" | "variantLabel">) {
  return line.variantLabel ? `${line.title} — ${line.variantLabel}` : line.title;
}

/**
 * What this line *is*, in the order a buyer wants to know it.
 *
 * The kind comes first and the seller's own copy last, because the buyer has
 * already read the product page — what they are checking on this screen is
 * that they bought the right thing, and "Thu 3 Mar, 14:00" answers that faster
 * than a paragraph about the studio does.
 *
 * A physical product gets no kind badge. It is the default, "Ships to you"
 * beside a mug tells nobody anything, and a line with only a badge for a
 * description is worse than a line with none.
 */
export function checkoutLineDescription(
  line: CheckoutLineSource,
  labels: CheckoutLineLabels,
): string | undefined {
  const parts: string[] = [];

  switch (line.kind) {
    case "digital":
      parts.push(labels.digital);
      break;

    case "service": {
      if (line.durationMinutes && line.durationMinutes > 0) {
        parts.push(labels.duration(line.durationMinutes));
      }
      parts.push(line.serviceMode === "online" ? labels.online : labels.inPerson);
      // The address matters for a doorstep and is noise for a video call —
      // the join link is emailed after payment, never printed here, because
      // this string reaches Stripe before anybody has paid for it.
      if (line.serviceMode !== "online" && line.serviceLocation) {
        parts.push(line.serviceLocation);
      }
      if (line.scheduledFor) parts.push(labels.dateTime(line.scheduledFor));
      break;
    }

    case "event": {
      parts.push(labels.event);
      if (line.eventStartsAt) parts.push(labels.dateTime(line.eventStartsAt));
      // Same rule as a service: the venue is useful, the join URL is the good
      // itself and is held until the order is released.
      if (line.serviceMode !== "online" && line.serviceLocation) {
        parts.push(line.serviceLocation);
      } else if (line.serviceMode === "online") {
        parts.push(labels.online);
      }
      break;
    }

    default:
      break;
  }

  // The SKU earns its place only when nothing else has identified the line:
  // for a variant the name already says "— Large", and a code after that is
  // clutter on the one screen that should be legible at a glance.
  if (parts.length === 0 && !line.variantLabel && line.sku) parts.push(line.sku);

  const own = line.description?.trim();
  if (own) parts.push(own);

  if (parts.length === 0) return undefined;

  const joined = parts.join(SEPARATOR);
  return joined.length > MAX_DESCRIPTION
    ? `${joined.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`
    : joined;
}

/**
 * One priced line, as Stripe should render it.
 *
 * `images` is an array because Stripe takes up to eight; Sailo sends at most
 * one, since Checkout shows a single thumbnail per line and the other seven
 * would be bytes nobody sees.
 */
export function toCheckoutLine(
  line: CheckoutLineSource & { unitPriceCents: number; quantity: number },
  labels: CheckoutLineLabels,
): CheckoutLine {
  const description = checkoutLineDescription(line, labels);
  const image = usableImage(line.imageUrl);

  return {
    name: checkoutLineName(line),
    ...(description ? { description } : {}),
    ...(image ? { images: [image] } : {}),
    unitPriceCents: line.unitPriceCents,
    quantity: line.quantity,
  };
}
