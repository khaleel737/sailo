import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSecret, sealSecret, secretHint } from "./secret-box";

/**
 * A credential on somebody else's system, at rest.
 *
 * What is tested is what an attacker would try: opening a value with no key,
 * opening one whose ciphertext was edited, and opening one sealed under a
 * different secret. All three answer null, and none of them says why — a
 * caller that could tell "wrong key" from "tampered" has an oracle.
 */

const SECRET = "test-secret-for-integration-keys";

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRET;
});

describe("sealing and opening", () => {
  it("round-trips", () => {
    const sealed = sealSecret("sk_live_abc123")!;
    expect(sealed).toBeTruthy();
    expect(openSecret(sealed)).toBe("sk_live_abc123");
  });

  it("never stores the plaintext", () => {
    const sealed = sealSecret("sk_live_abc123")!;
    expect(sealed).not.toContain("sk_live_abc123");
    expect(sealed).not.toContain("abc123");
  });

  it("uses a fresh nonce every time", () => {
    // Two seals of the same value must not be equal, or the ciphertext leaks
    // that two integrations share a key.
    expect(sealSecret("same")).not.toBe(sealSecret("same"));
  });

  it("survives unicode and length", () => {
    for (const value of ["", "é", "🔑", "x".repeat(4_000)]) {
      const sealed = sealSecret(value)!;
      expect(openSecret(sealed), JSON.stringify(value.slice(0, 8))).toBe(value);
    }
  });
});

describe("what will not open", () => {
  it("refuses a tampered ciphertext", () => {
    // The authenticated half doing its job: GCM's tag fails and `final()`
    // throws, rather than decrypting to rubbish that then travels in a header.
    const sealed = sealSecret("sk_live_abc123")!;
    const parts = sealed.split(".");
    const body = Buffer.from(parts[3]!, "base64url");
    body[0] = body[0]! ^ 0xff;
    parts[3] = body.toString("base64url");
    expect(openSecret(parts.join("."))).toBeNull();
  });

  it("refuses a tampered tag", () => {
    const sealed = sealSecret("sk_live_abc123")!;
    const parts = sealed.split(".");
    parts[2] = Buffer.alloc(16).toString("base64url");
    expect(openSecret(parts.join("."))).toBeNull();
  });

  it("refuses one sealed under a different secret", () => {
    const sealed = sealSecret("sk_live_abc123")!;
    process.env.BETTER_AUTH_SECRET = "a completely different secret";
    expect(openSecret(sealed)).toBeNull();
  });

  it("refuses a version this build does not know", () => {
    // The version prefix is what makes a future scheme change a migration
    // rather than a guess about what a stored string is.
    const sealed = sealSecret("sk_live_abc123")!;
    expect(openSecret(sealed.replace(/^v1\./, "v2."))).toBeNull();
  });

  it("refuses junk without throwing", () => {
    /*
     * The caller is a cron tick with a scenario to run. Every failure has to
     * be a value, because a throw here would end the tick for every other
     * seller's scenarios too.
     */
    for (const junk of ["", "not-a-secret", "v1.a.b", "v1....", "v1.!.!.!"]) {
      expect(() => openSecret(junk)).not.toThrow();
      expect(openSecret(junk), junk).toBeNull();
    }
  });
});

describe("with no key configured", () => {
  it("refuses to seal rather than storing plaintext", () => {
    /*
     * The whole point. A credential written in the clear because the
     * environment was misconfigured is exactly the outcome this file exists to
     * prevent, so the write refuses instead.
     */
    delete process.env.BETTER_AUTH_SECRET;
    expect(sealSecret("sk_live_abc123")).toBeNull();
    expect(openSecret("v1.a.b.c")).toBeNull();
  });
});

describe("the hint", () => {
  it("shows four characters and no more", () => {
    expect(secretHint("sk_live_abcd1234")).toBe("••••1234");
  });

  it("shows nothing for a value too short to hint at", () => {
    expect(secretHint("abc")).toBe("••••");
  });
});
