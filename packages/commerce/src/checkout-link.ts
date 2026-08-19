/**
 * The checkout link vocabulary — spec 42.
 *
 * A small, closed, documented set of query parameters a seller can put in a
 * link. Pure and client-safe: the storefront reads it in the browser and the
 * docs page renders the same table from the same constant, so what is
 * documented is what is parsed.
 *
 * TWO REFUSALS, AND THEY ARE THE FEATURE
 *
 * **There is no `?price=`.** Theirs has a custom-price link. A price in a URL
 * is a price from the browser, and *the server re-prices everything* is the
 * invariant the whole checkout rests on — one parameter that set an amount
 * would make every other guard in the pricing path decorative. Pay-what-you-
 * want is the supported way to let a buyer choose, and it has a server-side
 * floor.
 *
 * **`?coupon=` prefills; it never applies.** Auto-applying from a URL makes
 * every coupon guess free and turns the storefront into a discount oracle —
 * and the enumeration finding is the reason coupon submission carries a
 * ten-per-five-minutes ceiling in the first place. A prefilled code still
 * charges that ceiling when the buyer submits it, which is exactly the
 * behaviour a guess should get.
 *
 * Everything else here is a display value or a narrowing. Nothing widens: a
 * quantity above what the seller allows clamps, and **says so** — rule 8, no
 * silent caps.
 */

/** Every parameter this vocabulary knows. Unknown ones are ignored silently. */
export const CHECKOUT_PARAMS = [
  "variant",
  "coupon",
  "qty",
  "ref",
  "name",
  "email",
] as const;
export type CheckoutParam = (typeof CHECKOUT_PARAMS)[number];

/** Longest prefill this will carry through. A URL is not a form. */
const MAX_PREFILL = 120;

export type CheckoutLink = {
  /** A variant id to preselect, if it is shaped like one. */
  variantId: string | null;
  /**
   * A code to **put in the box**. Never applied, never looked up.
   *
   * Uppercased because that is how codes are stored, so the box reads back
   * what the seller wrote in their link.
   */
  couponPrefill: string | null;
  /** A quantity, already clamped. Null when none was asked for. */
  qty: number | null;
  /** True when the asked-for quantity was reduced. The UI must say so. */
  qtyClamped: boolean;
  /** An affiliate code, for the attribution path that already exists. */
  ref: string | null;
  /**
   * Prefills, and **untrusted display values**.
   *
   * Escaped by whatever renders them, never treated as consent, and never used
   * to look a client up — a URL that could name an existing buyer would be an
   * oracle for whether an address has shopped here.
   */
  name: string | null;
  email: string | null;
};

/** A uuid, loosely — enough to refuse anything that is not an id. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a coupon code may be. The same shape the coupon form accepts. */
const CODE = /^[A-Z0-9_-]{2,32}$/;

/** What an affiliate code may be. */
const REF = /^[A-Za-z0-9_-]{2,40}$/;

export type ClampLimits = {
  /** The seller's own per-order cap, when they set one. */
  maxPerOrder?: number | null;
  /** What is actually on the shelf, when the product is tracked. */
  stock?: number | null;
};

/**
 * Reads a link's parameters into what the checkout may safely use.
 *
 * Total: every failure is a null rather than a throw, because this runs on a
 * storefront render and a malformed link a seller pasted into Instagram must
 * open the shop rather than an error page.
 */
export function readCheckoutLink(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  limits: ClampLimits = {},
): CheckoutLink {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    const value = params[key];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };

  const variant = (get("variant") ?? "").trim();
  const coupon = (get("coupon") ?? "").trim().toUpperCase();
  const ref = (get("ref") ?? "").trim();

  const { qty, clamped } = readQty(get("qty"), limits);

  return {
    variantId: UUID.test(variant) ? variant : null,
    couponPrefill: CODE.test(coupon) ? coupon : null,
    qty,
    qtyClamped: clamped,
    ref: REF.test(ref) ? ref : null,
    name: prefill(get("name")),
    email: prefill(get("email")),
  };
}

/**
 * A quantity, clamped to what the seller allows and what is in stock.
 *
 * **It only ever narrows.** A link asking for twelve when the seller caps at
 * three gets three, and `clamped` is what makes the UI say so — a quantity
 * silently reduced is the seller's campaign quietly selling a different thing
 * from the one the link promised.
 *
 * Zero and negative are not a quantity, and they are not clamped to one
 * either: they are simply no instruction, and the page uses its own default.
 */
function readQty(
  raw: string | null,
  limits: ClampLimits,
): { qty: number | null; clamped: boolean } {
  if (!raw) return { qty: null, clamped: false };

  // Digits only. `1e3`, `0x10` and ` 3 ` are all `Number`-parseable and none
  // of them is something a seller typed into a link.
  if (!/^\d{1,4}$/.test(raw.trim())) return { qty: null, clamped: false };

  const asked = Number(raw.trim());
  if (asked < 1) return { qty: null, clamped: false };

  const ceilings = [
    limits.maxPerOrder && limits.maxPerOrder > 0 ? limits.maxPerOrder : null,
    // `0` is a real ceiling — sold out — and must not be read as "no limit".
    typeof limits.stock === "number" ? limits.stock : null,
  ].filter((n): n is number => n !== null);

  const ceiling = ceilings.length > 0 ? Math.min(...ceilings) : asked;
  const qty = Math.max(0, Math.min(asked, ceiling));

  return { qty: qty > 0 ? qty : null, clamped: qty < asked };
}

/**
 * A prefill: trimmed, bounded, and stripped of anything that is not text.
 *
 * Control characters and newlines go, because the value lands in an input's
 * `defaultValue` and a newline in a single-line field is how a paste becomes
 * two fields. Nothing is escaped here — that is the renderer's job, and
 * double-escaping shows a buyer `&amp;` in their own name.
 */
function prefill(raw: string | null): string | null {
  if (!raw) return null;

  /*
   * Control characters go by code point rather than by a literal range in a
   * regex. A `\x00-\x1f` class is correct and is also the kind of thing an
   * editor, a copy-paste or a codemod silently turns into real control
   * characters — at which point the guard still compiles and stops working.
   */
  let value = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    value += code < 0x20 || code === 0x7f ? " " : ch;
  }

  return value.replace(/\s+/g, " ").trim().slice(0, MAX_PREFILL) || null;
}

/**
 * Builds a link, for the seller's "copy link" control.
 *
 * The same vocabulary in the other direction, so the thing a seller copies is
 * a thing `readCheckoutLink` can read — and so there is exactly one place that
 * knows what a checkout link looks like.
 */
export function buildCheckoutLink(
  base: string,
  fields: Partial<Record<CheckoutParam, string | number | null | undefined>>,
): string {
  const url = new URL(base);
  for (const key of CHECKOUT_PARAMS) {
    const value = fields[key];
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}
