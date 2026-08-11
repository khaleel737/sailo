import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_EMAIL_LENGTH,
  SUBSCRIBE_TOKEN_DAYS,
  normalizeEmail,
  normalizeName,
  readSubscribeToken,
  subscribeToken,
} from "./subscribe";
import { unsubscribeToken } from "./unsubscribe";

/**
 * The link that turns an address into a contact.
 *
 * It is the only thing standing between a public form and somebody's inbox,
 * so what is tested here is what an attacker would try: signing their own
 * token, replaying a token from the neighbouring flow, editing the address
 * inside one, and using a link long after it was issued.
 */

const SECRET = "test-secret-for-subscribe-tokens";

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRET;
});

const SHOP = "6f1c2f4c-0f1c-4b0e-9c1e-2f4c0f1c4b0e";

function signed(email: string, name: string | null = null, now = new Date()): string {
  const token = subscribeToken({ shopId: SHOP, email, name }, now);
  expect(token).not.toBeNull();
  return token ?? "";
}

describe("the confirmation token", () => {
  it("round-trips what it was given", () => {
    const claim = readSubscribeToken(signed("ada@example.com", "Ada"));
    expect(claim).toEqual({ shopId: SHOP, email: "ada@example.com", name: "Ada" });
  });

  it("survives being sent through a URL", () => {
    const token = signed("ada+news@example.com");
    expect(readSubscribeToken(decodeURIComponent(encodeURIComponent(token)))?.email).toBe(
      "ada+news@example.com",
    );
  });

  it("refuses a token whose payload was edited", () => {
    const token = signed("ada@example.com");
    const [payload, sig] = token.split(".");
    const swapped = Buffer.from(
      JSON.stringify({ s: SHOP, e: "victim@example.com", x: 9_999_999_999 }),
      "utf8",
    ).toString("base64url");
    expect(payload).not.toBe(swapped);
    expect(readSubscribeToken(`${swapped}.${sig}`)).toBeNull();
  });

  it("refuses an unsubscribe token replayed as a subscribe one", () => {
    // Same secret, different derived key. Without the domain separation, a
    // link that removes somebody could be replayed to add them back.
    const other = unsubscribeToken({ shopId: SHOP, email: "ada@example.com" });
    expect(other).not.toBeNull();
    expect(readSubscribeToken(other ?? "")).toBeNull();
  });

  it("expires, unlike an unsubscribe link", () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const token = signed("ada@example.com", null, issued);

    const dayBefore = new Date(issued.getTime() + (SUBSCRIBE_TOKEN_DAYS - 1) * 86_400_000);
    expect(readSubscribeToken(token, dayBefore)).not.toBeNull();

    const dayAfter = new Date(issued.getTime() + (SUBSCRIBE_TOKEN_DAYS + 1) * 86_400_000);
    expect(readSubscribeToken(token, dayAfter)).toBeNull();
  });

  it("returns null rather than throwing on rubbish", () => {
    // A public route reads this. An exception here is a 500 that also tells
    // the caller something about their input.
    expect(readSubscribeToken("")).toBeNull();
    expect(readSubscribeToken("nodot")).toBeNull();
    expect(readSubscribeToken("....")).toBeNull();
    // 43 multi-byte characters: the same byte-vs-character length trap that
    // once turned a promised 204 into an uncaught 500 in the sibling flow.
    expect(readSubscribeToken(`x.${"é".repeat(43)}`)).toBeNull();
  });

  it("cannot be signed at all without a secret", () => {
    delete process.env.BETTER_AUTH_SECRET;
    expect(subscribeToken({ shopId: SHOP, email: "ada@example.com", name: null })).toBeNull();
  });
});

describe("the address", () => {
  it("folds case and whitespace, so one person is one contact", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("takes the ordinary shapes", () => {
    for (const email of ["a@b.co", "ada.lovelace+news@example.co.uk", "x_y@sub.domain.io"]) {
      expect(normalizeEmail(email), email).toBe(email.toLowerCase());
    }
  });

  it("refuses what no mail server would deliver to", () => {
    for (const bad of [
      "",
      "ada",
      "ada@",
      "@example.com",
      "ada@example",
      "ada @example.com",
      "ada@exam ple.com",
      "two@@example.com",
      "ada@example.com, victim@example.com",
      "<ada@example.com>",
      "a".repeat(MAX_EMAIL_LENGTH) + "@example.com",
      null,
      42,
    ]) {
      expect(normalizeEmail(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe("the optional name", () => {
  it("keeps what somebody typed", () => {
    expect(normalizeName(" Nadia ")).toBe("Nadia");
  });

  it("flattens the characters a header injection would need", () => {
    expect(normalizeName("Nadia\r\nBcc: victim@example.com")).toBe(
      "Nadia Bcc: victim@example.com",
    );
  });

  it("is nothing when it is nothing", () => {
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName(undefined)).toBeNull();
  });
});
