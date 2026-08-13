import "server-only";
import { resolve4 } from "node:dns/promises";

/**
 * Whether the domains we send mail from are on a public blocklist — asked once
 * a day, by us, instead of being answered for us by a mailbox provider.
 *
 * The failure this exists to catch is the one described in `email/transport.ts`:
 * a sending domain earns complaints, a blocklist picks it up, and from that
 * moment mail either lands in spam or is refused at the door. Nothing in the
 * app can see it happen. Resend reports a delivery as accepted, the seller sees
 * no error, and the first real evidence is a customer saying they never got
 * their receipt — weeks later, by which time the listing has aged into
 * reputation damage that takes months to undo. A listing is a *published fact*
 * about our domain, available over DNS for the cost of one query, so the only
 * reason not to know is not having asked.
 *
 * **Domain lists only.** SURBL and Spamhaus DBL list domains — things we own
 * and control. The IP-based lists (Zen, SpamCop, Barracuda) list the sending
 * IP, and Resend sends from shared IPs that are neither ours to check nor ours
 * to fix; a listing there would be a fact about Resend's neighbours, actionable
 * only by Resend, and alerting on it would be noise on somebody else's problem.
 *
 * **Kept small on purpose.** Both zones are free for low-volume manual-scale
 * use and both throttle — and Spamhaus in particular returns an error code
 * rather than an answer once a querier looks like a service. Two zones times at
 * most three domains, once a day, is well inside what a public zone tolerates.
 * If a third zone is ever added, it belongs here rather than in a second caller.
 */

/**
 * The zones, and the shape of the answer each one gives.
 *
 * `label` is what a human reads in the alert; `host` is what gets queried.
 */
const ZONES = [
  { host: "multi.surbl.org", label: "SURBL" },
  { host: "dbl.spamhaus.org", label: "Spamhaus DBL" },
] as const;

/** One zone's verdict on one domain. */
export type ZoneResult = {
  /** The zone queried, e.g. `dbl.spamhaus.org`. */
  zone: string;
  /** The human name of that zone, for the alert. */
  label: string;
  listed: boolean;
  /** The 127.x.x.x answer that says *why*, when there is one. */
  code: string | null;
  /**
   * Set when the zone did not give a usable answer at all. Distinct from
   * `listed: false`, which is a real "this domain is clean".
   */
  error: string | null;
};

export type DomainResult = {
  domain: string;
  listed: boolean;
  zones: ZoneResult[];
};

/** A single (domain, zone) listing — what an alert is actually about. */
export type Listing = {
  domain: string;
  zone: string;
  label: string;
  code: string;
};

/**
 * The domains this deployment sends mail from.
 *
 * The brand domain always, because by default both mail streams are on it and
 * because it is the one the *website* answers on — the domain whose suspension
 * takes the shop down with the mail. `SAILO_TX_DOMAIN` and `SAILO_MKT_DOMAIN`
 * only once they are set to something else, since unset they resolve to the
 * brand domain and would just be the same query twice.
 *
 * Read at call time rather than at module load so a test can set them.
 */
export function sendingDomains(): string[] {
  const domains = [normalise(process.env.SAILO_MAIL_DOMAIN ?? "sailo.store")];

  for (const key of ["SAILO_TX_DOMAIN", "SAILO_MKT_DOMAIN"] as const) {
    const value = normalise(process.env[key] ?? "");
    if (value && !domains.includes(value)) domains.push(value);
  }

  return domains.filter(Boolean);
}

/** Lowercased, trimmed, and without the trailing dot of an absolute name. */
function normalise(domain: string) {
  return domain.trim().toLowerCase().replace(/\.+$/, "");
}

/**
 * Checks one domain against every zone.
 *
 * Sequential rather than parallel: two queries is not a latency problem worth
 * solving, and firing everything at once at a zone that throttles is how a
 * checker earns the `127.255.255.254` "you are querying too much" answer that
 * makes the whole check useless.
 */
export async function checkDomain(domain: string): Promise<DomainResult> {
  const name = normalise(domain);
  const zones: ZoneResult[] = [];

  for (const zone of ZONES) {
    zones.push(await checkZone(name, zone));
  }

  return { domain: name, listed: zones.some((zone) => zone.listed), zones };
}

