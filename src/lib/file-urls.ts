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

/**
 * *Our* blob store, not merely *a* blob store.
 *
 * The suffix check below says the host is Vercel Blob. It does not say the
 * store is ours, and every Vercel account on the internet gets one — so a
 * seller could upload to their own free store, post that URL to `syncFiles`,
 * and have `/api/download/[token]/[fileId]` stream arbitrary bytes back under
 * sailo.store's origin, our certificate and a filename they choose. That is
 * the platform as an open proxy and as a content-laundering host, which is
 * most of what the original check was written to prevent.
 *
 * `BLOB_READ_WRITE_TOKEN` is `vercel_blob_rw_<storeId>_<secret>`, so the store
 * id is already in the environment and needs no new configuration. Only the id
 * is read; the secret half never leaves this function.
 *
 * Falls back to the suffix check when the token is absent or shaped
 * unexpectedly. That is deliberate: a missing variable in a preview or a local
 * checkout must not make every stored file unreadable, and the suffix check is
 * what this had yesterday.
 */
function storeHostPrefix(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;

  const id = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token)?.[1];
  return id ? `${id.toLowerCase()}${BLOB_HOST_SUFFIX}` : null;
}

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
  if (!url.hostname.endsWith(BLOB_HOST_SUFFIX)) return false;

  const ours = storeHostPrefix();
  return ours === null || url.hostname.toLowerCase() === ours;
}

/**
 * Where a shop's or product's *image* is allowed to live.
 *
 * The same hole as above, in a second place, and reachable far more easily:
 * `lib/og.tsx`'s `fetchImage` fetches whatever URL it is handed, and the two
 * `opengraph-image` routes hand it `shop.avatarUrl` and `product.images[0]`.
 * Those routes are public, unauthenticated and directly requestable, and the
 * fetch is deliberately `cache: "no-store"` — so every request is a fresh
 * outbound one. Storing `http://10.0.0.5:8080/` as an avatar and then loading
 * the card turns the platform into a port scanner with a timing oracle, and
 * into an exfiltration channel for anything that answers with image bytes.
 *
 * The commit that closed the download hole argued the check "belongs where the
 * danger is". `og.tsx` is where the danger is, and it never got one.
 *
 * The allowlist is not invented here — it is the one the product already
 * enforces everywhere else. `next.config.ts` names exactly these three hosts
 * in `images.remotePatterns`, and the CSP names them again in `img-src`, so an
 * image anywhere else already fails to render in every browser. Making the
 * server agree costs nothing that worked before.
 */
const IMAGE_HOSTS = [
  // Vercel Blob — where every upload lands.
  BLOB_HOST_SUFFIX,
  // The demo seeds, which are real shops on the marketing pages.
  ".picsum.photos",
  ".images.unsplash.com",
] as const;

const IMAGE_HOSTS_EXACT = ["picsum.photos", "images.unsplash.com"] as const;

export function isRenderableImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname;
  return (
    IMAGE_HOSTS.some((suffix) => host.endsWith(suffix)) ||
    IMAGE_HOSTS_EXACT.includes(host as (typeof IMAGE_HOSTS_EXACT)[number])
  );
}
