import { describe, expect, it } from "vitest";
import { isWebhookTargetUrl } from "./post";

/**
 * The save-time half of the SSRF guard.
 *
 * It is not the half that matters — an address is checked again at connect
 * time, on whatever DNS actually returned — but it is the half a seller sees,
 * and a URL that saves and then silently never delivers is worse than one
 * refused at the form.
 */

describe("isWebhookTargetUrl", () => {
  it("accepts the URLs sellers will actually paste", () => {
    for (const url of [
      "https://hooks.zapier.com/hooks/catch/1234567/abcdef/",
      "https://hook.eu2.make.com/abcdefghijklmnop",
      "https://n8n.example.com/webhook/9f2c",
      "https://example.com:443/hook",
      "https://example.com/hook?token=abc&x=1",
    ]) {
      expect(isWebhookTargetUrl(url), url).toBe(true);
    }
  });

  it("refuses anything that is not https", () => {
    for (const url of [
      "http://example.com/hook",
      "ftp://example.com/hook",
      "javascript:alert(1)",
      "//example.com/hook",
      "example.com/hook",
    ]) {
      expect(isWebhookTargetUrl(url), url).toBe(false);
    }
  });

  it("refuses ports other than 443", () => {
    /*
     * Arbitrary ports would make this a port scanner with our IP address on
     * it: aim it at any public host, read back the status code and the timing.
     * Every hosted consumer is on 443, and a self-hosted one sits behind a
     * proxy that is.
     */
    expect(isWebhookTargetUrl("https://example.com:8443/hook")).toBe(false);
    expect(isWebhookTargetUrl("https://example.com:22/hook")).toBe(false);
    expect(isWebhookTargetUrl("https://example.com:5678/webhook")).toBe(false);
  });

  it("refuses addresses inside a network", () => {
    for (const url of [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.1/hook",
      "https://172.16.0.1/hook",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
      "https://intranet.local/hook",
      "https://wiki/hook", // a single-label host a corporate resolver completes
    ]) {
      expect(isWebhookTargetUrl(url), url).toBe(false);
    }
  });

  it("judges the real host, not the part before an @", () => {
    /*
     * `https://hooks.zapier.com@127.0.0.1/hook` has hostname `127.0.0.1`.
     * A check written against the raw string rather than `url.hostname` reads
     * it as Zapier and lets it through to loopback.
     */
    expect(isWebhookTargetUrl("https://hooks.zapier.com@127.0.0.1/hook")).toBe(false);
    expect(isWebhookTargetUrl("https://example.com@169.254.169.254/")).toBe(false);
  });

  it("refuses credentials in the URL rather than silently dropping them", () => {
    // We do not forward them, and accepting the URL anyway would leave the
    // seller believing their endpoint is authenticated when our POSTs are not.
    expect(isWebhookTargetUrl("https://user:pass@example.com/hook")).toBe(false);
    expect(isWebhookTargetUrl("https://user@example.com/hook")).toBe(false);
  });

  it("refuses non-strings", () => {
    for (const value of [null, undefined, 42, {}, [], ""]) {
      expect(isWebhookTargetUrl(value)).toBe(false);
    }
  });
});
