import "server-only";

/**
 * Door passes, now in `@sailo/commerce/door-pass`.
 *
 * A pass is a bearer credential a volunteer holds on a phone, and the scanner
 * that reads it is the mobile app's reason to exist — so what a pass permits,
 * when it expires and when it stops working had to mean the same thing to both
 * servers. `apps/api` cannot import from this app.
 *
 * One function did not go. `doorUrl` builds a link *to this app*, out of this
 * app's own `NEXT_PUBLIC_APP_URL`, and a package with no opinion about which
 * host it is running on has no business holding it.
 */

export * from "@sailo/commerce/door-pass";

/** Where a volunteer's link points. This app's own origin, so this app's own. */
export function doorUrl(token: string, base = process.env.NEXT_PUBLIC_APP_URL) {
  return `${base ?? ""}/door/${token}`;
}
