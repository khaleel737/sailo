import { describe, expect, it, vi } from "vitest";
import { BLOB_HOST_SUFFIX, isBlobUrl } from "./blobs";

/**
 * Which stored URLs name an object we could plausibly delete.
 *
 * This is deliberately *not* the same question as `isStoredFileUrl` in
 * `@sailo/storage/urls`, and not a copy of it. That one guards a server-side fetch
 * against SSRF and has to be strict about which store a URL belongs to. This one only
 * decides what to hand `del()`, and `del()` is already scoped to our own store by
 * `BLOB_READ_WRITE_TOKEN` — it cannot reach another account's objects however this
 * answers.
 *
 * So what is being tested is not a security boundary; it is a filter that keeps the
 * deletion from wasting a failed API call per seeded demo image, and from passing junk
 * into a call that would then fail for the whole batch. The lookalike cases are here
 * because `endsWith` is the correct check and `includes` is the one somebody writes by
 * accident — and nothing else in the file would notice the difference.
 */

const ours = (path: string) => `https://abc123${BLOB_HOST_SUFFIX}/${path}`;

vi.mock("@sailo/db", () => ({ getDb: () => ({}) }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));

describe("what counts as ours", () => {
  it("accepts an object in our store", () => {
    expect(isBlobUrl(ours("shop/logo.png"))).toBe(true);
  });

  it("accepts one with a query string, which a signed URL carries", () => {
    expect(isBlobUrl(`${ours("f.pdf")}?download=1`)).toBe(true);
  });
});

describe("what is skipped", () => {
  it("skips nothing at all", () => {
    expect(isBlobUrl(null)).toBe(false);
    expect(isBlobUrl(undefined)).toBe(false);
    expect(isBlobUrl("")).toBe(false);
  });

  /*
   * The seeded demo images. Not ours, and each one would cost a failed API call on the
   * way out of a deletion that is already doing a lot.
   */
  it("skips the seeded demo images", () => {
    expect(isBlobUrl("https://picsum.photos/seed/1/600")).toBe(false);
    expect(isBlobUrl("https://images.unsplash.com/photo-1")).toBe(false);
  });

  it("skips a relative path, which names nothing a blob API understands", () => {
    expect(isBlobUrl("/uploads/logo.png")).toBe(false);
  });

  it("skips a string that is not a URL rather than throwing", () => {
    // These come out of a database column, so "not a URL" is a state that exists.
    expect(isBlobUrl("not a url")).toBe(false);
    expect(isBlobUrl("javascript:alert(1)")).toBe(false);
  });

  /*
   * `http:` on our own host. Our store is served over TLS, so this is either an old row
   * or somebody's mistake; either way the scheme check is one line and there is no
   * reason for it not to hold.
   */
  it("skips plain http, even on our own host", () => {
    expect(isBlobUrl(`http://abc123${BLOB_HOST_SUFFIX}/x.png`)).toBe(false);
  });
});

describe("hostnames that look like ours", () => {
  /*
   * THE CASE THAT DECIDES `endsWith` FROM `includes`
   *
   * An attacker-controlled host with our suffix in the *middle* of it. `includes` would
   * accept every one of these; `endsWith` rejects them all. Nothing else in the file
   * distinguishes the two implementations, which is why they are pinned here.
   */
  it("rejects our suffix appearing anywhere but the end", () => {
    for (const host of [
      `abc123${BLOB_HOST_SUFFIX}.attacker.example`,
      `attacker.example/abc123${BLOB_HOST_SUFFIX}`,
      `evil-${BLOB_HOST_SUFFIX.slice(1)}.co`,
    ]) {
      expect(isBlobUrl(`https://${host}/x.png`), host).toBe(false);
    }
  });

  /*
   * And the suffix begins with a dot for a reason: without it,
   * `notpublic.blob.vercel-storage.com` would match a suffix of
   * `public.blob.vercel-storage.com`.
   */
  it("requires the suffix to start at a label boundary", () => {
    expect(BLOB_HOST_SUFFIX.startsWith(".")).toBe(true);
    expect(isBlobUrl("https://notpublic.blob.vercel-storage.com/x.png")).toBe(false);
  });

  it("rejects the bare suffix with no store id in front of it", () => {
    expect(isBlobUrl(`https://${BLOB_HOST_SUFFIX.slice(1)}/x.png`)).toBe(false);
  });
});

describe("as a type guard", () => {
  /*
   * It is declared `value is string`, and `collectBlobUrls` relies on that to hand
   * `(string | null)[]` straight to `.filter(isBlobUrl)` and get `string[]` back. If it
   * ever stopped narrowing, the nulls would reach `del()` at runtime while the types
   * still looked right.
   */
  it("narrows a nullable list to strings", () => {
    const mixed: (string | null)[] = [ours("a.png"), null, "https://picsum.photos/1", ours("b.png")];

    const kept: string[] = mixed.filter(isBlobUrl);

    expect(kept).toEqual([ours("a.png"), ours("b.png")]);
  });
});
