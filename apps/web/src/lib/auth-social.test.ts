import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What Apple and Google sign-in are allowed to do, asserted against source.
 *
 * The auth config cannot be instantiated without a database, so — as with
 * `auth-messages.test.ts` — these read the file and the library rather than
 * calling them. That is worth more here than it looks: the two-factor
 * challenge in `auth.ts` is written by us and read by better-auth's own
 * endpoint, so the two agree only by convention. Every constant in that
 * convention is checked back out of the library below, which means a rename
 * upstream fails a test instead of shipping a challenge that no endpoint can
 * answer.
 */

const req = createRequire(import.meta.url);
const dist = path.dirname(req.resolve("better-auth"));
const read = (relative: string) => readFileSync(path.join(dist, relative), "utf8");

const authSource = readFileSync("src/lib/auth.ts", "utf8");
/** Just the guard, so an assertion cannot pass on an unrelated line elsewhere. */
const guard = authSource.slice(
  authSource.indexOf("async function guardSocialSignIn"),
  authSource.indexOf("export const auth"),
);

describe("the two-factor plugin still does not cover the social paths", () => {
  /*
   * This is the test that justifies `guardSocialSignIn` existing at all.
   *
   * better-auth challenges for a second factor from an after-hook whose
   * matcher lists the credential sign-in paths and nothing else — so a seller
   * with two-factor auth enabled who signs in with Google would otherwise get
   * a session and never see the challenge. If upstream widens that matcher,
   * this fails, and the right response is to delete our guard rather than run
   * two challenges over one sign-in.
   */
  const plugin = read("plugins/two-factor/index.mjs");
  const matcher = plugin.slice(plugin.indexOf("hooks: { after:"));

  it("matches the password paths", () => {
    expect(matcher).toContain('context.path === "/sign-in/email"');
  });

  it("does not match either social path", () => {
    expect(matcher.slice(0, matcher.indexOf("handler:"))).not.toContain("/callback");
    expect(matcher.slice(0, matcher.indexOf("handler:"))).not.toContain(
      "/sign-in/social",
    );
  });
});

describe("the challenge we write is the one better-auth reads", () => {
  const verify = read("plugins/two-factor/verify-two-factor.mjs");
  const constants = read("plugins/two-factor/constant.mjs");

  it("uses the plugin's cookie name", () => {
    expect(constants).toContain('TWO_FACTOR_COOKIE_NAME = "two_factor"');
    expect(authSource).toContain('const TWO_FACTOR_COOKIE = "two_factor"');
  });

  it("writes the attempt counter the verify endpoint consumes", () => {
    /*
     * `verifyTwoFactor` consumes this row before it will look at a code and
     * treats a missing one as an invalid challenge — so a cookie written
     * without its counter is a challenge that can never be answered, and the
     * seller is stranded on /verify-2fa with a correct code.
     */
    expect(verify).toContain("`2fa-attempts-${signedTwoFactorCookie}`");
    expect(authSource).toContain("`2fa-attempts-${identifier}`");
  });

  it("resolves the challenge cookie to a user id through the verification table", () => {
    // The cookie holds an identifier; the row it names holds the user id.
    expect(verify).toContain("findVerificationValue(signedTwoFactorCookie)");

    const challenge = authSource.slice(
      authSource.indexOf("async function challengeForTwoFactor"),
      authSource.indexOf("async function guardSocialSignIn"),
    );
    expect(challenge).toContain("createVerificationValue");
    expect(challenge).toContain("value: userId");
  });
});

