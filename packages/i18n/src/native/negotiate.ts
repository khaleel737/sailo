import { DEFAULT_LOCALE, isLocale, type Locale } from "../config";

/**
 * The best locale Sailo ships, given whatever tags a device offers.
 *
 * Pure on purpose. Reading the tags needs React Native and Expo; *choosing*
 * between them needs neither, and this package has no framework dependency to
 * spend — `@sailo/core` imports it for a type, and `packages/api` imports core,
 * so a `react-native` peer here would land a React Native requirement on a
 * headless JSON server. The caller reads the tags; this decides.
 *
 * Deliberately the same two steps as `matchAcceptLanguage` in `../config`:
 * exact tag first, then the base language, so a phone set to `pt-BR` or `zh-CN`
 * gets Portuguese or Chinese rather than English. It is not that function
 * because that one sorts by the `q` weights an `Accept-Language` header
 * carries. A device list has no weights — its order *is* the preference — and
 * borrowing the header parser would mean trusting `Array.prototype.toSorted`
 * on Hermes for nothing.
 *
 * Tags may arrive underscored (`ar_SA`, which is what Android's
 * `Locale.toString()` gives) or cased however the platform likes; both are
 * normalised here rather than at each call site, because a tag that fails to
 * match does not throw — it silently becomes English, which is the hardest
 * kind of bug to notice.
 */
export function pickLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const normalised = tag.replace(/_/g, "-").toLowerCase();
    if (isLocale(normalised)) return normalised;

    // `zh-Hans-CN`, `pt-BR`, `en-GB` … fall back to the base language.
    const base = normalised.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
