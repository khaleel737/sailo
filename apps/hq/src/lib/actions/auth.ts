"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";

/**
 * Signing out of the panel.
 *
 * A Server Action rather than a client call so the session cookie is cleared by
 * the same response that navigates: `nextCookies()` is last in the plugin list
 * precisely so an action can write `Set-Cookie`. Doing it client-side leaves a
 * window where the browser has navigated away but still holds a valid session.
 *
 * `redirect` throws, so nothing after it runs — that is Next's control flow, not
 * a missing return.
 */
export async function signOutStaff(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
