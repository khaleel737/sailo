import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BETTER_AUTH_MESSAGES } from "@/lib/auth";

/**
 * The refusal a staff address gets must be the one everybody else gets.
 *
 * A staff account signs in by magic link and holds no password, so the two
 * password endpoints refuse it. The first version of that refusal threw a
 * bespoke 400 saying "use a sign-in link" — with a comment claiming it was
 * indistinguishable from an ordinary failure, which it plainly was not. A
 * distinct status and a message naming the magic link turned the endpoint into
 * a test for whether an address is on the roster, and anyone could have
 * enumerated it from outside.
 *
 * It now answers with better-auth's own message for each endpoint's own
 * failure. Those strings live in a nested dependency rather than a package
 * this app declares, so they are copied — and this reads them back out of the
 * library to make sure the copy still matches. A reword upstream fails here
 * rather than quietly making the refusal distinguishable again.
 */
describe("the staff refusal is indistinguishable", () => {
  const codes = readFileSync(
    "node_modules/better-auth/node_modules/@better-auth/core/dist/error/codes.mjs",
    "utf8",
  );

  it("uses the message /sign-up/email gives a taken address", () => {
    expect(codes).toContain(`"${BETTER_AUTH_MESSAGES.userExists}"`);
  });

  it("uses the message /sign-in/email gives a wrong password", () => {
    expect(codes).toContain(`"${BETTER_AUTH_MESSAGES.badCredentials}"`);
  });

  it("never names the roster, the magic link or staff", () => {
    // The words that gave it away. Any of them in a refusal is an oracle.
    for (const word of [/sign-in link/i, /magic/i, /staff/i, /roster/i]) {
      expect(BETTER_AUTH_MESSAGES.userExists, String(word)).not.toMatch(word);
      expect(BETTER_AUTH_MESSAGES.badCredentials, String(word)).not.toMatch(word);
    }
  });

  it("throws the status each endpoint throws for its own failure", () => {
    /*
     * Matching the message is only half of it — a 400 among 401s and 422s is
     * just as good an oracle. Read from the source rather than asserted in
     * prose, because a prose claim about this is what was wrong last time.
     */
    const source = readFileSync("src/lib/auth.ts", "utf8");
    const hook = source.slice(source.indexOf("refusesPasswordAuth(ctx.path"));
    expect(hook).toContain('APIError("UNPROCESSABLE_ENTITY"');
    expect(hook).toContain('APIError("UNAUTHORIZED"');
    expect(hook).not.toContain('APIError("BAD_REQUEST"');
  });
});
