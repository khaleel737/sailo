import "server-only";
import { get as httpsGet, Agent } from "node:https";
import { isPublicLinkUrl } from "@sailo/storage/urls";
import { guardedLookup } from "./lookup";

/**
 * Fetching bytes from a URL a seller supplied, without becoming a way into our
 * own network.
 *
 * Written for spec 47's importer, which is handed product image URLs on
 * `cdn.shopify.com` and has to re-host them. `PRODUCTION-PLAN.md` §2 item 2 is
 * the warning: `lib/og.tsx` fetched any URL it was handed and four write paths
 * had to be fixed afterwards.
 *
 * **`node:https` and not `fetch`, for the same reason `postWebhook` uses it.**
 * The tempting shape is resolve, check, then fetch — and it does not work,
 * because the check and the connection are two separate resolutions and
 * whoever controls the domain answers the second with `169.254.169.254`. The
 * `lookup` hook is what makes the address we approved the address we connect
 * to, with no window between them and TLS still validating against the
 * hostname.
 *
 * The differences from `postWebhook`, and each is because this one reads a body
 * back:
 *
 * 1. **Redirects are followed, by hand, up to a small limit.** A webhook
 *    endpoint that redirects is misconfigured; a CDN image URL that redirects
 *    is ordinary — Shopify and Etsy both do it. Every hop is re-checked with
 *    the same rule as the first, which is the only safe way to follow one.
 * 2. **The body comes back**, capped. That is the whole point, and it is also
 *    what makes an SSRF here worse than one that only leaks a status code —
 *    hence the cap, the timeout, and the content-type check at the caller.
 */

/** Enough for a product photo; far short of a memory bill. */
const MAX_BYTES = 12 * 1024 * 1024;

/** An import chunk waits on this per image, so it cannot be generous. */
const TIMEOUT_MS = 10_000;

/** What a CDN actually uses. More than this is a loop or a trap. */
const MAX_REDIRECTS = 3;

export type FetchedBytes =
  | { ok: true; body: Buffer; contentType: string | null }
  | { ok: false; reason: string };

/**
 * Whether a string is somewhere we are willing to fetch from.
 *
 * `isPublicLinkUrl` is the same denylist the terms link and the calendar feed
 * use — https, no loopback, no RFC1918, no link-local, no single-label host —
 * reused rather than restated, because a second copy of a denylist is a second
 * thing to forget to update. What it adds is the port: **443 only**, so this
 * cannot be aimed at an arbitrary port of a public host and used as a port
 * scanner with our IP address on it.
 */
export function isFetchableUrl(value: unknown): value is string {
  if (!isPublicLinkUrl(value)) return false;
  const url = new URL(value as string);
  // Credentials are refused rather than dropped: a URL that looks like one
  // host and connects to another is a trap for whoever reads it next.
  if (url.username || url.password) return false;
  return url.port === "" || url.port === "443";
}

/** One hop. Never throws; every outcome is a value. */
function once(url: string): Promise<
  | { kind: "body"; body: Buffer; contentType: string | null }
  | { kind: "redirect"; to: string }
  | { kind: "error"; reason: string }
> {
  return new Promise((resolve) => {
    const target = new URL(url);
    let settled = false;
    const done = (value: Awaited<ReturnType<typeof once>>) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const request = httpsGet(
      {
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        port: 443,
        headers: {
          // Named, because a CDN that blocks unknown agents should block a
          // name we can be asked about rather than an empty string.
          "User-Agent": "Sailo-Import/1.0 (+https://sailo.store)",
          Accept: "image/*",
        },
        timeout: TIMEOUT_MS,
        agent: new Agent({ lookup: guardedLookup, keepAlive: false }),
      },
      (response) => {
        const status = response.statusCode ?? 0;

        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.resume();
          if (!location) return done({ kind: "error", reason: "redirect with no target" });
          return done({ kind: "redirect", to: new URL(location, url).toString() });
        }

        if (status < 200 || status >= 300) {
          response.resume();
          return done({ kind: "error", reason: `answered ${status}` });
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > MAX_BYTES) {
            /*
             * Destroyed rather than merely stopped reading. A hostile endpoint
             * that answers 200 and then streams for ever is a held socket as
             * well as a memory bill, and only `destroy` gives both back.
             */
            request.destroy();
            return done({ kind: "error", reason: "too large" });
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          done({
            kind: "body",
            body: Buffer.concat(chunks),
            contentType: response.headers["content-type"] ?? null,
          }),
        );
        response.on("error", (error) => done({ kind: "error", reason: error.message }));
      },
    );

    request.on("timeout", () => {
      request.destroy();
      done({ kind: "error", reason: "timed out" });
    });
    request.on("error", (error: NodeJS.ErrnoException) =>
      done({
        kind: "error",
        reason:
          error.code === "ESSRFBLOCKED"
            ? "that address is not one we will fetch from"
            : error.message,
      }),
    );
  });
}

/**
 * Bytes from a seller-supplied URL, or a reason.
 *
 * Never throws. The caller is a chunked import loop, and one unreachable image
 * must fail that row rather than the job — which is spec 47's own rule and the
 * difference between a seller getting 199 of 200 products and getting none.
 */
export async function fetchGuarded(url: string): Promise<FetchedBytes> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // Re-checked on every hop, not only the first. A 302 is chosen by whoever
    // controls the URL, and following one unchecked puts the internal network
    // back in reach one hop after every guard above has passed.
    if (!isFetchableUrl(current)) {
      return { ok: false, reason: "that isn't a URL we will fetch from" };
    }

    const result = await once(current);
    if (result.kind === "body") {
      return { ok: true, body: result.body, contentType: result.contentType };
    }
    if (result.kind === "error") return { ok: false, reason: result.reason };
    current = result.to;
  }

  return { ok: false, reason: "too many redirects" };
}
