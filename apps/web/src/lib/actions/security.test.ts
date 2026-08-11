import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Two-factor enrolment and session revocation, pinned where they can be.
 *
 * None of this is reachable from a unit test: every path goes through
 * better-auth's endpoints, which want a database, a session and a real
 * secret. What *is* checkable — and what the specs call out as the things
 * that must not be got wrong — is which branch the code takes, in the idiom
 * `orders.test.ts` and `throttled-answers.test.ts` established.
 *
 * The properties under test are the ones whose failure is silent:
 *
 *  - a secret enabled without ever being verified locks the seller out at
 *    their next sign-in, and nothing before that moment looks wrong;
 *  - a 2FA change that revokes no sessions and sends no mail is precisely
 *    what an account thief wants;
 *  - a revoke action that trusts the id it was handed is an IDOR, and it
 *    passes every happy-path test;
 *  - a throttled verification reported as a wrong code tells the honest
 *    owner their correct code was wrong.
 */

const security = readFileSync("src/lib/actions/security.ts", "utf8");
const auth = readFileSync("src/lib/auth.ts", "utf8");

function positionOf(label: string, needle: string): number {
  const at = security.indexOf(needle);
  if (at === -1) {
    throw new Error(
      `security.ts: this test pins call order and the anchor for "${label}" ` +
        `(${needle}) no longer matches. Re-anchor it rather than deleting it.`,
    );
  }
  return at;
}

describe("two-factor cannot be enabled on an unverified secret", () => {
  it("leaves the verify-before-enable guard to the plugin's default", () => {
    /*
     * `skipVerificationOnEnable` is the one option that would break this: it
     * flips `user.twoFactorEnabled` at enrolment, before any code has proven
     * the authenticator actually holds the secret. A seller who closed the
     * tab before scanning would then be asked for a code they can never
     * produce, at their next sign-in, with no way back in.
     */
    expect(auth).not.toContain("skipVerificationOnEnable");
  });

  it("enrols and confirms as two separate actions", () => {
    // One action doing both would have nowhere to put the code.
    expect(security).toContain("export async function beginTwoFactorEnrolment");
    expect(security).toContain("export async function confirmTwoFactorEnrolment");
    // The confirm step is a real TOTP verification, not a flag write.
    expect(security).toContain("auth.api.verifyTOTP");
  });

  it("asks for the password before minting a secret", () => {
    expect(security).toContain("auth.api.enableTwoFactor({\n      body: { password }");
  });
});

describe("turning two-factor off needs more than the password", () => {
  it("verifies a code before it calls disable", () => {
    /*
     * The whole point of the feature: someone holding only a stolen password
     * must not be able to switch it off. So a current code — TOTP or a backup
     * code — is verified first, and only then does the disable call run.
     */
    const verify = positionOf("code check", "if (/^\\d{6}$/.test(code))");
    const disable = positionOf("disable call", "auth.api.disableTwoFactor");
    expect(verify).toBeLessThan(disable);
  });

  it("accepts a backup code as the second factor", () => {
    // Losing the phone is the ordinary case, not an edge case.
    expect(security).toContain("auth.api.verifyBackupCode");
  });
});

describe("a two-factor change is never silent", () => {
  it("revokes other sessions and emails on both enable and disable", () => {
    const helper = /async function announceTwoFactorChange[\s\S]*?\n}/.exec(security)?.[0] ?? "";
    expect(helper).toContain("revokeAllButNewestSession");
    expect(helper).toContain("sendTwoFactorChanged");

    // Both paths, not just the one that is easy to remember.
    expect(security).toContain("await announceTwoFactorChange(session.user.id, true)");
    expect(security).toContain("await announceTwoFactorChange(session.user.id, false)");
  });
});

describe("terminating a session cannot reach someone else's", () => {
  it("takes a row id and resolves it, rather than taking a token", () => {
    /*
     * Spec 02 rule 1: the token is a bearer credential and must never be
     * rendered into the page. The action therefore accepts the opaque row id
     * and looks the row up itself.
     */
    expect(security).toContain('const id = String(formData.get("id") ?? "")');
    expect(security).not.toContain('formData.get("token")');
  });

  it("checks ownership before deleting", () => {
    const revoke = /export async function revokeSessionById[\s\S]*?\n}/.exec(security)?.[0] ?? "";
    const check = revoke.indexOf("row.userId !== session.user.id");
    const del = revoke.indexOf("db.delete(sessionTable)");
    expect(check).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(-1);
    expect(check).toBeLessThan(del);
  });

  it("answers a foreign id exactly as it answers a missing one", () => {
    /*
     * One message for both, or the action becomes an oracle for whether a
     * given session id exists on somebody else's account.
     */
    const revoke = /export async function revokeSessionById[\s\S]*?\n}/.exec(security)?.[0] ?? "";
    const notFound = revoke.match(/Session not found\./g) ?? [];
    expect(notFound.length).toBeGreaterThanOrEqual(2);
    expect(revoke).toContain("if (!row || row.userId !== session.user.id)");
  });

  it("leaves the caller signed in when signing out the others", () => {
    const others = /export async function revokeOtherSessions[\s\S]*?\n}/.exec(security)?.[0] ?? "";
    expect(others).toContain("ne(sessionTable.token, session.session.token)");
  });
});

describe("a throttled verification is unknown, not wrong", () => {
  it("refuses with a try-again rather than an invalid-code message", () => {
    /*
     * The repo's rule, and it matters most here: the person most likely to
     * trip this limit is the account's real owner retrying, and telling them
     * a correct code was invalid sends them to reset their authenticator.
     */
    const gate = /if \(TWO_FACTOR_VERIFY_PATHS\.has\(ctx\.path\)\)[\s\S]*?\n      }/.exec(auth)?.[0] ?? "";
    expect(gate).toContain("Too many attempts. Try again later.");
    expect(gate).not.toContain("Invalid");
  });

  it("keys the limit on the user, not the caller's address", () => {
    // An attacker holding the password can change address freely; they cannot
    // change which account they are guessing at.
    expect(auth).toContain("const twoFactorRateKey = (userId: string) => `2fa:${userId}`");
  });

  it("charges up front and refunds a verified code", () => {
    // Same charge-then-refund shape as the coupon ceiling: peeking first
    // would let a concurrent burst all pass a ceiling that should stop them.
    expect(auth).toContain("await rateLimit(\n            twoFactorRateKey(userId)");
    expect(auth).toContain("await refundRateLimit(twoFactorRateKey(userId)");
    // Refund only on success — an after-hook runs on failures too.
    expect(auth).toContain("if (isAPIError(ctx.context.returned)) return;");
  });
});

describe("revoked sessions die immediately", () => {
  it("keeps the session cookie cache off", () => {
    /*
     * The one place this feature could silently lie. With `cookieCache` on, a
     * signed snapshot of the session keeps working until its TTL expires — so
     * "terminate" would return success while the terminated device carried on
     * for another five minutes.
     */
    // The config key, not the word — the comment in `auth.ts` explaining why
    // the cache is off names it, and that comment is worth keeping.
    expect(auth).not.toMatch(/^\s*cookieCache\s*:/m);
  });
});
