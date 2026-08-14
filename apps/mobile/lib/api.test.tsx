/**
 * That the data client's session actually goes through the one conversion that
 * makes it a session.
 *
 * The keychain holds better-auth's cookie jar as JSON; a `Cookie` header is
 * `name=value`. `sessionCookieHeader` in `@sailo/auth` is the only thing that
 * turns one into the other, and `packages/auth/src/index.test.ts` pins what it
 * returns. What that test cannot see is this file's caller — an edit here that
 * reads the keychain directly again, to save an import, passes every assertion
 * over there while signing every request out.
 *
 * So this is a source read rather than a behaviour test, and deliberately: the
 * behaviour cannot be exercised on this side at all. `better-auth` ships
 * untranspiled ESM under `node_modules` and the jest preset's
 * `transformIgnorePatterns` excludes it — see the note in `jest.config.js` for
 * why that list cannot be widened — which is the same reason
 * `lib/auth.test.tsx` mocks `@sailo/auth` outright. A test here that imported
 * the real thing would not fail on a regression; it would fail on the import.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the data client's Cookie header", () => {
  const source = readFileSync(join(__dirname, "api.ts"), "utf8");

  it("is built by sessionCookieHeader", () => {
    expect(source).toContain("sessionCookieHeader(SecureStore)");
  });

  /*
   * The two shapes the old bug had. `getItemAsync` reached the jar directly and
   * `_cookie` was how it named the key — either one reappearing means the
   * conversion has been routed around.
   */
  it("does not read better-auth's jar out of the keychain itself", () => {
    expect(source).not.toContain("getItemAsync");
    expect(source).not.toContain("_cookie");
  });
});
