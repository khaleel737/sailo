import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  APPLE_CLIENT_SECRET_TTL_SECONDS,
  appleClientSecret,
  appleDisplayName,
  isSocialSessionPath,
  socialPathAnswersJson,
} from "@/lib/social-auth";

/** A throwaway P-256 key, the shape Apple's `.p8` is in. */
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const NOW = Date.UTC(2026, 7, 14, 12, 0, 0);

const mint = (overrides: Partial<Parameters<typeof appleClientSecret>[0]> = {}) =>
  appleClientSecret({
    clientId: "store.sailo.signin",
    teamId: "ABCDE12345",
    keyId: "KEY1234567",
    privateKey,
    now: NOW,
    ...overrides,
  });

/** A JWT's three segments, destructured so no assertion is needed. */
const split = (token: string) => {
  const [header = "", payload = "", signature = ""] = token.split(".");
  return { header, payload, signature, signed: `${header}.${payload}` };
};

const claims = (segment: string) =>
  JSON.parse(Buffer.from(segment, "base64url").toString());

describe("Apple's client secret", () => {
  it("claims what Apple's token endpoint checks", () => {
    const payload = claims(split(mint()).payload);

    // The team owns the key; the Services ID is the client being authenticated.
    expect(payload.iss).toBe("ABCDE12345");
    expect(payload.sub).toBe("store.sailo.signin");
    expect(payload.aud).toBe("https://appleid.apple.com");
    expect(payload.iat).toBe(Math.floor(NOW / 1000));
    expect(payload.exp).toBe(payload.iat + APPLE_CLIENT_SECRET_TTL_SECONDS);
  });

  it("names the key in the header, so Apple knows which one to check with", () => {
    const header = claims(split(mint()).header);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe("KEY1234567");
  });

  it("verifies against the key that signed it", () => {
    const { signed, signature } = split(mint());

    const ok = createVerify("SHA256")
      .update(signed)
      .verify(
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      );

    expect(ok).toBe(true);
  });

  it("signs in the raw form a JWS needs, not the DER Node defaults to", () => {
    /*
     * The failure this catches is invisible from the outside: a DER signature
     * is a well-formed JWT that Apple rejects as `invalid_client`, which is
     * the same thing it says for an expired secret, a wrong team id and a
     * crossed Services ID. P-1363 is two 32-byte integers and nothing else,
     * so the length is the tell — DER wraps them in a header and runs 70-72.
     */
    expect(Buffer.from(split(mint()).signature, "base64url")).toHaveLength(64);
  });

  it("takes a key whose newlines survived a platform environment variable", () => {
    /*
     * Vercel hands a multi-line secret back with `\n` as two characters, and
     * OpenSSL rejects that outright. Both forms must produce a signature the
     * same public key accepts — not the same *token*, because ECDSA draws a
     * fresh nonce per signature and two signings of identical claims differ.
     */
    const escaped = split(mint({ privateKey: privateKey.replace(/\n/g, "\\n") }));

    expect(escaped.signed).toBe(split(mint()).signed);
    expect(
      createVerify("SHA256")
        .update(escaped.signed)
        .verify(
          { key: publicKey, dsaEncoding: "ieee-p1363" },
          Buffer.from(escaped.signature, "base64url"),
        ),
    ).toBe(true);
  });

  it("expires inside Apple's six-month ceiling", () => {
    // Apple refuses a secret that lives longer than this, so the default must
    // never be edited past it.
    expect(APPLE_CLIENT_SECRET_TTL_SECONDS).toBeLessThanOrEqual(
      60 * 60 * 24 * 30 * 6,
    );
  });
});

describe("the name Apple sends once and never again", () => {
  it("keeps what Apple sent, when it sent it", () => {
    expect(appleDisplayName({ name: "Ada Lovelace", email: "ada@example.com" })).toBe(
      "Ada Lovelace",
    );
  });

  it("falls back to the address a seller chose", () => {
    // Every callback after the first, which is most of them.
    expect(appleDisplayName({ name: "", email: "ada@example.com" })).toBe("ada");
  });

  it("treats a name of pure whitespace as no name", () => {
    expect(appleDisplayName({ name: "   ", email: "ada@example.com" })).toBe("ada");
  });

  it("does not put a Hide My Email handle in front of a person", () => {
    /*
     * The local part of a relay address is random hex. Apple sends the flag as
     * a boolean or as the string "true" depending on the leg, and a fallback
     * that only understood one of them would greet half its sellers with
     * "Hi 3f9a2c1b7e".
     */
    for (const isPrivate of [true, "true"]) {
      expect(
        appleDisplayName({
          name: "",
          email: "3f9a2c1b7e@privaterelay.appleid.com",
          is_private_email: isPrivate,
        }),
      ).toBe("Seller");
    }
  });

  it("never returns an empty string, whatever it is given", () => {
    // `user.name` is notNull, and a blank one renders as "Hi ," in every email.
    for (const profile of [{}, { name: "" }, { email: "" }, { name: " ", email: " " }]) {
      expect(appleDisplayName(profile)).not.toBe("");
    }
  });
});

describe("the endpoints that hand out a session without a password", () => {
  it("covers both legs of the provider flow", () => {
    // The route pattern, not a real path — better-auth puts the pattern in
    // `ctx.path`, so `/callback/google` would never match.
    expect(isSocialSessionPath("/callback/:id")).toBe(true);
    expect(isSocialSessionPath("/sign-in/social")).toBe(true);
  });

  it("leaves the password paths to the two-factor plugin's own hook", () => {
    expect(isSocialSessionPath("/sign-in/email")).toBe(false);
    expect(isSocialSessionPath("/callback/google")).toBe(false);
  });

  it("knows which leg answers in JSON and which in a redirect", () => {
    // The browser flow ends in a redirect; the native id-token flow in JSON.
    expect(socialPathAnswersJson("/sign-in/social")).toBe(true);
    expect(socialPathAnswersJson("/callback/:id")).toBe(false);
  });
});
