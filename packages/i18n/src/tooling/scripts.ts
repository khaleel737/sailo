/**
 * Catching a translation that strayed into the wrong alphabet.
 *
 * Every other check in this package asks whether a string is *there*. This one
 * asks whether it is in the right language, which no key-diff can see: a
 * Japanese value reading `購入者のアクセス開始от数えます` has every key present, the
 * right placeholders, a plausible length, and two Cyrillic characters in the
 * middle of a sentence that no Japanese reader will parse.
 *
 * That is not a hypothetical. It happened while filling the `content` section
 * and survived a read-through, because a fragment in a script you are not
 * reading closely looks like a character you do not recognise rather than like
 * a mistake.
 *
 * ## What it can and cannot decide
 *
 * It checks for characters from a script the locale has no business using —
 * Cyrillic in a Latin-script language, CJK in an Arabic one. It deliberately
 * does **not** flag Latin characters anywhere: every language borrows them for
 * brand names, `Markdown`, `https`, `YouTube`, `CSV`, and product nouns Sailo
 * does not translate. A check that failed on those would be turned off within
 * a week, which is worse than a narrower check that stays on.
 */

/** The scripts a locale's own prose is written in. */
const SCRIPTS = {
  cyrillic: /[Ѐ-ӿ]/,
  greek: /[Ͱ-Ͽ]/,
  arabic: /[؀-ۿ]/,
  hebrew: /[֐-׿]/,
  thai: /[฀-๿]/,
  han: /[一-鿿]/,
  kana: /[぀-ヿ]/,
  hangul: /[가-힯]/,
} as const;

type Script = keyof typeof SCRIPTS;

/**
 * Which non-Latin script each locale legitimately contains.
 *
 * A locale absent from this map is Latin-script, and any of the scripts above
 * appearing in it is a mistake. Latin itself is never checked — see the note.
 */
const EXPECTED: Readonly<Record<string, Script>> = {
  ar: "arabic",
  bg: "cyrillic",
  el: "greek",
  ja: "kana",
  ko: "hangul",
  mk: "cyrillic",
  ru: "cyrillic",
  sr: "cyrillic",
  th: "thai",
  uk: "cyrillic",
  zh: "han",
};

export type ScriptProblem = {
  key: string;
  /** The script that should not be there. */
  found: Script;
  /** The offending characters, deduplicated, for the message. */
  characters: string;
};

/**
 * Values in `dictionary` whose characters belong to a script this locale does
 * not use.
 *
 * Japanese is the one that needs care: it legitimately mixes kana and han, so
 * `ja` and `zh` do not flag each other. Everything else is a clean split.
 */
export function foreignScripts(
  locale: string,
  dictionary: Record<string, string>,
): ScriptProblem[] {
  const expected = EXPECTED[locale];
  const allowed = new Set<Script>(expected ? [expected] : []);
  // Japanese prose is kana *and* han, and a Chinese loan word is not an error.
  if (expected === "kana") allowed.add("han");
  if (expected === "han") allowed.add("kana");

  const out: ScriptProblem[] = [];
  for (const [key, value] of Object.entries(dictionary)) {
    for (const [name, pattern] of Object.entries(SCRIPTS) as [Script, RegExp][]) {
      if (allowed.has(name)) continue;
      const hits = [...value].filter((ch) => pattern.test(ch));
      if (hits.length > 0) {
        out.push({ key, found: name, characters: [...new Set(hits)].join("") });
      }
    }
  }
  return out;
}
