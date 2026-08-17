/**
 * Dates, as this screen shows them.
 */



/* -------------------------------------------------------------------------- */
/*  Bits                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Dates arrive as ISO strings, not `Date`s — there is no transformer on this
 * tRPC client, which `lib/models.ts` documents and which a screen that called
 * `.toLocaleString()` straight on the value would discover on a device.
 *
 * Wrapped, for the same reason `@sailo/core/currency` wraps `NumberFormat`:
 * Hermes ships a narrower ICU than a browser's, and an unrecognised locale
 * throws rather than degrading. An ISO date is unambiguous everywhere; a
 * crashed screen is not.
 */
export function placedOn(value: string | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/*
 * Layout only — flex and spacing, nothing with a colour, a radius or a font
 * size in it. Every visual decision on this screen belongs to
 * `@sailo/design-system`.
 */
/** No safe-area edges — the stack header owns the top, the tab bar the bottom.
 *  `orders/index.tsx` carries the longer note. */
