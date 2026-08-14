/**
 * The one way a title becomes a URL.
 *
 * Out of `apps/web/src/lib/utils.ts` and into here for the reason `formatMoney`
 * left before it: a slug is chosen by the server, never by the client, and the
 * server is now two of them. A product saved from the phone and the same
 * product saved from the admin form have to arrive at the same address, and a
 * second copy of these seven replacements is a pair of URLs that agree until
 * somebody adds an accent to a title.
 *
 * `utils.ts` re-exports it, so every web call site is untouched.
 */

/** URL-safe slug. Falls back to a short random suffix if input has no word chars. */
export function slugify(input: string) {
  const base = input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `item-${Math.random().toString(36).slice(2, 8)}`;
}
