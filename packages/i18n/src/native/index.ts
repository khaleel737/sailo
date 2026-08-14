/**
 * `@sailo/i18n/native` — the dictionaries, one locale at a time.
 *
 * WHY THIS EXPORT EXISTS
 *
 * `@sailo/i18n` and `@sailo/i18n/admin` load all thirty-five locales at module
 * scope, and the comment on the root export explains why that is right: a
 * server renders any language on any request, the dictionaries are plain
 * objects, and a promise on the render path would buy nothing. Every word of
 * that stays true. It is simply not true of a React Native bundle, which holds
 * one locale for the life of an install and would otherwise build seventy
 * dictionary objects on every cold start to use two. So there are two entry
 * points, and the server's behaviour is untouched.
 *
 * WHAT IS AND IS NOT HERE
 *
 * Loading a locale and choosing one. **No React, no React Native, no Expo.**
 * That is not tidiness — `@sailo/core` imports this package for the
 * `Dictionary` type, `packages/api` imports core, and `apps/api` is a headless
 * JSON server. A `react-native` peer on `@sailo/i18n` would make that server
 * inherit a React Native requirement for a type it uses to describe strings.
 *
 * The framework half — the `useT()` hook, `I18nManager`, reading the handset's
 * language, persisting the seller's choice — lives in `apps/mobile/lib/i18n.tsx`,
 * where React, React Native and Expo are already dependencies. **Screens import
 * `useT` from there, not from here.**
 *
 * The layout rule every screen follows, the reload behaviour, and the measured
 * cold-start numbers are in this package's README.
 */

export { loadBundle, loadedBundle, EN_BUNDLE, type Bundle } from "./bundles";
export { pickLocale } from "./negotiate";
export { interpolate, plural } from "../interpolate";

export {
  DEFAULT_LOCALE,
  LOCALES,
  directionOf,
  isLocale,
  localeInfo,
  type Direction,
  type Locale,
} from "../config";

export type { AdminDictionary } from "../admin/en";
export type { Dictionary } from "../dictionaries/en";
