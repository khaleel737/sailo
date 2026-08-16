/**
 * The seller's own labels on a customer: `vip`, `wholesale`, `march-workshop`.
 *
 * Pure, and the only thing allowed to decide what a tag is. Free text typed
 * into a form reaches a `text[]` column that a broadcast's audience is
 * selected from, so "VIP", "vip" and " vip " being three different audiences
 * is not a cosmetic problem — it is a seller mailing a third of the people
 * they meant to. Everything is folded here, on the way in, once.
 *
 * Deliberately not a table of tags with rows and joins. A tag has no
 * properties, nothing points at one, and nobody renames them in bulk; an
 * array with a GIN index answers "who carries this" in one index scan and
 * costs no migration when a seller invents a new word.
 */

/** Long enough for a phrase, short enough to render in a row. */
export const MAX_TAG_LENGTH = 32;

/**
 * A ceiling per client, so a paste accident cannot make one row expensive for
 * every query that reads it. Twenty is well past what anyone uses on purpose.
 */
export const MAX_TAGS = 20;

/**
 * One tag, folded — or null if there is nothing left of it.
 *
 * Lowercased because a filter is an equality test and a seller who typed
 * "VIP" in January and "vip" in March meant one audience. Inner whitespace
 * collapses to single hyphens so `march workshop` and `march  workshop` are
 * the same tag; commas and semicolons are stripped because both are used as
 * separators by the CSV export and would round-trip as two tags.
 */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const folded = raw
    .normalize("NFC")
    .toLowerCase()
    // Anything that is a separator somewhere: the CSV writer joins on `;`,
    // the tag input splits on `,`, and a newline would break both.
    .replace(/[,;\r\n\t]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    // Leading and trailing hyphens are what is left of stripped punctuation,
    // and `-vip` sorting before every other tag is nobody's intent.
    .replace(/^-+|-+$/g, "");

  if (!folded) return null;
  /*
   * Sliced rather than refused. A seller pasting a long phrase gets a tag
   * they can see and edit; an error message on the thirty-third character of
   * something they were not thinking hard about is friction with no upside.
   * The trailing-hyphen trim runs again because the cut can land on one.
   */
  const cut = folded.slice(0, MAX_TAG_LENGTH).replace(/-+$/g, "");
  return cut || null;
}

/**
 * A whole tag list, folded, deduplicated and capped.
 *
 * Accepts what each caller actually holds: an array from a form, or the
 * comma- or semicolon-separated string a CSV cell and a text input both
 * produce. Order is the seller's, not sorted — the first thing they typed
 * stays first, which is what makes a list feel edited rather than rearranged.
 *
 * `truncated` is returned rather than swallowed. A cap that silently drops
 * the twenty-first tag is a cap that lies, and the action tells the seller.
 */
export function normalizeTags(input: unknown): {
  tags: string[];
  truncated: boolean;
} {
  const parts: unknown[] = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,;\n]/)
      : [];

  const seen = new Set<string>();
  for (const part of parts) {
    const tag = normalizeTag(part);
    if (tag) seen.add(tag);
  }

  const all = [...seen];
  return { tags: all.slice(0, MAX_TAGS), truncated: all.length > MAX_TAGS };
}

/** How the CSV export writes a tag list, and how the importer reads one back. */
export const TAG_SEPARATOR = ";";

export function tagsToCsv(tags: string[]): string {
  return tags.join(TAG_SEPARATOR);
}

/**
 * Every tag a set of clients carries, deduplicated, for an autocomplete.
 *
 * Computed from rows already read rather than by a second `select distinct
 * unnest(tags)` query. The clients list has the rows in hand, and a shop with
 * a thousand customers should not pay a second full scan to populate a
 * datalist.
 */
export function tagVocabulary(clients: { tags: string[] }[]): string[] {
  const seen = new Set<string>();
  for (const client of clients) {
    for (const tag of client.tags) seen.add(tag);
  }
  // `.sort()`: Hermes has no `toSorted`. The spread just made the array, so
  // mutating it disturbs nothing. See the note in `./countries.ts`.
  return [...seen].sort((a, b) => a.localeCompare(b));
}
