/**
 * Which strings a locale is missing, and where they would go.
 *
 * The half of the translation pipeline that has no opinion about *how* a string
 * gets translated. It flattens a dictionary, diffs it against English, and hands
 * back paths — which is everything `check:i18n` needs and everything the filler
 * needs before it calls anybody.
 *
 * Deliberately dependency-free, like the rest of this package. `@sailo/i18n` is
 * imported by apps/api and by the React Native app, and a package with no
 * dependencies cannot land a requirement on either of them — the constraint is
 * why the model call lives in `scripts/i18n/` and not here.
 *
 * ## Why two dictionaries behave differently
 *
 * `dictionaries/*.ts` are typed as the complete `Dictionary`, so a missing key
 * is a **compile error**. There is no such thing as storefront debt: either
 * every locale has the key or the build is red. That is the constraint Decision
 * A was taken against.
 *
 * `admin/*.ts` are typed as `PartialAdminDictionary` and merged over English at
 * runtime by `mergeAdmin`, so a missing key is **debt** — the screen renders in
 * English rather than blank. That is a real difference and the report keeps it,
 * because "the build will fail" and "a Hungarian seller sees English" want
 * different urgency.
 */

/** `section.key` — every leaf in a dictionary is exactly two levels deep. */
export type KeyPath = string;

export type Surface = "storefront" | "admin";

/** A dictionary as this tooling handles one: sections of strings, no deeper. */
export type FlatDictionary = Record<KeyPath, string>;

/**
 * Flatten a dictionary to `section.key` → text.
 *
 * Throws on anything that is not two levels of plain object ending in a string.
 * A dictionary that grew an array or a third level would otherwise be silently
 * half-processed, and half-translating a dictionary is worse than refusing to.
 */
export function flatten(
  dictionary: unknown,
  surface: Surface,
): FlatDictionary {
  const out: FlatDictionary = {};
  if (!isPlainObject(dictionary)) {
    throw new Error(`${surface}: expected an object, got ${typeof dictionary}`);
  }

  for (const [section, body] of Object.entries(dictionary)) {
    if (!isPlainObject(body)) {
      throw new Error(
        `${surface}: section "${section}" is ${describe(body)}, not an object. ` +
          `This tooling assumes exactly two levels — teach it the new shape ` +
          `rather than letting it skip the section.`,
      );
    }
    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== "string") {
        throw new Error(
          `${surface}: "${section}.${key}" is ${describe(value)}, not a string.`,
        );
      }
      out[`${section}.${key}`] = value;
    }
  }
  return out;
}

/** One locale's standing against English. */
export type LocaleGap = {
  locale: string;
  /** Keys English has and this locale does not. */
  missing: KeyPath[];
  /**
   * Keys this locale has and English does not.
   *
   * Not an error and not fixable by translating: a key removed from English
   * leaves these behind, and they are dead weight rather than a hole. Reported
   * so a cleanup pass has a list, never counted as debt.
   */
  orphaned: KeyPath[];
  /**
   * Keys whose translation is byte-identical to the English.
   *
   * Ambiguous by nature — "OK" and "Email" are correct in a dozen languages —
   * so this is a hint for a human and never a failure. It is the one signal that
   * catches a locale filled by copying English in, which passes every other
   * check in this file.
   */
  untranslated: KeyPath[];
};

export function gapsFor(
  source: FlatDictionary,
  target: FlatDictionary,
  locale: string,
): LocaleGap {
  const sourceKeys = Object.keys(source);
  const targetKeys = new Set(Object.keys(target));

  return {
    locale,
    missing: sourceKeys.filter((key) => !targetKeys.has(key)),
    orphaned: [...targetKeys].filter((key) => !(key in source)).sort(),
    untranslated: sourceKeys.filter(
      (key) => targetKeys.has(key) && target[key] === source[key],
    ),
  };
}

/**
 * Whether a gap is a build failure or a backlog entry.
 *
 * Storefront: a hole is a compile error, so any missing key fails.
 * Admin: a hole falls back to English, so it is reported and does not fail.
 */
export function blocksBuild(surface: Surface, gap: LocaleGap): boolean {
  return surface === "storefront" && gap.missing.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
