import { en, type Dictionary } from "./dictionaries/en";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/**
 * Every locale is loaded eagerly. The dictionaries are small plain objects and
 * the alternative — dynamic import per request — costs a promise on the render
 * path for no real benefit at this size.
 */
import { ar } from "./dictionaries/ar";
import { cs } from "./dictionaries/cs";
import { da } from "./dictionaries/da";
import { de } from "./dictionaries/de";
import { el } from "./dictionaries/el";
import { es } from "./dictionaries/es";
import { fi } from "./dictionaries/fi";
import { fr } from "./dictionaries/fr";
import { hu } from "./dictionaries/hu";
import { it } from "./dictionaries/it";
import { ja } from "./dictionaries/ja";
import { nl } from "./dictionaries/nl";
import { no } from "./dictionaries/no";
import { pl } from "./dictionaries/pl";
import { pt } from "./dictionaries/pt";
import { ro } from "./dictionaries/ro";
import { ru } from "./dictionaries/ru";
import { sv } from "./dictionaries/sv";
import { tr } from "./dictionaries/tr";
import { uk } from "./dictionaries/uk";
import { zh } from "./dictionaries/zh";

const DICTIONARIES: Record<Locale, Dictionary> = {
  en, ar, cs, da, de, el, es, fi, fr, hu, it, ja,
  nl, no, pl, pt, ro, ru, sv, tr, uk, zh,
};

export function getDictionary(locale: string | undefined | null): Dictionary {
  return DICTIONARIES[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

/** Substitutes `{name}` placeholders. Unknown keys are left as-is. */
export function interpolate(
  template: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Chooses between a singular and plural string. English-style two-form
 * selection covers the dictionary's counted phrases; locales with richer
 * plural rules phrase those keys so one form reads correctly for any count.
 */
export function plural(
  count: number,
  one: string,
  many: string,
  values?: Record<string, string | number>,
) {
  return interpolate(count === 1 ? one : many, { count, ...values });
}

export type { Dictionary };
export { DEFAULT_LOCALE, isLocale };
export type { Locale };
