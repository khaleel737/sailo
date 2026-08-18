/**
 * The two small decisions `/api/session/expire` has to get right.
 *
 * They live here rather than in the route file because Next validates what a
 * route module exports — a handler and a few known config keys, nothing else —
 * so a helper exported for a test is a build error. Which is fair: a route is
 * an endpoint, not a library.
 */

/**
 * Narrows a caller-supplied `next` to a path on this site.
 *
 * The value arrives in a query string, so it is whatever anyone chose to put
 * there, and it ends up in a `Location` header. Left alone that is an open
 * redirect — the kind that gets used to make a phishing link start with the
 * real domain.
 *
 * "Starts with a slash" is not the test. `//evil.example` is a
 * protocol-relative URL and browsers follow it off-site, and `/\evil.example`
 * is treated the same way by every major engine, having been normalised from
 * the backslash. What makes a string an origin rather than a path is a second
 * separator in the second position, so that is what this looks at.
 */
export function localPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

/** A cookie's name and the attributes that decide which cookie it *is*. */
export type CookieAttributes = {
  name: string;
  path: string;
  domain: string | undefined;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "strict" | "lax" | "none" | undefined;
};

/**
 * Reads back one `Set-Cookie` line that better-auth just wrote.
 *
 * Deleting a cookie means re-sending it with the same name *and the same
 * attributes*; a mismatch on path, domain or the `Secure` flag writes a second
 * cookie instead of removing the first. So every attribute is carried over
 * rather than assumed.
 *
 * `Secure` is the one that matters most. In production these are named
 * `__Secure-better-auth.session_token`, and the prefix is a promise a browser
 * enforces: it refuses any `__Secure-` cookie that arrives without the flag,
 * including the one meant to delete it. Defaulting that to `false` would have
 * left the bug alive in exactly the environment it was reported from, while
 * every local test passed over http.
 */
export function parseSetCookie(line: string): CookieAttributes {
  const [pair = "", ...rest] = line.split(";");
  const equals = pair.indexOf("=");
  const name = (equals === -1 ? pair : pair.slice(0, equals)).trim();

  const attrs = new Map<string, string>();
  for (const part of rest) {
    const [key = "", ...value] = part.split("=");
    attrs.set(key.trim().toLowerCase(), value.join("=").trim());
  }

  const sameSite = attrs.get("samesite")?.toLowerCase();
  return {
    name,
    path: attrs.get("path") || "/",
    domain: attrs.get("domain") || undefined,
    secure: attrs.has("secure"),
    httpOnly: attrs.has("httponly"),
    sameSite:
      sameSite === "strict" || sameSite === "lax" || sameSite === "none"
        ? sameSite
        : undefined,
  };
}
