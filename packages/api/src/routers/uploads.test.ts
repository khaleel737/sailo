import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The upload token, in the ways it can be too generous.
 *
 * This procedure hands out a credential and then never sees what is done with
 * it, so every property worth having is a property of the token: which path it
 * may write, which media types it may carry, how big, for how long. A bug here
 * is not a failed request — it is a token that quietly permits something the
 * browser's upload route spent a commit refusing.
 *
 * `@vercel/blob/client` is mocked so the constraints can be read back exactly
 * as they were handed to it. Nothing here talks to Blob, and nothing needs to:
 * what is under test is what we *ask* for, and Vercel enforcing it is Vercel's
 * side of the contract.
 */

const generateClientTokenFromReadWriteToken = vi.fn(async () => "vercel_blob_client_stub");
vi.mock("@vercel/blob/client", () => ({ generateClientTokenFromReadWriteToken }));

const rateLimit = vi.fn(async () => ({ allowed: true, remaining: 59 }));
vi.mock("@sailo/rate-limit", () => ({ rateLimit }));

const { uploadsRouter } = await import("./uploads");

const SHOP = "11111111-1111-4111-8111-111111111111";

const caller = (shopId: string | null = SHOP) =>
  uploadsRouter.createCaller({ shopId });

/** The options the procedure handed Vercel on the last call. */
function lastToken() {
  const call = generateClientTokenFromReadWriteToken.mock.calls.at(-1);
  return (call as unknown as [Record<string, unknown>])[0];
}

beforeEach(() => {
  generateClientTokenFromReadWriteToken.mockClear();
  rateLimit.mockClear();
  rateLimit.mockResolvedValue({ allowed: true, remaining: 59 });
});

describe("what the token refuses", () => {
  /*
   * The reason the allowlist exists. Blobs are served from Sailo's own domain,
   * so an uploaded `.html` or `.svg` is stored cross-site scripting against
   * every seller — which is why `apps/web/src/app/api/upload/route.ts` refuses
   * them on the browser path. A token minted here that permitted one would
   * reopen that hole from the phone, where nobody would think to look.
   */
  it.each([
    "text/html",
    "image/svg+xml",
    "application/xhtml+xml",
    "text/javascript",
    "application/javascript",
  ])("refuses %s, which a browser would execute", async (contentType) => {
    await expect(
      caller().token({ purpose: "download", contentType, filename: "x.html" }),
    ).rejects.toThrow(/can't be delivered/i);

    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
  });

  it("refuses a document on the image path, even though downloads allow it", async () => {
    // The two allowlists are not the same list, and a product photo is not a
    // place to put a PDF. Asking as `image` gets the narrower answer.
    await expect(
      caller().token({
        purpose: "image",
        contentType: "application/pdf",
        filename: "brochure.pdf",
      }),
    ).rejects.toThrow(/JPG, PNG, WebP, GIF or AVIF/);
  });

  it("refuses a caller with no shop", async () => {
    await expect(
      caller(null).token({
        purpose: "image",
        contentType: "image/png",
        filename: "a.png",
      }),
    ).rejects.toThrow(/Sign in/);
  });

  it("refuses once the shop has spent its upload budget", async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    await expect(
      caller().token({
        purpose: "image",
        contentType: "image/png",
        filename: "a.png",
      }),
    ).rejects.toThrow(/Too many uploads/);
  });
});

describe("what the token permits", () => {
  it("writes only inside the caller's own shop folder", async () => {
    await caller().token({
      purpose: "image",
      contentType: "image/webp",
      filename: "photo.WEBP",
    });

    const opts = lastToken();
    // The shop id comes from the session; there is no input that could carry
    // another one, and the path is exact rather than a prefix.
    expect(opts.pathname).toMatch(
      new RegExp(`^shops/${SHOP}/[0-9a-f-]{36}\\.webp$`),
    );
    expect(opts.addRandomSuffix).toBe(false);
    // A leaked token must not be able to overwrite an object that exists.
    expect(opts.allowOverwrite).toBe(false);
  });

  it("files a download under the downloads folder", async () => {
    await caller().token({
      purpose: "download",
      contentType: "application/pdf",
      filename: "guide.pdf",
    });

    expect(lastToken().pathname).toMatch(
      new RegExp(`^shops/${SHOP}/downloads/[0-9a-f-]{36}\\.pdf$`),
    );
  });

  it("carries the one media type it was asked for, not the whole allowlist", async () => {
    await caller().token({
      purpose: "image",
      contentType: "image/png",
      filename: "a.png",
    });

    expect(lastToken().allowedContentTypes).toEqual(["image/png"]);
  });

  it("carries the same ceilings the web route enforces", async () => {
    const image = await caller().token({
      purpose: "image",
      contentType: "image/png",
      filename: "a.png",
    });
    expect(lastToken().maximumSizeInBytes).toBe(8 * 1024 * 1024);
    expect(image.maxBytes).toBe(8 * 1024 * 1024);

    const download = await caller().token({
      purpose: "download",
      contentType: "video/mp4",
      filename: "class.mp4",
    });
    expect(lastToken().maximumSizeInBytes).toBe(100 * 1024 * 1024);
    expect(download.maxBytes).toBe(100 * 1024 * 1024);
  });

  it("expires in minutes, not hours", async () => {
    const before = Date.now();
    const issued = await caller().token({
      purpose: "download",
      contentType: "application/zip",
      filename: "pack.zip",
    });

    /*
     * The generous end of the two, and still well short of an hour — the app
     * asks for one of these per upload, so a long life buys nothing and leaves
     * a usable write credential lying around. Bounded on both sides: the clock
     * moves between `before` and the procedure's own `Date.now()`, so an
     * equality here would fail whenever that crossed a millisecond.
     */
    const life = issued.expiresAt - before;
    expect(life).toBeGreaterThanOrEqual(20 * 60 * 1000);
    expect(life).toBeLessThan(21 * 60 * 1000);
    expect(lastToken().validUntil).toBe(issued.expiresAt);
  });

  it("does not let a filename escape the path it was given", async () => {
    // The extension is cosmetic, but it is still concatenated into a string we
    // are about to sign — so it may not contribute a slash, a query or a dot.
    await caller().token({
      purpose: "image",
      contentType: "image/jpeg",
      filename: "../../etc/passwd.jpg?x=1",
    });

    expect(lastToken().pathname).toMatch(
      new RegExp(`^shops/${SHOP}/[0-9a-f-]{36}\\.jpg$`),
    );
  });

  it("falls back to a harmless extension when there is nothing usable", async () => {
    await caller().token({
      purpose: "image",
      contentType: "image/gif",
      filename: "screenshot",
    });

    expect(lastToken().pathname).toMatch(
      new RegExp(`^shops/${SHOP}/[0-9a-f-]{36}\\.bin$`),
    );
  });
});
