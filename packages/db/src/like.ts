/**
 * A contains-match pattern for ILIKE, with the input's own wildcards escaped.
 *
 * `%` and `_` are match syntax inside ILIKE, not text — a buyer named "100%"
 * must be findable by typing exactly that, so the input's wildcards are
 * escaped before ours go on. Injection-adjacent code that had grown three
 * copies (one trimming, two not) before it lived here once. The trim is
 * kept: a trailing space in a search box should not defeat the match.
 */
export function likePattern(term: string): string {
  return `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
