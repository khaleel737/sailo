import { marketingEn, type MarketingDictionary } from "./en";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../config";

/**
 * The landing page in every language Sailo ships.
 *
 * Loaded eagerly like the storefront dictionaries — these are plain objects,
 * and a dynamic import per request would put a promise on the render path of
 * the one route that has to be fastest.
 */

import { marketingAr } from "./ar";
import { marketingCs } from "./cs";
import { marketingDa } from "./da";
import { marketingDe } from "./de";
import { marketingEl } from "./el";
import { marketingEs } from "./es";
import { marketingFi } from "./fi";
import { marketingFr } from "./fr";
import { marketingHr } from "./hr";
import { marketingHu } from "./hu";
import { marketingIt } from "./it";
import { marketingJa } from "./ja";
import { marketingNl } from "./nl";
import { marketingNo } from "./no";
import { marketingPl } from "./pl";
import { marketingPt } from "./pt";
import { marketingRo } from "./ro";
import { marketingRu } from "./ru";
import { marketingSr } from "./sr";
import { marketingSv } from "./sv";
import { marketingTr } from "./tr";
import { marketingUk } from "./uk";
import { marketingZh } from "./zh";

import { marketingBs } from "./bs";

import { marketingSl } from "./sl";

import { marketingMk } from "./mk";

import { marketingSq } from "./sq";

import { marketingBg } from "./bg";

import { marketingTh } from "./th";

import { marketingVi } from "./vi";

import { marketingId } from "./id";

import { marketingMs } from "./ms";

import { marketingFil } from "./fil";

import { marketingKo } from "./ko";

const DICTIONARIES: Record<Locale, MarketingDictionary> = {
  en: marketingEn,
  ar: marketingAr,
  cs: marketingCs,
  da: marketingDa,
  de: marketingDe,
  el: marketingEl,
  es: marketingEs,
  fi: marketingFi,
  fr: marketingFr,
  hr: marketingHr,
  hu: marketingHu,
  it: marketingIt,
  ja: marketingJa,
  nl: marketingNl,
  no: marketingNo,
  pl: marketingPl,
  pt: marketingPt,
  ro: marketingRo,
  ru: marketingRu,
  sr: marketingSr,
  sv: marketingSv,
  tr: marketingTr,
  uk: marketingUk,
  zh: marketingZh,
  bs: marketingBs,
  sl: marketingSl,
  mk: marketingMk,
  sq: marketingSq,
  bg: marketingBg,
  th: marketingTh,
  vi: marketingVi,
  id: marketingId,
  ms: marketingMs,
  fil: marketingFil,
  ko: marketingKo,
};

export function getMarketingDictionary(
  locale: string | undefined | null,
): MarketingDictionary {
  return DICTIONARIES[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

export type { MarketingDictionary };
export { marketingEn };