/** The same, for every domain we send from. Duplicates are asked about once. */
export async function checkDomains(domains: string[]): Promise<DomainResult[]> {
  const unique = [...new Set(domains.map(normalise))].filter(Boolean);

  const results: DomainResult[] = [];
  for (const domain of unique) {
    results.push(await checkDomain(domain));
  }
  return results;
}

/** Every listing across a set of results, flattened for alerting and storage. */
export function listingsIn(results: DomainResult[]): Listing[] {
  return results.flatMap((result) =>
    result.zones
      .filter((zone) => zone.listed)
      .map((zone) => ({
        domain: result.domain,
        zone: zone.zone,
        label: zone.label,
        code: zone.code ?? "",
      })),
  );
}

async function checkZone(
  domain: string,
  zone: (typeof ZONES)[number],
): Promise<ZoneResult> {
  const base = { zone: zone.host, label: zone.label };
  if (!domain) return { ...base, listed: false, code: null, error: "no domain" };

  try {
    /*
     * The whole protocol: a listing is published as an A record on
     * `<domain>.<zone>`. No API key, no HTTP, no rate-limit header to respect
     * beyond asking rarely.
     */
    const answers = await resolve4(`${domain}.${zone.host}`);
    return { ...base, ...classify(answers) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;

    /*
     * **The clean path is an exception**, and that is the single easiest thing
     * to get wrong here. "Not listed" is NXDOMAIN — the name does not exist —
     * which `resolve4` reports by rejecting with ENOTFOUND. ENODATA is the same
     * answer with the name present but no A record. Treating either as a
     * failure would make a healthy domain look unknown every single day, and an
     * alert that fires when everything is fine is one nobody reads.
     */
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ...base, listed: false, code: null, error: null };
    }

    // SERVFAIL, a timeout, no resolver at all: we did not learn anything.
    // Reported rather than swallowed, because "the check stopped working" and
    // "the domain is clean" must not look the same on the health page.
    return {
      ...base,
      listed: false,
      code: null,
      error: code ?? (error instanceof Error ? error.message : "lookup failed"),
    };
  }
}

/**
 * What the returned addresses mean.
 *
 * Three cases, and the two that are not "listed" both matter:
 *
 * 1. **`127.255.255.x` is not a listing.** It is how both zones say they are
 *    refusing the query — open resolver, over quota, or a public DNS provider
 *    they have blocked wholesale. Reading it as a listing would page everyone
 *    every morning about a domain that is fine, which is exactly how an alert
 *    gets muted. Checked first, because it is inside 127/8 like a real answer.
 *
 * 2. **Anything outside 127/8 is not a listing either.** A resolver that
 *    wildcards NXDOMAIN to an ad server — some ISP and captive-portal resolvers
 *    still do — answers *every* query with a real IP, which would report every
 *    domain as listed forever. The 127/8 requirement is what makes that fail
 *    safe instead of loud.
 *
 * 3. **Any other 127.x.x.x is a listing**, and the address itself is the
 *    reason. Deliberately not narrowed to `127.0.0.x`: SURBL answers in that
 *    range, but Spamhaus DBL publishes domain listings as `127.0.1.2` (spam),
 *    `127.0.1.4` (phish), `127.0.1.5` (malware), `127.0.1.6` (botnet C&C) and
 *    the `127.0.1.10x` "abused legitimate" codes. A strict `127.0.0.` test
 *    would silently miss every real DBL listing — a checker that reports clean
 *    while the domain is blocklisted, which is worse than no checker.
 */
function classify(answers: string[]): Pick<ZoneResult, "listed" | "code" | "error"> {
  const local = answers.filter((address) => address.startsWith("127."));

  const refused = local.filter((address) => address.startsWith("127.255.255."));
  if (refused.length > 0) {
    return {
      listed: false,
      code: null,
      error: `the zone refused the query (${refused.join(", ")})`,
    };
  }

  if (local.length === 0) {
    return {
      listed: false,
      code: null,
      error:
        answers.length > 0
          ? `unexpected answer outside 127/8 (${answers.join(", ")})`
          : "no answer",
    };
  }

  return { listed: true, code: local.join(", "), error: null };
}
