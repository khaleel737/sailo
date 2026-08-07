import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRenderableImageUrl, isStoredFileUrl } from "@/lib/file-urls";

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
  /*
   * The store id is pinned from `BLOB_READ_WRITE_TOKEN`, and the test process
   * loads a real `.env.local`. Cleared here so this block tests the host rule
   * on its own; the pinning has its own block at the bottom of the file.
   */
  const original = process.env.BLOB_READ_WRITE_TOKEN;
  beforeEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = original;
  });

  it("accepts a URL from the blob store", () => {
    expect(
      isStoredFileUrl(
        "https://abc123.public.blob.vercel-storage.com/files/guide-x9.pdf",
      ),
    ).toBe(true);
  });

  it("accepts any store id when no token pins one", () => {
    // `put()` returns `<storeId>.public.blob.vercel-storage.com`, and the store
    // changes with the deployment's token. Without a token to compare against,
    // the host is all there is to go on.
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

/**
 * The same hole, in the place it was never patched.
 *
 * `lib/og.tsx` fetches an image URL server-side to draw a shop's social card,
 * and the two `opengraph-image` routes are public, unauthenticated and
 * directly requestable — no order and no payment in front of them, unlike the
 * download route. Signup is open, so the seller who supplies `avatarUrl` is
 * not a trusted party.
 *
 * The allowlist is the product's own: `next.config.ts` names these three hosts
 * in `images.remotePatterns` and the CSP names them again in `img-src`, so
 * nothing that fails here could have rendered in a browser anyway.
 */
describe("isRenderableImageUrl", () => {
  it("accepts the hosts the product can already display", () => {
    for (const url of [
      "https://abc123.public.blob.vercel-storage.com/img/a.png",
      "https://picsum.photos/seed/1/600",
      "https://images.unsplash.com/photo-123",
    ]) {
      expect(isRenderableImageUrl(url), url).toBe(true);
    }
  });

  it("refuses the internal address space", () => {
    // The card is rendered on demand with `cache: "no-store"`, so each of
    // these would be a fresh outbound request the attacker times.
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5:8080/",
      "http://127.0.0.1:3000/api/cron/sweep",
      "http://[::1]/",
      "http://192.168.1.1/",
    ]) {
      expect(isRenderableImageUrl(url), url).toBe(false);
    }
  });

  it("refuses a scheme that is not https", () => {
    // `/^https?:\/\//` was the CSV importer's whole check, and it accepts the
    // first of these.
    for (const url of [
      "http://picsum.photos/seed/1/600",
      "file:///etc/passwd",
      "gopher://internal/",
      "data:image/png;base64,AAAA",
    ]) {
      expect(isRenderableImageUrl(url), url).toBe(false);
    }
  });

  it("cannot be fooled by credentials smuggling a host", () => {
    expect(
      isRenderableImageUrl("https://picsum.photos@evil.tld/a.png"),
    ).toBe(false);
    expect(
      isRenderableImageUrl(
        "https://abc.public.blob.vercel-storage.com@evil.tld/a.png",
      ),
    ).toBe(false);
  });

  it("requires the dot, so a lookalike host does not pass", () => {
    for (const url of [
      "https://evil-public.blob.vercel-storage.com/a.png",
      "https://notpicsum.photos/a.png",
      "https://picsum.photos.evil.tld/a.png",
    ]) {
      expect(isRenderableImageUrl(url), url).toBe(false);
    }
  });

  it("refuses junk rather than throwing on it", () => {
    for (const value of ["", "not a url", null, undefined, 42, {}]) {
      expect(isRenderableImageUrl(value)).toBe(false);
    }
  });
});

/**
 * "A Vercel Blob host" is not the same claim as "our storage".
 *
 * The suffix check proves the first. Every Vercel account gets a blob store,
 * so a seller could upload to their own, post that URL to `syncFiles`, and
 * have the download route stream arbitrary bytes back under sailo.store's
 * origin and certificate with a filename of their choosing — the platform as
 * an open proxy, which is most of what the check exists to prevent.
 */
describe("isStoredFileUrl pinned to our own store", () => {
  const original = process.env.BLOB_READ_WRITE_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = original;
  });

  it("accepts our store and refuses somebody else's", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Store1Abc_secretpart";
    expect(
      isStoredFileUrl("https://store1abc.public.blob.vercel-storage.com/f.zip"),
    ).toBe(true);
    expect(
      isStoredFileUrl("https://attacker9.public.blob.vercel-storage.com/f.zip"),
    ).toBe(false);
  });

  it("matches the store id regardless of case", () => {
    // `put()` lowercases the host; the token carries the id as minted.
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_MiXeDCase_secret";
    expect(
      isStoredFileUrl("https://mixedcase.public.blob.vercel-storage.com/f.zip"),
    ).toBe(true);
  });

  it("falls back to the host check when no token is configured", () => {
    /*
     * A preview deploy or a local checkout without the variable must not find
     * every already-stored file unreadable. The suffix check is what this had
     * before pinning, so falling back to it loses nothing.
     */
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(
      isStoredFileUrl("https://anystore.public.blob.vercel-storage.com/f.zip"),
    ).toBe(true);
    expect(isStoredFileUrl("https://evil.tld/f.zip")).toBe(false);
  });

  it("falls back rather than refusing everything on an odd token", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "something-else-entirely";
    expect(
      isStoredFileUrl("https://anystore.public.blob.vercel-storage.com/f.zip"),
    ).toBe(true);
  });

  it("still refuses a non-blob host with the token set", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Store1Abc_secretpart";
    for (const url of [
      "https://evil.tld/f.zip",
      "http://store1abc.public.blob.vercel-storage.com/f.zip",
      "https://store1abc.public.blob.vercel-storage.com@evil.tld/f.zip",
    ]) {
      expect(isStoredFileUrl(url), url).toBe(false);
    }
  });
});
