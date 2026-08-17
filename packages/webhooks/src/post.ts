import "server-only";
import { request as httpsRequest, Agent } from "node:https";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { isPublicAddress } from "@sailo/security/ip-ranges";
import { isPublicLinkUrl } from "@sailo/storage/urls";

/**
 * The one outbound request in this app whose destination is chosen entirely by
 * an untrusted party, and how it is made without becoming a way into our own
 * network.
 *
 * A seller types a URL and we POST to it, repeatedly, from inside our
 * infrastructure. That is server-side request forgery by construction. The
 * guards, and what each one is actually for:
 *
 * 1. **https, port 443, public hostname shape.** Cheap, and refuses the
 *    obvious `http://10.0.0.5:8080/` at save time so the seller is told at the
 *    form rather than in a delivery log.
 * 2. **The address is checked at connect time, not before it.** This is the
 *    one that matters, and it is why this file uses `node:https` rather than
 *    `fetch`. See `guardedLookup` below.
 * 3. **No redirects, ever.** Node's http client does not follow them, which is
 *    exactly what we want: a 302 is chosen by whoever controls the seller's
 *    URL, and following one puts the internal network back in reach one hop
 *    after every check above has passed. A consumer that redirects is
 *    misconfigured, and is told so.
 * 4. **The response body is capped and discarded.** Nothing about it is ever
 *    stored or shown. An SSRF is dangerous in proportion to what the attacker
 *    can read back, and the only thing that survives this function is the
 *    status code.
 */

/** A webhook consumer answers in well under a second, or it is broken. */
const TIMEOUT_MS = 5_000;

/**
 * Read and thrown away — but still capped, because a hostile endpoint that
 * answers 200 and then streams for ever is a memory bill and a held socket.
 */
const MAX_RESPONSE_BYTES = 4 * 1024;

export type PostResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; reason: string };

/**
 * Whether a string is somewhere we are willing to POST.
 *
 * Reuses `isPublicLinkUrl` — https, no loopback, no RFC1918, no link-local, no
 * single-label host — rather than restating it, because a second copy of a
 * denylist is a second thing to forget to update. What it adds is the port.
 *
 * **443 only.** Every hosted consumer a seller will actually paste — Zapier,
 * Make, n8n cloud, Pipedream — is on 443, and a self-hosted one sits behind a
 * proxy that is. What allowing arbitrary ports would buy is the ability to
 * aim this function at any port of any public host and read back the status
 * code and the timing, which is a port scanner with our IP address on it.
 * That trade is bad in both directions, so it is not offered.
 */
export function isWebhookTargetUrl(value: unknown): value is string {
  if (!isPublicLinkUrl(value)) return false;

  const url = new URL(value as string);

  /*
   * Credentials in the URL are refused rather than dropped.
   *
   * `https://user:pass@host/hook` is how some self-hosted consumers express
   * basic auth, and this function does not forward them — the request is built
   * from the hostname and path alone. Accepting the URL and silently ignoring
   * the credential is the worst of the three options: the seller believes
   * their endpoint is authenticated, and it is receiving unauthenticated POSTs
   * from us. Refusing says so at the form.
   *
   * It also closes the reading where somebody assumes the host is the part
   * before the `@`. Nothing here does — `url.hostname` is already the real
   * host — but a stored URL that *looks* like one host and resolves to another
   * is a trap for the next person to read the endpoints table.
   */
  if (url.username || url.password) return false;

  // Empty means the scheme default, which for https is 443.
  return url.port === "" || url.port === "443";
}

/**
 * The DNS hook that closes the rebinding window.
 *
 * The tempting shape is: resolve the hostname, check the addresses, then
 * `fetch` the URL. It does not work. The check and the connection are two
 * separate resolutions, and an attacker who controls the authoritative server
 * for their own domain answers the first with a public address and the second
 * with `169.254.169.254`. A one-second TTL is all it takes, the technique has
 * a name — DNS rebinding — and `docs/specs/16-outbound-webhooks.md` calls it
 * out by name for this reason.
 *
 * `net.connect` accepts a `lookup` function, and the socket is opened to
 * whatever that function returns. Filtering here means the address we approved
 * is the address connected to, with no second resolution in between and
 * therefore no window at all. TLS still validates against the hostname,
 * because the hostname is what we asked for — which is the other reason not to
 * do the naive alternative of connecting to a bare IP with a `Host` header.
 *
 * Both callback shapes are handled: `net.connect` asks with `all: true` when
 * it is doing Happy Eyeballs (the default since Node 20) and `all: false`
 * otherwise, and a hook that only implements one of them fails in production
 * on whichever it did not.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  const refuse = () =>
    callback(
      Object.assign(
        new Error(`refusing to connect to ${hostname}: it resolves inside a private network`),
        { code: "ESSRFBLOCKED" },
      ),
      "",
      undefined,
    );

  /*
   * Cast because `dns.lookup`'s own overloads split on whether `all` is a
   * literal `true` or `false`, and here it is neither — it is whatever
   * `net.connect` decided, which is a plain boolean. The runtime contract is
   * the one `LookupFunction` already describes, so the cast states it once
   * rather than branching the call site to satisfy the type checker.
   */
  const resolve = dnsLookup as (
    host: string,
    opts: LookupOptions,
    cb: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => void;

  resolve(hostname, options, (error, address, family) => {
    if (error) {
      callback(error, "", undefined);
      return;
    }

    if (Array.isArray(address)) {
      /*
       * Filtered rather than all-or-nothing. A host that legitimately answers
       * with both a public and a private address — a split-horizon setup, or
       * an IPv6 ULA alongside a real A record — is still reachable on the
       * public one, and dropping the private entries from the list means Happy
       * Eyeballs can only race candidates we approved.
       */
      const allowed = address.filter((entry) => isPublicAddress(entry.address));
      if (allowed.length === 0) {
        refuse();
        return;
      }
      callback(null, allowed);
      return;
    }

    if (!isPublicAddress(address)) {
      refuse();
      return;
    }
    callback(null, address, family);
  });
};

