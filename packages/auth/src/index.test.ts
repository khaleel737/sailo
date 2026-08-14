/**
 * The one line between a signed-in seller and an app where nothing loads.
 *
 * `@better-auth/expo` keeps its cookie jar in the keychain as JSON — a map of
 * name to `{ value, expires }`, because it has to be able to drop an expired
 * cookie the way a browser would. A `Cookie` header is `name=value; name=value`.
 * Handing the first to a server that expects the second is not a type error, not
 * a crash, and not visible in any log the app writes: the request goes out, the
 * server finds no session token in it, and answers UNAUTHORIZED.
 *
 * What makes it worth a test rather than a comment is which calls survive it.
 * better-auth's own fetch runs the jar through this same conversion before
 * sending, so sign-in works, `useSession` reports a session, and the seller is
 * let into the app — while every tRPC query the product makes comes back
 * unauthenticated. The app reads as "the API is broken" from every screen at
 * once, which is the most expensive possible way for a header to be wrong.
 *
 * These run here rather than in apps/mobile, where the caller lives, for a
 * mechanical reason: `better-auth` ships untranspiled ESM under `node_modules`,
 * and the mobile app's jest preset excludes it from transformation — which is
 * why `apps/mobile/lib/auth.test.tsx` mocks this package wholesale. Mocking the
 * subject would leave nothing under test, so the behaviour is pinned on this
 * side, under vitest, and the app keeps only the structural guard that it calls
 * through here at all.
 */

import { describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index";

/** A jar in exactly the shape the plugin's `getSetCookie` writes. */
function jar(entries: Record<string, { value: string; expires?: string | null }>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(entries).map(([name, entry]) => [
        name,
        { value: entry.value, expires: entry.expires ?? null },
      ]),
    ),
  );
}

function storageHolding(raw: string | null) {
  return { getItem: () => raw };
}

describe("sessionCookieHeader", () => {
  it("serialises the jar into a header a server can parse", () => {
    const header = sessionCookieHeader(
      storageHolding(jar({ "__Secure-better-auth.session_token": { value: "abc123" } })),
    );

    expect(header).toBe("__Secure-better-auth.session_token=abc123");
  });

  /*
   * The regression itself, stated as the thing that must never be true again.
   * Every other assertion here would still pass against an implementation that
   * handed the jar back untouched in some edge case; this one cannot.
   */
  it("never returns the raw JSON it was given", () => {
    const raw = jar({ "__Secure-better-auth.session_token": { value: "abc123" } });
    const header = sessionCookieHeader(storageHolding(raw));

    expect(header).not.toBe(raw);
    expect(header.startsWith("{")).toBe(false);
    expect(header).toContain("=");
  });

  it("carries every live cookie, not just the session", () => {
    const header = sessionCookieHeader(
      storageHolding(
        jar({
          "__Secure-better-auth.session_token": { value: "abc123" },
          "__Secure-better-auth.dont_remember": { value: "1" },
        }),
      ),
    );

    // Order is the jar's; membership is what the server reads.
    expect(header.split("; ").sort()).toEqual([
      "__Secure-better-auth.dont_remember=1",
      "__Secure-better-auth.session_token=abc123",
    ]);
  });

  it("drops an entry whose expiry has passed", () => {
    const header = sessionCookieHeader(
      storageHolding(
        jar({
          "__Secure-better-auth.session_token": { value: "fresh" },
          "__Secure-better-auth.stale": {
            value: "old",
            expires: new Date(Date.now() - 60_000).toISOString(),
          },
        }),
      ),
    );

    expect(header).toBe("__Secure-better-auth.session_token=fresh");
  });

  /*
   * A signed-out device. The empty string matters as much as the populated one:
   * it is what lets the caller decide to send no `Cookie` header at all, and
   * `Cookie: ` is a different request from sending none.
   */
  it("returns an empty string when there is no session", () => {
    expect(sessionCookieHeader(storageHolding(null))).toBe("");
    expect(sessionCookieHeader(storageHolding("{}"))).toBe("");
  });

  /** A jar the keychain mangled is a signed-out device, not a crash on launch. */
  it("survives a jar that is not JSON", () => {
    expect(sessionCookieHeader(storageHolding("not json at all"))).toBe("");
  });
});
