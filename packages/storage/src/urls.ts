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

/** Hostnames that only ever mean "somewhere inside this network". */
const INTERNAL_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".home.arpa",
] as const;

/**
 * IPv4 literals nobody outside the network can reach: loopback, the three
 * RFC1918 blocks, link-local (which is where cloud metadata lives), CGNAT,
 * and "this network".
 */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : NaN,
  );
  if (octets.some((n) => Number.isNaN(n) || n > 255)) return false;

  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * Where a seller's *terms* link is allowed to point.
 *
 * Unlike the two checks above, nothing here is ever fetched server-side — this
 * URL is rendered as an anchor on the public checkout and followed by the
 * buyer's own browser. So the danger is not SSRF but what a link can be: a
 * `javascript:` href is stored XSS on every storefront that opens the basket,
 * and a `http:` one strips the buyer's connection on the page where they are
 * about to type a card number. Requiring https closes both.
 *
 * Internal hosts are refused as well. They cannot serve a buyer anything — the
 * link would dead-end for everyone who isn't inside the seller's network — and
 * a checkbox that claims to link terms nobody can read is worse than a
 * checkbox that links nothing, which is a case this feature already supports.
 *
 * The allowlist approach used for files and images does not transfer: a
 * seller's terms live on the seller's own domain, and there is no set of hosts
 * to enumerate. A denylist is the weaker tool and is chosen knowingly, because
 * the consequence of missing an entry here is a broken link rather than a
 * server-side fetch.
 */
export function isPublicLinkUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  // Bracket-stripped, because `new URL("https://[::1]/")` keeps them.
  const host = url.hostname.toLowerCase().replace(/^\[|]$/g, "");
  if (!host) return false;

  if (host === "localhost") return false;
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;

  // IPv6 loopback, and the unique-local fc00::/7 block.
  if (host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host)) return false;
  if (isPrivateIPv4(host)) return false;

  /*
   * A public name has a dot in it. This is what catches the single-label hosts
   * a corporate resolver completes for itself — `wiki`, `payroll` — which no
   * suffix list can enumerate because each network invents its own.
   */
  return host.includes(".");
}

/**
 * Where a testimonial's video is allowed to live — spec 35.
 *
 * A URL, never an upload: storing video in Blob is a bandwidth bill and a
 * moderation surface for a feature that needs neither. But a URL a seller types
 * is rendered inside an `<iframe>` on a page a *third party* has embedded in
 * their own site, so there are two untrusted parties in the chain before the
 * visitor — and an arbitrary frame source there is a seller's shop being used
 * to serve somebody else's content under somebody else's domain.
 *
 * An allowlist, not a denylist, and a short one. YouTube and Vimeo are what
 * sellers actually paste; anything else is refused with a message rather than
 * stored and silently not rendered. Unlike `isPublicLinkUrl` next door — where
 * a denylist is the weaker tool chosen knowingly, because a seller's terms live
 * on the seller's own domain and there is no set to enumerate — here there
 * genuinely is one.
 *
 * Path-checked as well as host-checked. `youtube.com/@someone` is a channel,
 * not a video, and `frame-src https://www.youtube.com` would let it render as
 * a page inside the wall.
 */
const VIDEO_HOSTS: Record<string, RegExp> = {
  // `/watch?v=…` is the address people copy; `/embed/…` is what an iframe wants.
  "www.youtube.com": /^\/(watch|embed\/[\w-]{6,})$/,
  "youtube.com": /^\/(watch|embed\/[\w-]{6,})$/,
  // The share button's short form.
  "youtu.be": /^\/[\w-]{6,}$/,
  "vimeo.com": /^\/\d+$/,
  "player.vimeo.com": /^\/video\/\d+$/,
};

export function isEmbeddableVideoUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  /*
   * `hostname`, so credentials cannot smuggle a different host past the check:
   * `https://www.youtube.com@evil.tld/` parses with hostname `evil.tld`.
   */
  const pattern = VIDEO_HOSTS[url.hostname.toLowerCase()];
  if (!pattern || !pattern.test(url.pathname)) return false;

  // A `/watch` with no `v` is the YouTube home page.
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v");
    return Boolean(id && /^[\w-]{6,}$/.test(id));
  }
  return true;
}

/**
 * The same video as an address an `<iframe>` can hold, or null.
 *
 * Derived rather than stored: what the seller pasted is what they will
 * recognise if they ever look at the field again, and the embed form is a
 * rendering detail that would go stale the day either site changes it.
 */
export function videoEmbedSrc(value: string): string | null {
  if (!isEmbeddableVideoUrl(value)) return null;
  const url = new URL(value);
  const host = url.hostname.toLowerCase();

  if (host === "youtu.be") {
    return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
  }
  if (host.endsWith("youtube.com")) {
    const id = url.pathname.startsWith("/embed/")
      ? url.pathname.slice("/embed/".length)
      : url.searchParams.get("v");
    // `youtube-nocookie.com`, because this frame renders on a stranger's site
    // and a visitor there did not agree to anything from anybody.
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  const id = url.pathname.replace(/^\/(video\/)?/, "");
  return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
}
