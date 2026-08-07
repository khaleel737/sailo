import { describe, expect, it } from "vitest";
import { isStoredFileUrl } from "@/lib/file-urls";

/**
 * The allowlist standing between a seller and a server-side fetch.
 *
 * `/api/download/[token]/[fileId]` fetches the stored URL and streams the
 * response back to the caller. The save path only checked that the string
 * began with `http`, so a seller — and signup is open, so that is anyone —
 * could store any URL, buy their own product, and have the server retrieve it
 * for them. These are the payloads that has to keep failing.
 */

describe("isStoredFileUrl — what must be refused", () => {
  it.each([
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata over http"],
    ["https://169.254.169.254/latest/meta-data/", "cloud metadata over https"],
    ["http://localhost:3000/api/cron/sweep", "the app's own loopback"],
    ["https://127.0.0.1/", "loopback by address"],
    ["http://[::1]/", "loopback over IPv6"],
    ["https://10.0.0.5/internal", "private range"],
    ["https://192.168.1.1/", "private range"],
    ["https://metadata.google.internal/", "an internal name"],
    ["https://evil.tld/payload", "any third-party host"],
  ])("refuses %s (%s)", (url) => {
    expect(isStoredFileUrl(url)).toBe(false);
  });

  it("refuses a host smuggled in the credentials", () => {
    /*
     * A substring check for the blob host would pass this, because the text is
     * present. `new URL()` resolves the hostname to `evil.tld`, which is what
     * `fetch` would actually contact.
     */
    const url = "https://abc.public.blob.vercel-storage.com@evil.tld/payload";
    expect(new URL(url).hostname).toBe("evil.tld");
    expect(isStoredFileUrl(url)).toBe(false);
  });

  it("refuses a lookalike host without the separating dot", () => {
    expect(isStoredFileUrl("https://evil-public.blob.vercel-storage.com/x")).toBe(
      false,
    );
  });

  it("refuses the blob host over plain http", () => {
    // The bytes are paid-for goods and the request is ours to make.
    expect(isStoredFileUrl("http://abc.public.blob.vercel-storage.com/f")).toBe(
      false,
    );
  });

  it.each(["file:///etc/passwd", "data:text/plain,hi", "javascript:alert(1)"])(
    "refuses the %s scheme",
    (url) => {
      expect(isStoredFileUrl(url)).toBe(false);
    },
  );

  it.each([["", "empty"], ["not a url", "unparseable"], ["   ", "blank"]])(
    "refuses %j (%s)",
    (url) => {
      expect(isStoredFileUrl(url)).toBe(false);
    },
  );

  it.each([null, undefined, 42, {}, []])("refuses the non-string %j", (value) => {
    // The value arrives from a server action payload, so its type is a claim.
    expect(isStoredFileUrl(value)).toBe(false);
  });
});

describe("isStoredFileUrl — what must keep working", () => {
  it("accepts a URL from the blob store", () => {
    expect(
      isStoredFileUrl(
        "https://abc123.public.blob.vercel-storage.com/files/guide-x9.pdf",
      ),
    ).toBe(true);
  });

  it("accepts any store id, since the host carries it", () => {
    // `put()` returns `<storeId>.public.blob.vercel-storage.com`, and the store
    // changes with the deployment's token.
    for (const store of ["a", "store-1", "xyz789"]) {
      expect(
        isStoredFileUrl(`https://${store}.public.blob.vercel-storage.com/f.zip`),
      ).toBe(true);
    }
  });

  it("accepts a URL carrying a query string", () => {
    expect(
      isStoredFileUrl(
        "https://abc.public.blob.vercel-storage.com/f.zip?download=1",
      ),
    ).toBe(true);
  });

  it("narrows the type, so a caller can store it without asserting", () => {
    const value: unknown = "https://abc.public.blob.vercel-storage.com/f.zip";
    if (!isStoredFileUrl(value)) throw new Error("expected acceptance");
    expect(value.startsWith("https://")).toBe(true);
  });
});
