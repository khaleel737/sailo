import "server-only";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { isPublicAddress } from "@sailo/core/net";

/**
 * The one guard that has to be shared, and why it is its own file.
 *
 * `post.ts` wrote this for outbound webhooks: a seller types a URL and we POST
 * to it from inside our infrastructure. Spec 47's importer has the identical
 * problem in the other direction — a seller hands us a product image URL from
 * Shopify or Etsy and we *fetch* it — and a second copy of a rebinding guard is
 * a second thing to forget to update. So the hook lives here and both callers
 * import it.
 *
 * Read the long comment below before changing anything in it. The subtlety is
 * not the denylist; it is that the check and the connection have to be the same
 * resolution.
 */

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
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
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

