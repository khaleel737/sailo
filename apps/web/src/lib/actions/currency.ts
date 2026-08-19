"use server";

import { cookies } from "next/headers";
import { isRegionalCurrency } from "@sailo/core/regional";
import { CURRENCY_COOKIE, CURRENCY_COOKIE_MAX_AGE } from "@/lib/regional";

/**
 * A visitor choosing which currency they want to be quoted in — spec 53.
 *
 * Server-side rather than `document.cookie`, for the reason `setLocale` gives
 * beside it: writing from the client races the refresh and the page comes back
 * in the old currency. A form action re-renders the route when it returns, so
 * the switch is one round trip and no client JavaScript at all.
 *
 * **This action decides nothing about price.** It records a preference; every
 * page then re-asks `displayCurrency`, which refuses a currency the shop does
 * not actually offer. So a cookie naming a currency a seller has since turned
 * off is inert rather than dangerous, and a hand-set cookie naming one they
 * never offered is the same.
 *
 * No `revalidatePath` — see the long note in `setLocale` about the version of
 * this that purged every prerendered route in the tree from an unauthenticated
 * action. Every cached read that varies by currency takes it as an argument and
 * is therefore keyed on it already.
 */
export async function setStorefrontCurrency(formData: FormData): Promise<void> {
  const code = String(formData.get("currency") ?? "").toUpperCase();

  const store = await cookies();

  /*
   * An unrecognised code clears the cookie rather than storing it. That is the
   * switcher's "back to the shop's own currency" — the shop's currency is not
   * in `REGIONAL_CURRENCIES` for every shop, so it cannot be stored as a
   * choice, and clearing is the same thing said in one fewer state.
   */
  if (!isRegionalCurrency(code)) {
    store.delete(CURRENCY_COOKIE);
    return;
  }

  store.set(CURRENCY_COOKIE, code, {
    path: "/",
    maxAge: CURRENCY_COOKIE_MAX_AGE,
    sameSite: "lax",
    // It holds a three-letter code and nothing else, so this is tidiness
    // rather than a fix — but a cookie with no `secure` is one an attacker on
    // the network can set, and there is no reason to leave one lying around.
    secure: process.env.NODE_ENV === "production",
  });
}
