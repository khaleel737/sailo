import "server-only";
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  directionOf,
  isLocale,
  matchAcceptLanguage,
  type Locale,
} from "./config";
import { getDictionary } from ".";
import { getAdminDictionary } from "./admin";

/**
 * The viewer's own preference: an explicit cookie first, then the browser's
 * Accept-Language, then English. Used for admin and auth pages.
 */
export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const chosen = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;

  const header = (await headers()).get("accept-language");
  return matchAcceptLanguage(header) ?? DEFAULT_LOCALE;
}

/**
 * A storefront's language. The shop's own setting wins, because the seller
 * chose it for their audience — but an explicit visitor cookie overrides it,
 * so someone who picked a language keeps it across shops.
 */
export async function getShopLocale(shopLocale: string | null): Promise<Locale> {
  // The visitor's own choice, if they made one.
  const jar = await cookies();
  const chosen = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;

  // A pinned shop language beats the browser: the seller asked for it.
  if (isLocale(shopLocale)) return shopLocale;

  // Otherwise follow the visitor. This is the common case — most people
  // arrive from a link and never look for a language switcher.
  const header = (await headers()).get("accept-language");
  return matchAcceptLanguage(header) ?? DEFAULT_LOCALE;
}

export async function getT() {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale), dir: directionOf(locale) };
}

/**
 * The admin's own strings, in the seller's language. `a` rather than `t` so a
 * component holding both never has to think about which one it's reading.
 */
export async function getAdminT() {
  const locale = await getLocale();
  return {
    locale,
    t: getDictionary(locale),
    a: getAdminDictionary(locale),
    dir: directionOf(locale),
  };
}

export async function getShopT(shopLocale: string | null) {
  const locale = await getShopLocale(shopLocale);
  return { locale, t: getDictionary(locale), dir: directionOf(locale) };
}
