/**
 * What must never leave the process, dropped before it can.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * `./web` and `./native` each held a byte-identical copy, and `./web`'s header
 * stated the requirement out loud: *"the scrubbing below is the same policy as
 * `./native`, deliberately: two reporters that disagree about what counts as
 * personal data means the stricter one is decorative."*
 *
 * Two copies cannot be relied on to agree. Whichever one a future reviewer adds
 * a key to is the only one that gets it, and the failure is silent in exactly
 * the direction that matters — a field scrubbed on the phone and shipped from
 * the server reads, from the Sentry side, as if the policy were being followed.
 *
 * So the policy is one module and both reporters import it. It is pure and has
 * no vendor in it, which is also what lets it be bundled into the phone.
 */

/**
 * Anything that identifies a person.
 *
 * Sailo's error context carries a `scope` and sometimes an opaque id, and those
 * are fine — an id correlates two reports without naming anybody. What must
 * never be sent is what a seller or their buyer typed: an email, a handle, an
 * order's contents. Sentry's own `sendDefaultPii` is off and stays off; this is
 * the second line, for the fields Sailo attaches itself.
 */
export const PII_KEYS = /email|phone|address|name|handle|token|secret|password|card/i;

/** The longest a single value may be. */
const MAX_VALUE = 200;

export function scrub(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (PII_KEYS.test(key)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      /*
       * Truncated: a long string here is either a payload or a message, and
       * both are ways for content to escape one character at a time.
       *
       * Objects and arrays are dropped entirely rather than walked. A nested
       * shape is where an order, a cart or a customer record arrives, and a
       * recursive scrub that misses one level is worse than no nesting at all.
       */
      out[key] = typeof value === "string" ? value.slice(0, MAX_VALUE) : value;
    }
  }
  return out;
}
