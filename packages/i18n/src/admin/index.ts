import { adminEn, type AdminDictionary, type PartialAdminDictionary } from "./en";
import { mergeAdmin } from "../admin-merge";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../config";

/**
 * Admin translations, merged over English.
 *
 * A locale supplies whatever it has and the rest resolves to English, so
 * translating the admin can land a section at a time without ever showing a
 * blank label — and adding a new English string doesn't break thirty-four
 * builds at once.
 */

import { adminAr } from "./ar";
import { adminCs } from "./cs";
import { adminDa } from "./da";
import { adminDe } from "./de";
import { adminEl } from "./el";
import { adminEs } from "./es";
import { adminFi } from "./fi";
import { adminFr } from "./fr";
import { adminHu } from "./hu";
import { adminIt } from "./it";
import { adminJa } from "./ja";
import { adminNl } from "./nl";
import { adminNo } from "./no";
import { adminPl } from "./pl";
import { adminPt } from "./pt";
import { adminRo } from "./ro";
import { adminRu } from "./ru";
import { adminSv } from "./sv";
import { adminTr } from "./tr";
import { adminUk } from "./uk";
import { adminZh } from "./zh";

import { adminBg } from "./bg";

import { adminBs } from "./bs";

import { adminFil } from "./fil";

import { adminHr } from "./hr";

import { adminId } from "./id";

import { adminKo } from "./ko";

import { adminMk } from "./mk";

import { adminMs } from "./ms";

import { adminSl } from "./sl";

import { adminSq } from "./sq";

import { adminSr } from "./sr";

import { adminTh } from "./th";

import { adminVi } from "./vi";

const OVERRIDES: Partial<Record<Locale, PartialAdminDictionary>> = {
  vi: adminVi,
  th: adminTh,
  sr: adminSr,
  sq: adminSq,
  sl: adminSl,
  ms: adminMs,
  mk: adminMk,
  ko: adminKo,
  id: adminId,
  hr: adminHr,
  fil: adminFil,
  bs: adminBs,
  bg: adminBg,
  ar: adminAr,
  cs: adminCs,
  da: adminDa,
  de: adminDe,
  el: adminEl,
  es: adminEs,
  fi: adminFi,
  fr: adminFr,
  hu: adminHu,
  it: adminIt,
  ja: adminJa,
  nl: adminNl,
  no: adminNo,
  pl: adminPl,
  pt: adminPt,
  ro: adminRo,
  ru: adminRu,
  sv: adminSv,
  tr: adminTr,
  uk: adminUk,
  zh: adminZh,
};

/** Merged dictionaries are built once per locale, not per request. */
const cache = new Map<Locale, AdminDictionary>();

export function getAdminDictionary(locale: string | undefined | null): AdminDictionary {
  const code = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const hit = cache.get(code);
  if (hit) return hit;

  const built =
    code === DEFAULT_LOCALE ? mergeAdmin({}) : mergeAdmin(OVERRIDES[code] ?? {});
  cache.set(code, built);
  return built;
}

/** How much of the admin a locale actually covers — used by the coverage check. */
export function adminCoverage(locale: Locale) {
  const overrides = OVERRIDES[locale] ?? {};
  let total = 0;
  let translated = 0;

  for (const section of Object.keys(adminEn) as (keyof AdminDictionary)[]) {
    const keys = Object.keys(adminEn[section]);
    total += keys.length;
    const supplied = overrides[section] ?? {};
    translated += keys.filter((k) => k in supplied).length;
  }

  return { total, translated, missing: total - translated };
}

export type { AdminDictionary, PartialAdminDictionary };
export { adminEn };
