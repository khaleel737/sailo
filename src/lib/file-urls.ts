/**
 * Where a product's downloadable file is allowed to live.
 *
 * `/api/download/[token]/[fileId]` fetches this URL **server-side** and streams
 * the response back to whoever asked. That makes the stored value a
 * server-side request the seller gets to compose, and the seller is not a
 * trusted party: signup is open, so anyone can become one.
 *
 * The save path used to check only that the string started with `http`. A
 * seller could therefore post any URL to the action — the form's upload widget
 * is irrelevant, since a server action takes whatever the client sends — and
 * then buy their own product to make the server fetch it and hand back the
 * body. That is server-side request forgery with the response exfiltrated:
 * cloud metadata endpoints, anything else reachable from the function, and the
 * platform itself used as an open proxy.
 *
 * Uploads go through `@vercel/blob`'s `put()`, which always returns a URL on
 * the blob store's own host. Requiring that host is what makes the stored URL
 * a fact about our storage rather than an instruction from a seller.
 */

const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export function isStoredFileUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // https only. The bytes are paid-for goods and the fetch is ours to make.
  if (url.protocol !== "https:") return false;

  /*
   * `hostname` rather than the raw string, so credentials cannot smuggle a
   * different host past a substring check: `https://x.public.blob.vercel-
   * storage.com@evil.tld/` parses with hostname `evil.tld`, which fails here.
   *
   * The leading dot matters too — without it `evil-public.blob.vercel-
   * storage.com` would pass.
   */
  return url.hostname.endsWith(BLOB_HOST_SUFFIX);
}
