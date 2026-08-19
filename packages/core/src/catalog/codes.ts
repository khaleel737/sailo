/**
 * Codes a seller hands out one of, and the one arithmetic property that keeps
 * them from being mistaken for a credential the door already accepts.
 *
 * Pure, so the product form can validate a pattern as it is typed and the
 * server can validate the same pattern with the same function. Minting itself
 * needs a CSPRNG and `crypto.getRandomValues` is available in all three
 * runtimes this package targets, so that lives here too.
 */

/**
 * Crockford's base32, shared with tickets and member passes — no I, L, O or U,
 * so a code read off a screen and typed into a licence dialog cannot be
 * mistaken for another.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The placeholder in a pattern. Everything else is literal. */
const PLACEHOLDER = "X";

export const DEFAULT_CODE_PATTERN = "SAILO-XXXX-XXXX-XXXX";

/**
 * Lengths a folded scan code already means something at.
 *
 * `admitAnyCode` tries a ticket and falls through to a member pass only on
 * `not_found`, and that fall-through is unambiguous **by arithmetic**: after
 * folding, a ticket is ten characters and a pass is twelve, so no string can
 * be a candidate for both. A third minted code type has to pick a length
 * neither folding can produce, or it reintroduces the ambiguity those two were
 * built to avoid — and it would do it silently, at a door, on somebody's
 * opening night.
 *
 * `passes.test.ts` asserts the same two numbers from the other side.
 */
export const RESERVED_FOLDED_LENGTHS = [10, 12] as const;

/**
 * The floor on how much of a pattern is random.
 *
 * A pool code is a bearer token: whoever holds the string has the good. Ten
 * base32 characters is fifty bits, which is the same budget a ticket carries
 * and against an endpoint that hands over a product rather than an admission.
 */
export const MIN_CODE_ENTROPY_CHARS = 10;

/** The reading half of the ticket fold, without the grouping. */
function fold(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/I|L/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
}

export type CodePatternProblem =
  | "empty"
  | "too_long"
  | "not_enough_random"
  /** Folds to a ticket's length or a member pass's. */
  | "collides_with_scan_codes";

export type CodePatternCheck =
  | { ok: true; pattern: string; placeholders: number; foldedLength: number }
  | { ok: false; reason: CodePatternProblem };

/** A pattern longer than this is a serial nobody will ever paste correctly. */
const MAX_PATTERN_LENGTH = 64;

/**
 * Whether a seller's pattern can be minted from, and why not when it cannot.
 *
 * Uppercased on the way through — the alphabet is uppercase, and a seller who
 * typed `sailo-xxxx` meant the same thing as one who did not.
 */
export function checkCodePattern(raw: string | null | undefined): CodePatternCheck {
  const pattern = (raw ?? "").trim().toUpperCase();
  if (!pattern) return { ok: false, reason: "empty" };
  if (pattern.length > MAX_PATTERN_LENGTH) return { ok: false, reason: "too_long" };

  const placeholders = [...pattern].filter((c) => c === PLACEHOLDER).length;
  if (placeholders < MIN_CODE_ENTROPY_CHARS) {
    return { ok: false, reason: "not_enough_random" };
  }

  /*
   * The fold is applied to the pattern rather than to a sample, and that is
   * deliberate: every character a pattern can mint is in the alphabet, and the
   * alphabet has no lookalikes left to fold — so the folded length of one
   * minted code is the folded length of all of them, and checking the pattern
   * checks every code it will ever produce.
   */
  const foldedLength = fold(pattern).length;
  if ((RESERVED_FOLDED_LENGTHS as readonly number[]).includes(foldedLength)) {
    return { ok: false, reason: "collides_with_scan_codes" };
  }

  return { ok: true, pattern, placeholders, foldedLength };
}

/**
 * One code from a pattern.
 *
 * `crypto.getRandomValues` rather than `Math.random`, and rather than
 * `randomBytes`, for the reason `randomHex` gives: the Web Crypto spelling is
 * the one a server, a browser and Hermes all have.
 *
 * The modulo is unbiased because the alphabet is exactly 32 symbols and a byte
 * is 256 values — eight whole cycles, no remainder. That is a property of the
 * two numbers rather than a lucky choice, and it is why the alphabet is not
 * something to trim.
 */
export function mintCode(pattern: string): string {
  const checked = checkCodePattern(pattern);
  const shape = checked.ok ? checked.pattern : DEFAULT_CODE_PATTERN;

  const placeholders = [...shape].filter((c) => c === PLACEHOLDER).length;
  const bytes = crypto.getRandomValues(new Uint8Array(placeholders));

  let out = "";
  let taken = 0;
  for (const ch of shape) {
    if (ch === PLACEHOLDER) {
      out += ALPHABET[(bytes[taken] as number) % 32];
      taken += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Licence keys                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Twenty characters in four groups — a hundred bits, and a folded length of
 * twenty, which is neither a ticket's ten nor a pass's twelve.
 *
 * Not a pattern the seller picks. A licence key is read by *software* through
 * a public endpoint, so its strength is not something to leave configurable:
 * the one place a seller could weaken it is the one place it matters most.
 */
export function newLicenseKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let code = "";
  for (const b of bytes) code += ALPHABET[b % 32];
  return [
    code.slice(0, 5),
    code.slice(5, 10),
    code.slice(10, 15),
    code.slice(15),
  ].join("-");
}

/**
 * The first group, which is the indexed lookup and the only form of a key that
 * is ever written to a log line.
 *
 * Five base32 characters is one in 33 million, so a prefix narrows the lookup
 * to a handful of rows and tells a log reader which key a caller meant without
 * telling them the key.
 */
export function licenseKeyPrefix(key: string): string {
  return normalizeLicenseKey(key).slice(0, 5);
}

/**
 * However a customer's software sent it: lowercase, spaces, missing dashes,
 * the four lookalikes folded back.
 *
 * Shares the fold with tickets and member passes, because the reason is the
 * same in all three places — somebody is copying characters off a screen — and
 * a second, more forgiving or less forgiving, spelling of that rule would make
 * a valid licence fail in one client and work in another.
 */
export function normalizeLicenseKey(raw: string): string {
  return fold(raw).slice(0, 40);
}
