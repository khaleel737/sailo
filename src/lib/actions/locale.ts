"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE } from "@/i18n/config";

/**
 * Persists a visitor's language choice. Server-side rather than
 * `document.cookie` so the very next render already sees it — writing from the
 * client races the refresh and the page comes back in the old language.
 */
export async function setLocale(code: string) {
  const locale = LOCALES.some((l) => l.code === code) ? code : DEFAULT_LOCALE;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  // Every page reads the cookie, so the whole tree is stale.
  revalidatePath("/", "layout");
}
