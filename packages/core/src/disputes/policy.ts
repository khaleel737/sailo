/**
 * Identifying a policy by what it says, so storing one per order is affordable.
 *
 * `orders.termsAcceptedAt` records *when* a buyer agreed. Nothing recorded
 * *what*, and `shops.termsUrl` is a URL whose contents the seller controls — so
 * an issuer following it four months later reads today's policy, not the one
 * that was on screen at checkout. A URL that changed is not evidence.
 *
 * Snapshotting the text per order would be one row per sale forever, which is
 * the cost that stops platforms doing it. Content-addressing removes that cost
 * entirely: a shop with a stable refund policy has exactly **one** row for its
 * whole life and every order points at it. Only an edit writes a second.
 *
 * ## What counts as an edit
 *
 * The hash is taken over *normalised* text, and the normalisation is the whole
 * design decision. Hashing raw bytes would write a new snapshot for a reflowed
 * paragraph, a trailing space, or a file saved on Windows — none of which change
 * what the buyer agreed to, and all of which would turn "one row per policy"
 * back into "one row per save".
 *
 * So: line endings unified, trailing whitespace on each line dropped, runs of
 * blank lines collapsed, the whole thing trimmed. What survives is every
 * *word*, in order, and any change to those produces a different hash — which
 * is exactly the set of changes that matter to somebody arguing about what was
 * agreed.
 *
 * Deliberately **not** case-folded and **not** punctuation-stripped. "You may
 * cancel within 14 days" and "You may cancel within 14 days." are different
 * promises to argue about, and a normaliser that decided otherwise would merge
 * two policies that a lawyer would not.
 *
 * And deliberately **not** collapsing runs of spaces inside a line, which would
 * deduplicate slightly better. The stored body is the text an evidence pack
 * prints, so a policy containing an address block or an aligned table would then
 * be shown to an issuer laid out differently from how the buyer saw it. An
 * occasional extra row is cheap; misrepresenting the document is not.
 */

/** Policy kinds a snapshot can be of. */
export const POLICY_KINDS = ["terms", "privacy", "refunds", "cancellation"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

export function isPolicyKind(value: unknown): value is PolicyKind {
  return typeof value === "string" && (POLICY_KINDS as readonly string[]).includes(value);
}

/** Where a snapshot's text came from. Printed beside it in the pack. */
export const POLICY_SOURCES = ["shop_page", "url_fetch", "manual", "platform"] as const;
export type PolicySource = (typeof POLICY_SOURCES)[number];

/**
 * The longest policy body worth storing.
 *
 * A guard on a fetched URL rather than on a shop page: `url_fetch` pulls
 * whatever is at an address the seller chose, and without a cap a 40 MB page
 * becomes a 40 MB row on every order that referenced it. 200 KB is far longer
 * than any real terms document and short enough to be a bounded write.
 */
export const POLICY_BODY_MAX = 200_000;

/**
 * The text of a policy, as it will be hashed and stored.
 *
 * Exported because the *stored* body must be the normalised one. Hashing one
 * string and storing another means the hash no longer identifies what is in the
 * row, and the whole scheme quietly stops deduplicating.
 */
export function normalisePolicy(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A stable identifier for a policy's text.
 *
 * SHA-256 over the normalised body, hex. Uses Web Crypto, which is present in
 * every runtime this package targets — Node, the edge, and the React Native app
 * — and keeps this module free of dependencies like the rest of `@sailo/core`.
 *
 * Async because `crypto.subtle.digest` is. Callers snapshot on a path a buyer is
 * waiting on, so this is one hash of a few kilobytes and never a fetch.
 */
export async function policyHash(body: string): Promise<string> {
  const normalised = normalisePolicy(body);
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Whether a body is worth snapshotting at all.
 *
 * An empty or near-empty policy is not evidence and storing it implies a
 * document that does not exist. A cookie banner scraped off a 404 page is the
 * realistic failure here, and a snapshot of it would be printed in an evidence
 * pack as though it were the seller's refund terms.
 */
export function isStorablePolicy(body: string): boolean {
  const normalised = normalisePolicy(body);
  return normalised.length >= 40 && normalised.length <= POLICY_BODY_MAX;
}