/**
 * One POST to a seller's endpoint.
 *
 * Never throws. Every outcome — refused URL, blocked address, timeout, a 500
 * from the consumer — comes back as a value, because the caller is a cron tick
 * draining a queue and one bad endpoint must not end the tick for the others.
 */
export async function postWebhook(opts: {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}): Promise<PostResult> {
  if (!isWebhookTargetUrl(opts.url)) {
    return { ok: false, status: null, reason: "that URL is not one we will post to" };
  }

  let url: URL;
  try {
    url = new URL(opts.url);
  } catch {
    return { ok: false, status: null, reason: "unparseable URL" };
  }

  const timeout = opts.timeoutMs ?? TIMEOUT_MS;

  /*
   * A deferred rather than work inside the executor, because six independent
   * callbacks can finish this request — response end, response close, response
   * error, request error, the socket timeout and the overall deadline — and
   * several of them fire in sequence on a single failure. A socket error
   * arriving after the deadline has already answered must not overwrite the
   * reason the caller records, so `settled` is the gate and `settle` is the
   * only thing any handler calls.
   */
  let announce!: (result: PostResult) => void;
  const answered = new Promise<PostResult>((resolve) => {
    announce = resolve;
  });

  let settled = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const settle = (result: PostResult) => {
    if (settled) return;
    settled = true;
    if (deadline) clearTimeout(deadline);
    announce(result);
  };

  const body = Buffer.from(opts.body, "utf8");

  const req = httpsRequest(
    {
      protocol: "https:",
      hostname: url.hostname,
      port: Number(url.port || 443),
      // Query string included: a seller's Zapier hook URL carries one.
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: {
        ...opts.headers,
        "content-type": "application/json; charset=utf-8",
        // Explicit, so the request is never chunked. Some consumers — and
        // more than one WAF in front of them — reject a chunked POST.
        "content-length": String(body.byteLength),
        "user-agent": "Sailo-Webhooks/1.0 (+https://sailo.store)",
        accept: "*/*",
      },
      lookup: guardedLookup,
      /*
       * A fresh agent per request, with keep-alive off.
       *
       * The global agent pools sockets, and a pooled socket is one whose
       * address was checked on some earlier request — possibly to a
       * different path, possibly minutes ago. Reuse is a small saving and it
       * quietly skips the guard above, which is the whole reason this
       * function exists.
       */
      agent: new Agent({ keepAlive: false }),
    },
    (res) => {
      const status = res.statusCode ?? 0;
      let received = 0;

      res.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        // Nothing reads this. The cap is against a consumer that answers and
        // then never stops talking.
        if (received > MAX_RESPONSE_BYTES) res.destroy();
      });

      const finish = () => {
        /*
         * 2xx is delivered. Everything else is not, *including 3xx*: we do
         * not follow redirects, so a 302 means the message went nowhere, and
         * recording it as success would leave a seller watching a green tick
         * for events their tool never received.
         */
        if (status >= 200 && status < 300) {
          settle({ ok: true, status });
        } else {
          settle({
            ok: false,
            status,
            reason:
              status >= 300 && status < 400
                ? `the endpoint redirected (${status}) — point it at the final URL, redirects are not followed`
                : `the endpoint answered ${status}`,
          });
        }
      };

      res.on("end", finish);
      // `destroy()` above ends the stream via `close`, not `end`.
      res.on("close", finish);
      res.on("error", () =>
        settle({ ok: false, status, reason: "the connection dropped mid-response" }),
      );
    },
  );

  /*
   * Two clocks, because they measure different failures. `setTimeout` on the
   * request fires on socket *inactivity*; the deadline below bounds the whole
   * exchange, so an endpoint that dribbles a byte every four seconds cannot
   * hold the tick open indefinitely.
   */
  deadline = setTimeout(() => {
    req.destroy();
    settle({ ok: false, status: null, reason: "the endpoint took too long to answer" });
  }, timeout);

  req.setTimeout(timeout, () => {
    req.destroy();
    settle({ ok: false, status: null, reason: "the endpoint took too long to answer" });
  });

  req.on("error", (error: NodeJS.ErrnoException) => {
    settle({
      ok: false,
      status: null,
      reason:
        error.code === "ESSRFBLOCKED"
          ? "that address is inside a private network"
          : (error.message || "the endpoint could not be reached"),
    });
  });

  req.end(body);

  return answered;
}
