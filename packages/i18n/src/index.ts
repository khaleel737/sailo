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
import { hr } from "./dictionaries/hr";
import { hu } from "./dictionaries/hu";
import { it } from "./dictionaries/it";
import { ja } from "./dictionaries/ja";
import { nl } from "./dictionaries/nl";
import { no } from "./dictionaries/no";
import { pl } from "./dictionaries/pl";
import { pt } from "./dictionaries/pt";
import { ro } from "./dictionaries/ro";
import { ru } from "./dictionaries/ru";
import { sr } from "./dictionaries/sr";
import { sv } from "./dictionaries/sv";
import { tr } from "./dictionaries/tr";
import { uk } from "./dictionaries/uk";
import { zh } from "./dictionaries/zh";

import { bs } from "./dictionaries/bs";

import { sl } from "./dictionaries/sl";

import { mk } from "./dictionaries/mk";

import { sq } from "./dictionaries/sq";

import { bg } from "./dictionaries/bg";

import { th } from "./dictionaries/th";

import { vi } from "./dictionaries/vi";

import { id } from "./dictionaries/id";

import { ms } from "./dictionaries/ms";

import { fil } from "./dictionaries/fil";

import { ko } from "./dictionaries/ko";

const DICTIONARIES: Record<Locale, Dictionary> = {
  en, ar, cs, da, de, el, es, fi, fr, hu, it, ja,
  nl, no, pl, pt, ro, ru, sv, tr, uk, zh, hr, sr, bs, sl, mk, sq, bg, th, vi, id, ms, fil, ko,
};

export function getDictionary(locale: string | undefined | null): Dictionary {
  return DICTIONARIES[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

/*
 * Re-exported rather than defined here. They live in `./interpolate` so the
 * phone can import them without dragging the thirty-five dictionaries above
 * into its bundle; every existing caller of `@sailo/i18n` reads them from the
 * same place it always has.
 */
export { interpolate, plural } from "./interpolate";

export type { Dictionary };
export { DEFAULT_LOCALE, isLocale };
export type { Locale };
