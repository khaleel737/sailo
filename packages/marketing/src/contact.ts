/**
 * An address and a name, folded into the shape everything downstream expects.
 *
 * Client-safe on purpose, and that is the whole reason this file exists. It
 * was inside `broadcasts/subscribe.ts`, which carries `server-only` because it
 * writes rows — so the moment a second signup form wanted to tell somebody
 * their address was malformed *before* a round trip, the only options were to
 * copy the rules or to drag a database module into the browser bundle. Copied
 * validation is validation that diverges, and it diverges silently: the form
 * accepts what the server rejects, and the visitor is told nothing useful.
 *
 * Both signup surfaces — a shop's list and Sailo's own — now read the same
 * two functions, on both sides of the wire.
 */

/**
 * Deliberately not the RFC's grammar.
 *
 * A pattern that accepts every legal address accepts a great many that no mail
 * server will ever deliver to, and the cost of rejecting an exotic-but-real
 * address here is one person typing it again; the cost of accepting junk is a
 * hard bounce charged against a sending domain every seller shares. One `@`,
 * something on each side, a dot in the host, no whitespace.
 */
const EMAIL_RE =
  /^[^\s@,;:<>"'()[\]\\]{1,64}@[^\s@.,;:<>"'()[\]\\]+(\.[^\s@.,;:<>"'()[\]\\]+)+$/;

/** The longest address SMTP itself permits. */
export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 60;

/** The address, folded — or null if it is not one. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value.length < 3 || value.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_RE.test(value) ? value : null;
}

/** What they typed in the name box, if anything usable. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return value || null;
}