describe("a social sign-in cannot skip the second factor", () => {
  it("is guarded from the after-hook, on both legs", () => {
    expect(authSource).toContain("if (isSocialSessionPath(ctx.path)) return guardSocialSignIn(ctx)");
  });

  it("destroys the session the callback created before challenging", () => {
    /*
     * Order matters and is not cosmetic: `verifyTwoFactor` short-circuits on
     * any existing session and hands back its token without looking at a
     * code. A challenge raised while the social session still stood would be
     * answerable by pressing submit on an empty field.
     */
    const challengeAt = guard.indexOf("challengeForTwoFactor");
    const endAt = guard.indexOf("await endSession(ctx, created.session.token)");
    expect(endAt).toBeGreaterThan(-1);
    expect(challengeAt).toBeGreaterThan(endAt);
  });

  it("answers each leg in the shape that leg speaks", () => {
    // The browser flow is a redirect; the native id-token flow is JSON.
    expect(guard).toContain("twoFactorRedirect: true");
    expect(guard).toContain("/verify-2fa");
  });
});

describe("a staff address cannot reach /admin through a provider", () => {
  /*
   * `staff.ts` says a roster account signs in by magic link and holds no
   * password "for anyone to phish or reuse". A linked Google account is
   * exactly such a credential, and `hooks.before` cannot see it — that check
   * reads the address out of the request body, and a provider callback has no
   * address in it until the token comes back.
   */
  it("refuses on the verified address the provider returned", () => {
    expect(guard).toContain("isStaffEmail(created.user.email)");
  });

  it("ends the session rather than merely logging it", () => {
    const refusalAt = guard.indexOf("isStaffEmail(created.user.email)");
    const twoFactorAt = guard.indexOf("const enrolled");
    const endAt = guard.indexOf("await endSession", refusalAt);
    expect(endAt).toBeGreaterThan(refusalAt);
    expect(endAt).toBeLessThan(twoFactorAt);
  });

  it("deletes the provider row the callback linked", () => {
    // Otherwise the refusal leaves behind the very credential it refused.
    expect(guard).toContain("deleteAccount(row.id)");
  });

  it("refuses the connect button too, not only the sign-in", () => {
    /*
     * Settings → Security can attach a provider to an already signed-in
     * account, which never reaches `guardSocialSignIn` — that hook fires on a
     * *new* session and a link flow creates none. Guarding one sink and not
     * its twin is a bug shape this repo keeps rediscovering.
     */
    const before = authSource.slice(
      authSource.indexOf("before: createAuthMiddleware"),
      authSource.indexOf("after: createAuthMiddleware"),
    );
    expect(before).toContain('ctx.path === "/link-social"');
    expect(before).toContain("isStaffEmail(signedIn?.user.email)");
  });
});

describe("the linking policy", () => {
  it("trusts Apple and Google, because both verify the address", () => {
    expect(authSource).toContain('trustedProviders: ["apple", "google"]');
  });

  it("adds no provider that does not verify email", () => {
    /*
     * Facebook and Instagram are out of scope by decision, not by omission:
     * neither guarantees a verified address, and one untrusted provider turns
     * the single linking rule above into two — with a takeover vector on the
     * branch that does not verify.
     */
    for (const provider of ["facebook", "instagram", "twitter", "github"]) {
      expect(authSource.toLowerCase()).not.toContain(`${provider}:`);
    }
  });

  it("never widens linking past the defaults", () => {
    expect(authSource).not.toContain("allowDifferentEmails: true");
    expect(authSource).not.toContain("allowUnlinkingAll: true");
    expect(authSource).not.toContain("requireLocalEmailVerified: false");
  });

  it("leaves password sign-in exactly as it was", () => {
    // Social is additive. Sellers who signed up with a password keep working.
    expect(authSource).toMatch(/emailAndPassword:\s*\{\s*(?:\/\*[\s\S]*?\*\/\s*)?enabled: true/);
  });
});

describe("the last credential cannot be unlinked", () => {
  it("is refused by better-auth itself, not only by our card", () => {
    /*
     * The linked-accounts card refuses to offer the button, but the promise
     * that matters is the server's: a seller with only Google linked who
     * unlinks it has an account nobody can ever reach again. better-auth
     * enforces this whenever `allowUnlinkingAll` is falsy, which is the
     * default and which the test above pins.
     */
    const account = read("api/routes/account.mjs");
    expect(account).toContain(
      "accounts.length === 1 && !ctx.context.options.account?.accountLinking?.allowUnlinkingAll",
    );
  });
});
