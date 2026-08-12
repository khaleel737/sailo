import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newWebhookSecret, signWebhook, verifyWebhook } from "./signature";

/**
 * The Standard Webhooks recipe, proven rather than described.
 *
 * `verifyWebhook` is not called anywhere in the app — Sailo sends webhooks, it
 * does not receive its own — so without these tests the only statement of the
 * rules would be prose on the docs page, and prose cannot fail when the code
 * stops matching it.
 *
 * The first test deliberately recomputes the HMAC by hand rather than calling
 * our own verifier. A round trip against a shared helper proves the two halves
 * agree with each other and nothing about whether they agree with the
 * specification, which is the only agreement that matters to somebody using an
 * off-the-shelf library.
 */

const NOW = new Date("2026-08-12T09:41:07.000Z");
const BODY = '{"id":"evt_1","type":"order.paid"}';

describe("signWebhook", () => {
  it("signs `<id>.<timestamp>.<body>` with the decoded secret bytes", () => {
    // A secret whose base64 decodes to known bytes, so the expectation below
    // can be written independently of anything in signature.ts.
    const raw = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const secret = `whsec_${raw.toString("base64")}`;

    const headers = signWebhook({ id: "evt_1", body: BODY, secret, now: NOW });
    expect(headers).not.toBeNull();

    const timestamp = Math.floor(NOW.getTime() / 1000);
    const expected = createHmac("sha256", raw)
      .update(`evt_1.${timestamp}.${BODY}`)
      .digest("base64");

    expect(headers?.["webhook-signature"]).toBe(`v1,${expected}`);
    expect(headers?.["webhook-id"]).toBe("evt_1");
    expect(headers?.["webhook-timestamp"]).toBe(String(timestamp));
  });

  it("uses seconds, not milliseconds", () => {
    /*
     * Milliseconds here would put every message about fifty thousand years in
     * the future, and every consumer's tolerance check would reject it — a
     * failure that looks like "our webhooks don't work anywhere" rather than
     * like a unit mistake.
     */
    const headers = signWebhook({
      id: "evt_1",
      body: BODY,
      secret: newWebhookSecret(),
      now: NOW,
    });
    expect(Number(headers?.["webhook-timestamp"])).toBe(1786527667);
  });

  it("signs identically whether or not the secret carries the prefix", () => {
    // Every published library strips `whsec_` before decoding. A server that
    // treated the prefix as key material would produce signatures that verify
    // against nothing on earth while looking perfectly well-formed.
    const bare = Buffer.from("abcdefghijklmnop", "utf8").toString("base64");
    const withPrefix = signWebhook({ id: "e", body: BODY, secret: `whsec_${bare}`, now: NOW });
    const without = signWebhook({ id: "e", body: BODY, secret: bare, now: NOW });
    expect(withPrefix?.["webhook-signature"]).toBe(without?.["webhook-signature"]);
  });

  it("refuses a secret with no usable bytes", () => {
    // `Buffer.from(_, "base64")` never throws — it discards what it cannot
    // read — so a secret of pure punctuation would otherwise sign every
    // message with a zero-length key.
    expect(signWebhook({ id: "e", body: BODY, secret: "whsec_!!!", now: NOW })).toBeNull();
    expect(signWebhook({ id: "e", body: BODY, secret: "whsec_", now: NOW })).toBeNull();
    expect(signWebhook({ id: "e", body: BODY, secret: "", now: NOW })).toBeNull();
  });
});

describe("verifyWebhook", () => {
  const secret = newWebhookSecret();
  const headers = signWebhook({ id: "evt_1", body: BODY, secret, now: NOW });
  const sent = headers as Record<string, string>;

  it("accepts what we signed", () => {
    expect(verifyWebhook({ body: BODY, headers: sent, secret, now: NOW })).toEqual({
      ok: true,
    });
  });

  it("rejects a changed body", () => {
    const result = verifyWebhook({
      body: BODY.replace("order.paid", "order.refunded"),
      headers: sent,
      secret,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a changed id, because the id is signed too", () => {
    // Over the body alone, a captured delivery could be passed off as a
    // different one — which is exactly what a consumer's dedupe key must not
    // be forgeable on.
    const result = verifyWebhook({
      body: BODY,
      headers: { ...sent, "webhook-id": "evt_2" },
      secret,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a replay outside the tolerance", () => {
    const later = new Date(NOW.getTime() + 6 * 60_000);
    expect(verifyWebhook({ body: BODY, headers: sent, secret, now: later }).ok).toBe(false);

    // And accepts one inside it, in both directions — clocks drift both ways.
    const soon = new Date(NOW.getTime() + 4 * 60_000);
    const early = new Date(NOW.getTime() - 4 * 60_000);
    expect(verifyWebhook({ body: BODY, headers: sent, secret, now: soon }).ok).toBe(true);
    expect(verifyWebhook({ body: BODY, headers: sent, secret, now: early }).ok).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    const result = verifyWebhook({
      body: BODY,
      headers: sent,
      secret: newWebhookSecret(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("reads every v1 entry in a space-delimited list", () => {
    // The spec allows two signatures during a rotation. A verifier reading
    // only the first would reject a perfectly good second one.
    const list = `v1,notthisone ${sent["webhook-signature"]}`;
    expect(
      verifyWebhook({
        body: BODY,
        headers: { ...sent, "webhook-signature": list },
        secret,
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("skips versions it does not know rather than failing on them", () => {
    const result = verifyWebhook({
      body: BODY,
      headers: {
        ...sent,
        "webhook-signature": `v99,somethingelse ${sent["webhook-signature"]}`,
      },
      secret,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses when a header is missing", () => {
    for (const missing of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const partial = { ...sent, [missing]: undefined };
      expect(verifyWebhook({ body: BODY, headers: partial, secret, now: NOW }).ok).toBe(
        false,
      );
    }
  });
});

describe("newWebhookSecret", () => {
  it("is prefixed, base64, and never the same twice", () => {
    const a = newWebhookSecret();
    const b = newWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]+={0,2}$/);
    expect(a).not.toBe(b);
    // 32 bytes of entropy behind the prefix.
    expect(Buffer.from(a.slice("whsec_".length), "base64")).toHaveLength(32);
  });
});
