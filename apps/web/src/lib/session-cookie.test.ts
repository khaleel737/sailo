import { describe, expect, it } from "vitest";
import { localPath, parseSetCookie } from "./session-cookie";

/**
 * The two pieces of `/api/session/expire` that are wrong quietly.
 *
 * That route exists because a session cookie which no longer resolves used to
 * be permanent: the proxy read its presence and sent `/` to `/admin`, the
 * guard sent `/admin` to `/login`, and nothing anywhere removed the cookie —
 * so a seller who signed out on one device could not reach the landing page
 * on another for the thirty days of the cookie's life.
 *
 * Both helpers fail in ways a passing local run would not show: an open
 * redirect only matters once somebody looks for one, and a dropped `Secure`
 * only matters on https, which is not where anyone develops.
 */

describe("localPath", () => {
  it("keeps an ordinary path, query string and all", () => {
    expect(localPath("/")).toBe("/");
    expect(localPath("/login")).toBe("/login");
    expect(localPath("/admin/orders?status=new")).toBe("/admin/orders?status=new");
  });

  it("falls back to the site root when there is nothing to go on", () => {
    expect(localPath(null)).toBe("/");
    expect(localPath(undefined)).toBe("/");
    expect(localPath("")).toBe("/");
  });

  /*
   * The value reaches a `Location` header from a query string, so it is
   * whatever the link said. A redirect that starts on the real domain and ends
   * on someone else's is the shape of a phishing link that gets clicked.
   */
  it("refuses an absolute URL", () => {
    expect(localPath("https://evil.example")).toBe("/");
    expect(localPath("http://evil.example")).toBe("/");
    expect(localPath("javascript:alert(1)")).toBe("/");
  });

  /*
   * The two that "starts with a slash" lets through. `//evil.example` is
   * protocol-relative and browsers follow it off-site; `/\evil.example` is
   * normalised to the same thing by every major engine.
   */
  it("refuses a protocol-relative URL, in both spellings", () => {
    expect(localPath("//evil.example")).toBe("/");
    expect(localPath("//evil.example/admin")).toBe("/");
    expect(localPath("/\\evil.example")).toBe("/");
  });
});

describe("parseSetCookie", () => {
  it("reads what better-auth writes in development", () => {
    expect(
      parseSetCookie(
        "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
      ),
    ).toEqual({
      name: "better-auth.session_token",
      path: "/",
      domain: undefined,
      secure: false,
      httpOnly: true,
      sameSite: "lax",
    });
  });

  /*
   * The production shape, and the reason this function exists rather than a
   * hardcoded list of three names. A browser refuses a `__Secure-` cookie that
   * arrives without the flag — including the one sent to delete it — so losing
   * `secure` here would mean the cookie is never cleared on https and the bug
   * survives everywhere except a developer's laptop.
   */
  it("keeps Secure and the __Secure- prefix", () => {
    const parsed = parseSetCookie(
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(parsed.name).toBe("__Secure-better-auth.session_token");
    expect(parsed.secure).toBe(true);
  });

  it("keeps a domain when one is set, and reports none when it is not", () => {
    expect(parseSetCookie("a=1; Path=/; Domain=.sailo.store").domain).toBe(".sailo.store");
    expect(parseSetCookie("a=1; Path=/").domain).toBeUndefined();
  });

  it("defaults the path, because a cookie deleted at the wrong path is not deleted", () => {
    expect(parseSetCookie("a=1; HttpOnly").path).toBe("/");
  });

  it("survives a value with an = in it", () => {
    const parsed = parseSetCookie("tok=abc.def%3D%3D; Path=/admin; SameSite=None; Secure");
    expect(parsed.name).toBe("tok");
    expect(parsed.path).toBe("/admin");
    expect(parsed.sameSite).toBe("none");
  });

  it("reports an unknown SameSite as unset rather than guessing", () => {
    expect(parseSetCookie("a=1; SameSite=Weird").sameSite).toBeUndefined();
    expect(parseSetCookie("a=1").sameSite).toBeUndefined();
  });
});
