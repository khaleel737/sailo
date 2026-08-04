/**
 * Locales Sailo ships with. `dir` drives the `dir` attribute so Arabic lays
 * out right-to-left without any per-component branching.
 */
export const LOCALES = [
  { code: "en", name: "English", native: "English", dir: "ltr" },
  { code: "ar", name: "Arabic", native: "العربية", dir: "rtl" },
  { code: "cs", name: "Czech", native: "Čeština", dir: "ltr" },
  { code: "da", name: "Danish", native: "Dansk", dir: "ltr" },
  { code: "de", name: "German", native: "Deutsch", dir: "ltr" },
  { code: "el", name: "Greek", native: "Ελληνικά", dir: "ltr" },
  { code: "es", name: "Spanish", native: "Español", dir: "ltr" },
  { code: "fi", name: "Finnish", native: "Suomi", dir: "ltr" },
  { code: "fr", name: "French", native: "Français", dir: "ltr" },
  { code: "hu", name: "Hungarian", native: "Magyar", dir: "ltr" },
  { code: "it", name: "Italian", native: "Italiano", dir: "ltr" },
  { code: "ja", name: "Japanese", native: "日本語", dir: "ltr" },
  { code: "nl", name: "Dutch", native: "Nederlands", dir: "ltr" },
  { code: "no", name: "Norwegian", native: "Norsk", dir: "ltr" },
  { code: "pl", name: "Polish", native: "Polski", dir: "ltr" },
  { code: "pt", name: "Portuguese", native: "Português", dir: "ltr" },
  { code: "ro", name: "Romanian", native: "Română", dir: "ltr" },
  { code: "ru", name: "Russian", native: "Русский", dir: "ltr" },
  { code: "sv", name: "Swedish", native: "Svenska", dir: "ltr" },
  { code: "tr", name: "Turkish", native: "Türkçe", dir: "ltr" },
  { code: "uk", name: "Ukrainian", native: "Українська", dir: "ltr" },
  { code: "zh", name: "Chinese", native: "中文", dir: "ltr" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export type Direction = "ltr" | "rtl";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "sailo_locale";

const CODES = LOCALES.map((l) => l.code) as readonly string[];

export function isLocale(value: string | undefined | null): value is Locale {
  return typeof value === "string" && CODES.includes(value);
}

export function localeInfo(code: Locale) {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

export function directionOf(code: Locale): Direction {
  return localeInfo(code).dir;
}

/**
 * Picks the best supported locale from an Accept-Language header, so a first
 * visit is already in the right language before anyone touches a switcher.
 */
export function matchAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;

  const wanted = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((p) => p.tag && Number.isFinite(p.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of wanted) {
    if (isLocale(tag)) return tag;
    // zh-CN, pt-BR, en-GB … fall back to the base language.
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}
