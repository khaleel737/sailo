/**
 * Writing new keys into a locale file without rewriting the file.
 *
 * The obvious implementation — import the module, merge, re-emit — is wrong here
 * for two reasons that both cost more than it saves. It reformats every line, so
 * a two-key change arrives as a 500-line diff that nobody can review and that
 * conflicts with every other agent working in this tree (rule 4). And it drops
 * whatever a human put in the file: there is exactly one comment in the 34
 * translated admin files today, and losing it to a tool is how a codebase learns
 * that its translators' notes do not survive.
 *
 * So this is text surgery. It inserts, it never rewrites, and it refuses rather
 * than guesses.
 *
 * ## What it assumes, and how it checks
 *
 * A locale file is `export const <name>: <Type> = { … };` holding sections of
 * string literals, exactly two levels deep — verified against every one of the
 * 68 files in this package. Rather than trust that, each insertion is located by
 * matching the section header and counting braces from it, and the result is
 * handed back for the caller to parse before it is written. A splice that
 * produced something unparseable is a bug that must fail loudly at the tool, not
 * a broken file discovered by a failing build somewhere else.
 */

export type Insertion = {
  /** `section.key`. */
  path: string;
  /** The translated text, unescaped. */
  text: string;
};

export type SpliceResult = {
  source: string;
  /** Sections that already existed and gained keys. */
  extended: string[];
  /** Sections that did not exist and were appended whole. */
  created: string[];
};

/**
 * Insert translations into a locale file's text.
 *
 * Keys destined for a section that already exists go in just before that
 * section's closing brace, in the order given. A section that does not exist yet
 * is appended before the object's own closing brace.
 *
 * Throws if a key already exists. Overwriting a translation is a different
 * operation with different consequences — somebody may have corrected it by hand
 * — and a filler that silently replaced human work would undo exactly the
 * reviews this pipeline depends on.
 */
export function splice(source: string, insertions: readonly Insertion[]): SpliceResult {
  if (insertions.length === 0) return { source, extended: [], created: [] };

  const bySection = new Map<string, Insertion[]>();
  for (const insertion of insertions) {
    const [section, ...rest] = insertion.path.split(".");
    if (!section || rest.length !== 1 || !rest[0]) {
      throw new Error(
        `splice: "${insertion.path}" is not a two-level path. Every leaf in ` +
          `these dictionaries is exactly section.key.`,
      );
    }
    const list = bySection.get(section) ?? [];
    list.push({ ...insertion, path: rest[0] });
    bySection.set(section, list);
  }

  let text = source;
  const extended: string[] = [];
  const created: string[] = [];

  for (const [section, keys] of bySection) {
    const span = sectionSpan(text, section);
    if (span) {
      for (const { path: key } of keys) {
        if (hasKey(text.slice(span.bodyStart, span.bodyEnd), key)) {
          throw new Error(
            `splice: "${section}.${key}" is already in this file. This tool ` +
              `only ever adds — correcting a translation is a human's edit, and ` +
              `overwriting one silently is how a review gets undone.`,
          );
        }
      }
      const block = keys.map(({ path: key, text: value }) => line(key, value, 4)).join("\n");
      text = `${text.slice(0, span.bodyEnd)}${block}\n${text.slice(span.bodyEnd)}`;
      extended.push(section);
    } else {
      const body = keys.map(({ path: key, text: value }) => line(key, value, 4)).join("\n");
      const close = objectClose(text);
      text = `${text.slice(0, close)}  ${section}: {\n${body}\n  },\n${text.slice(close)}`;
      created.push(section);
    }
  }

  return { source: text, extended, created };
}

/**
 * Where a section's body starts and ends, by counting braces from its header.
 *
 * Counting rather than matching a closing `},` at a known indent: the files are
 * hand-maintained and two of them put several keys on one line, so indentation
 * is not a structure this can rely on. String literals are skipped so a brace
 * inside translated copy — `"{count} left"` appears in several locales — cannot
 * end a section early.
 */
function sectionSpan(
  source: string,
  section: string,
): { bodyStart: number; bodyEnd: number } | null {
  const header = new RegExp(`(^|[\\s{,])${escapeRegExp(section)}\\s*:\\s*\\{`, "m");
  const match = header.exec(source);
  if (!match) return null;

  const open = source.indexOf("{", match.index + match[0].length - 1);
  if (open < 0) return null;

  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        /*
         * Just past the last newline before the brace, so an inserted line lands
         * on its own line rather than sharing one with `},`.
         */
        const lineStart = source.lastIndexOf("\n", i) + 1;
        return { bodyStart: open + 1, bodyEnd: lineStart };
      }
    }
  }
  throw new Error(`splice: section "${section}" is never closed.`);
}

/** Where the exported object's own closing brace begins. */
function objectClose(source: string): number {
  const match = /\n\};?\s*$/.exec(source);
  if (!match) {
    throw new Error(
      "splice: this file does not end in `};` — it is not the shape this tool " +
        "knows how to edit, and guessing at it would corrupt a dictionary.",
    );
  }
  return match.index + 1;
}

/**
 * Whether a section body already declares this key.
 *
 * Tested against the body with its string literals blanked out. Copy really does
 * contain things like `"Erneut versuchen — home: siehe unten"`, and reading that
 * as a declaration would refuse a legitimate insertion for good — the one
 * failure mode of this check that no amount of retrying gets past.
 */
function hasKey(body: string, key: string): boolean {
  return new RegExp(`(^|[\\s{,])${escapeRegExp(key)}\\s*:`, "m").test(blankStrings(body));
}

/**
 * Replace the contents of every string literal with spaces, keeping length and
 * newlines so any position computed against the result still lines up.
 */
function blankStrings(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === "\\") {
        out += "  ";
        i++;
        continue;
      }
      if (ch === quote) {
        quote = null;
        out += ch;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}

/**
 * One `key: "value",` line.
 *
 * Only the three characters that can break a double-quoted TypeScript string are
 * escaped — backslash, the quote itself, and a literal newline. Deliberately not
 * a general JSON encoder: `JSON.stringify` also escapes every non-ASCII
 * character, which would turn 34 of these files into `الم…` and
 * make them unreadable to the very people who have to review them.
 */
function line(key: string, value: string, indent: number): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  return `${" ".repeat(indent)}${identifier(key)}: "${escaped}",`;
}

/** Quote a key only when it is not a plain identifier, matching the files' style. */
function identifier(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
