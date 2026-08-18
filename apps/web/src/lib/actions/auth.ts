"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Signing out, as one server round trip.
 *
 * This used to be `await authClient.signOut()` in the sidebar followed by
 * `router.push("/login")`, and the two halves could disagree. Better-auth's
 * client does not throw on a refused request — it answers `{ data: null,
 * error }` — so a 500, or the rate limiter returning 429, left the sidebar
 * navigating to the login screen while the cookie and the session behind it
 * were both still alive. The seller had every reason to believe they were
 * signed out. On a public or shared machine that belief is the whole point of
 * the button, and it was wrong silently.
 *
 * A Server Action removes the gap rather than reporting it: the session is
 * revoked, `nextCookies()` writes the expiring Set-Cookie, and the redirect
 * rides the same response. There is no state in which the browser has been
 * moved to the login screen but the session survived — either the action
 * completes and does both, or it throws and Next renders the error boundary
 * with the seller still, truthfully, signed in.
 *
 * It also works with JavaScript disabled or still loading, because the button
 * is a real form submission.
 */
async function endSession() {
  /*
   * Idempotent by design — better-auth answers `{ success: true }` and emits
   * the expiring cookies even when the incoming session is already dead or
   * absent. So a double-submit, or a click made after the session expired,
   * clears the browser rather than throwing at somebody who is trying to
   * leave.
   */
  await auth.api.signOut({ headers: await headers() });
}

/**
 * The seller's own sign-out, from /admin.
 *
 * A separate export from the staff one rather than a single action taking the
 * destination as an argument: a Server Action's arguments arrive from the
 * client, and a redirect target supplied by the caller is an open redirect
 * waiting to be found. Two exports have no parameter to tamper with.
 */
export async function signOutSeller() {
  await endSession();
  redirect("/login");
}
