/**
 * Whether a connection string points at a database on this machine.
 *
 * Three callers ask this, and they are the three places where being wrong is
 * expensive: `src/db/index.ts` uses it to decide whether to route through the
 * local Neon HTTP proxy, `e2e/scenarios/local-only.ts` to refuse to run a
 * writing test suite anywhere else, and `scripts/check-load.ts` to refuse to
 * generate load against a database taking real orders. Each had its own copy
 * of the same triple, which is one loopback form away from disagreeing —
 * and the disagreement would surface as a test suite happily writing to
 * production, not as a failure.
 *
 * The hostname is parsed rather than matched as a substring. `url.includes(
 * "localhost")` is true for `postgres://user@localhost.attacker.example/db`,
 * and a guard someone else can register a domain to walk past is not a guard.
 *
 * Only the predicate is shared. What each caller does about the answer — warn,
 * refuse, configure a proxy, honour an override — stays with the caller,
 * because those are three different policies about one fact.
 */
export function isLocalDatabaseUrl(url: string): boolean {
  return localHostname(url) !== null;
}

/**
 * The hostname, when it is this machine, and `null` otherwise — including when
 * the string will not parse, since a connection string we cannot read is not
 * one we can vouch for.
 *
 * Callers that refuse want to name the host they refused, and re-parsing to
 * get it invites the two parses to disagree.
 */
export function localHostname(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  // WHATWG `hostname` keeps the brackets on an IPv6 literal.
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
    ? host
    : null;
}

/** The host a connection string names, for an error message. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "an unparseable URL";
  }
}
