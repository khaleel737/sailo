/**
 * A phone number as every surface here has to store and spell it.
 *
 * One function, in `@sailo/core` rather than in an app, because the string it
 * produces is a *stored value* and a *URL path segment* at the same time:
 * `clients.phone` holds it, the CSV importer writes it, the public API writes
 * it, and `@sailo/payments/offline` builds `wa.me/<number>` out of it.
 *
 * Two normalisations that disagreed would mean the same buyer stored twice —
 * once as `+1 (555) 123-4567` and once as `15551234567` — and a WhatsApp link
 * that opens a chat with nobody.
 */

/** Strips everything but digits — `wa.me` wants a bare E.164 number. */
export function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}
