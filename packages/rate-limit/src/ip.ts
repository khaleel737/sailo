/**
 * Who is calling, from proxy headers. Pure — no `next/headers` — so a route
 * handler holding a `Request` can ask the same question a server action asks
 * through `callerIp`, instead of keeping its own copy. The copy this replaces
 * returned `""` for `x-forwarded-for: ",,,"` instead of falling through to
 * `x-real-ip`, and never trimmed the fallback.
 *
 * Only ever a throttling key or a recorded observation. It is not identity
 * and must not gate access to anything: every value here is a header the
 * client can set, and behind a proxy the honest one is whatever that proxy
 * wrote.
 */

/** The first address in the forwarding chain — the client, not the proxies. */
export function ipFromHeaders(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    /*
     * `x-forwarded-for: client, proxy1, proxy2`. Each hop appends, so the
     * client sits first. Taking the last would key every request behind a
     * proxy to the same bucket and throttle a whole network as one caller.
     */
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}
