/**
 * Which IP addresses are somewhere on the public internet, and which are
 * somewhere inside a network that trusts us.
 *
 * Two callers, asking the same question at two different moments:
 *
 * - `file-urls.ts` asks it of a **string a seller typed** — a hostname that
 *   happens to be an IP literal. That catches `http://10.0.0.5/` at save time.
 * - `webhooks/connect.ts` asks it of **an address DNS actually returned**, at
 *   the moment the socket is opened. That catches `evil.tld` resolving to
 *   `169.254.169.254`, which no check on a string can see.
 *
 * The second is the one that matters and the first is not sufficient on its
 * own, which is why this file exists rather than a second copy of the octet
 * arithmetic living next to whichever caller was written first.
 *
 * Pure, dependency-free and browser-safe: it takes a string and returns a
 * boolean, so it can be unit-tested exhaustively against the ranges below
 * without a socket or a resolver anywhere near it.
 */

/**
 * IPv4 blocks that are not routable to a stranger on the internet.
 *
 * Each entry is `[first octet match, predicate]` written out longhand rather
 * than as CIDR parsing, because the list is short, fixed, and read far more
 * often than it is changed — and a hand-checked table of ranges is auditable
 * in a way that a CIDR parser with its own edge cases is not.
 *
 * The ones people forget, and why each is here:
 *
 * - `0.0.0.0/8` — "this network". `0.0.0.0` reaches localhost on Linux.
 * - `100.64.0.0/10` — carrier-grade NAT, which is the ISP's network.
 * - `169.254.0.0/16` — link-local, and the cloud metadata endpoint
 *   (`169.254.169.254`) that turns an SSRF into stolen credentials.
 * - `192.0.0.0/24` — IETF protocol assignments, including NAT64 discovery.
 * - `198.18.0.0/15` — benchmarking, routed inside plenty of real networks.
 * - `224.0.0.0/4` and `240.0.0.0/4` — multicast and reserved. Neither is a
 *   place a webhook consumer lives, and multicast in particular is a way to
 *   address many internal hosts with one packet.
 */
function isPublicIPv4(octets: readonly [number, number, number, number]): boolean {
  const [a, b, c] = octets;

  if (a === 0) return false; // 0.0.0.0/8 — "this network"
  if (a === 10) return false; // RFC1918
  if (a === 127) return false; // loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 0 && c === 0) return false; // IETF assignments
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast (224/4) and reserved (240/4)

  return true;
}

/** `"10.0.0.5"` to `[10, 0, 0, 5]`, or null if it is not a dotted quad. */
function parseIPv4(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    /*
     * Strictly decimal, and no leading zeros beyond a bare `0`.
     *
     * `010.0.0.1` is octal to some resolvers and decimal to others, and
     * `0x7f.1` is hexadecimal to a few — the classic SSRF filter bypass is to
     * write a private address in a notation the checker reads one way and the
     * connector reads another. Refusing anything that is not plain decimal
     * means the two cannot disagree.
     */
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }

  return octets as [number, number, number, number];
}

/**
 * Whether an address is one we are willing to open a connection to.
 *
 * Returns **false** for anything it cannot parse. That direction is the whole
 * safety property: an address we do not understand is not an address we have
 * shown to be public, and a guard that fails open on a malformed input is a
 * guard with a bypass rather than a guard.
 */
export function isPublicAddress(value: string): boolean {
  const address = value.trim().toLowerCase();
  if (!address) return false;

  const v4 = parseIPv4(address);
  if (v4) return isPublicIPv4(v4);

  return isPublicIPv6(address);
}

/**
 * IPv6, including the three ways an IPv4 address can be smuggled inside one.
 *
 * `::ffff:169.254.169.254` is the metadata endpoint written as IPv6, and a
 * checker that only knows the `fc00::/7` and `fe80::/10` prefixes waves it
 * straight through. So do 6to4 (`2002::/16`) and NAT64 (`64:ff9b::/96`), both
 * of which carry a v4 address in their body that the network will route to.
 * Each is unwrapped and re-asked as the v4 question rather than trusted.
 */
function isPublicIPv6(address: string): boolean {
  // A zone index (`fe80::1%eth0`) is a local-interface scope by definition.
  if (address.includes("%")) return false;

  const groups = expandIPv6(address);
  if (!groups) return false;

  // `::` and `::1` — the unspecified address and loopback.
  if (groups.every((g) => g === 0)) return false;
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return false;

  const [g0, g1] = groups as [number, number, ...number[]];

  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
  if ((g0 & 0xfe00) === 0xfc00) return false;
  if ((g0 & 0xffc0) === 0xfe80) return false;
  if ((g0 & 0xff00) === 0xff00) return false;

  // ::ffff:0:0/96 — IPv4-mapped. The address is really the v4 in its tail.
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  // 64:ff9b::/96 — NAT64. Same story, different prefix.
  const nat64 =
    g0 === 0x0064 &&
    g1 === 0xff9b &&
    groups.slice(2, 6).every((g) => g === 0);

  if (mapped || nat64) {
    return isPublicIPv4(v4FromGroups(groups[6] ?? 0, groups[7] ?? 0));
  }

  // 2002::/16 — 6to4 carries the v4 in the two groups after the prefix.
  if (g0 === 0x2002) {
    return isPublicIPv4(v4FromGroups(groups[1] ?? 0, groups[2] ?? 0));
  }

  return true;
}

/** Two 16-bit groups back into the four octets they encode. */
function v4FromGroups(hi: number, lo: number): [number, number, number, number] {
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
}

/**
 * An IPv6 string to its eight 16-bit groups, or null if it is not one.
 *
 * Handles the `::` run-length compression and the dotted-quad tail that
 * `::ffff:1.2.3.4` uses. Written out because there is no parser in the
 * platform that returns the groups — `new URL()` will normalise an address but
 * only tells us whether it parsed, not what it contains.
 */
function expandIPv6(address: string): number[] | null {
  const raw = address.replace(/^\[|]$/g, "");
  if (!/^[0-9a-f:.]+$/.test(raw)) return null;

  const halves = raw.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const out: number[] = [];
    const parts = side.split(":");

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] ?? "";
      // A dotted quad is only legal as the very last element.
      if (part.includes(".")) {
        if (i !== parts.length - 1) return null;
        const v4 = parseIPv4(part);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(Number.parseInt(part, 16));
    }
    return out;
  };

  const head = parseSide(halves[0] ?? "");
  const tail = halves.length === 2 ? parseSide(halves[1] ?? "") : [];
  if (!head || !tail) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;

  const missing = 8 - head.length - tail.length;
  // `::` must stand for at least one group, or it is just a stray colon pair.
  if (missing < 1) return null;

  return [...head, ...Array<number>(missing).fill(0), ...tail];
}
