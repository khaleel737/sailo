/**
 * Locales Sailo ships with. `dir` drives the `dir` attribute so Arabic lays
 * out right-to-left without any per-component branching.
 */
export const LOCALES = [
  { code: "en", name: "English", native: "English", dir: "ltr", flag: "🇬🇧" },
  { code: "ar", name: "Arabic", native: "العربية", dir: "rtl", flag: "🇸🇦" },
  { code: "bg", name: "Bulgarian", native: "Български", dir: "ltr", flag: "🇧🇬" },
  { code: "bs", name: "Bosnian", native: "Bosanski", dir: "ltr", flag: "🇧🇦" },
  { code: "cs", name: "Czech", native: "Čeština", dir: "ltr", flag: "🇨🇿" },
  { code: "da", name: "Danish", native: "Dansk", dir: "ltr", flag: "🇩🇰" },
  { code: "de", name: "German", native: "Deutsch", dir: "ltr", flag: "🇩🇪" },
  { code: "el", name: "Greek", native: "Ελληνικά", dir: "ltr", flag: "🇬🇷" },
  { code: "es", name: "Spanish", native: "Español", dir: "ltr", flag: "🇪🇸" },
  { code: "fi", name: "Finnish", native: "Suomi", dir: "ltr", flag: "🇫🇮" },
  { code: "fil", name: "Filipino", native: "Filipino", dir: "ltr", flag: "🇵🇭" },
  { code: "fr", name: "French", native: "Français", dir: "ltr", flag: "🇫🇷" },
  { code: "hr", name: "Croatian", native: "Hrvatski", dir: "ltr", flag: "🇭🇷" },
  { code: "hu", name: "Hungarian", native: "Magyar", dir: "ltr", flag: "🇭🇺" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", dir: "ltr", flag: "🇮🇩" },
  { code: "it", name: "Italian", native: "Italiano", dir: "ltr", flag: "🇮🇹" },
  { code: "ja", name: "Japanese", native: "日本語", dir: "ltr", flag: "🇯🇵" },
  { code: "ko", name: "Korean", native: "한국어", dir: "ltr", flag: "🇰🇷" },
  { code: "mk", name: "Macedonian", native: "Македонски", dir: "ltr", flag: "🇲🇰" },
  { code: "ms", name: "Malay", native: "Bahasa Melayu", dir: "ltr", flag: "🇲🇾" },
  { code: "nl", name: "Dutch", native: "Nederlands", dir: "ltr", flag: "🇳🇱" },
  { code: "no", name: "Norwegian", native: "Norsk", dir: "ltr", flag: "🇳🇴" },
  { code: "pl", name: "Polish", native: "Polski", dir: "ltr", flag: "🇵🇱" },
  { code: "pt", name: "Portuguese", native: "Português", dir: "ltr", flag: "🇵🇹" },
  { code: "ro", name: "Romanian", native: "Română", dir: "ltr", flag: "🇷🇴" },
  { code: "ru", name: "Russian", native: "Русский", dir: "ltr", flag: "🇷🇺" },
  { code: "sl", name: "Slovenian", native: "Slovenščina", dir: "ltr", flag: "🇸🇮" },
  { code: "sq", name: "Albanian", native: "Shqip", dir: "ltr", flag: "🇦🇱" },
  { code: "sr", name: "Serbian", native: "Српски", dir: "ltr", flag: "🇷🇸" },
  { code: "sv", name: "Swedish", native: "Svenska", dir: "ltr", flag: "🇸🇪" },
  { code: "th", name: "Thai", native: "ไทย", dir: "ltr", flag: "🇹🇭" },
  { code: "tr", name: "Turkish", native: "Türkçe", dir: "ltr", flag: "🇹🇷" },
  { code: "uk", name: "Ukrainian", native: "Українська", dir: "ltr", flag: "🇺🇦" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt", dir: "ltr", flag: "🇻🇳" },
  { code: "zh", name: "Chinese", native: "中文", dir: "ltr", flag: "🇨🇳" },
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
      const [tag = "", q] = part.trim().split(";q=");
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
