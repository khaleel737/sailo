import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The blocklist check, with DNS replaced.
 *
 * Everything this module does is interpret an answer from a public zone, and
 * the two answers it must never confuse are the two tested first: a
 * `127.x.x.x` A record, which means our domain is listed and mail is being
 * refused, and NXDOMAIN — delivered as a *rejected* promise — which is the
 * ordinary, healthy, "nothing to report" case. Getting the second one wrong
 * either alarms the team daily about a clean domain or, worse, reports a listed
 * one as fine.
 */

const resolve4 = vi.hoisted(() => vi.fn<(name: string) => Promise<string[]>>());
vi.mock("node:dns/promises", () => ({ resolve4 }));

import { checkDomain, checkDomains, listingsIn, sendingDomains } from "./check";

/** What `dns.resolve4` throws when the name does not exist: not listed. */
const nxdomain = () =>
  Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });

/** Answers per zone suffix; anything unmentioned is NXDOMAIN. */
function answering(byZone: Record<string, string[]>) {
  resolve4.mockImplementation(async (name: string) => {
    for (const [zone, answers] of Object.entries(byZone)) {
      if (name.endsWith(`.${zone}`)) return answers;
    }
    throw nxdomain();
  });
}

beforeEach(() => {
  resolve4.mockReset();
});

describe("checkDomain", () => {
  it("reads a 127.x.x.x answer as listed, and keeps the return code", async () => {
    // Spamhaus DBL's "spam domain" code. Deliberately not 127.0.0.x: DBL
    // publishes domain listings in 127.0.1.x, and a checker that only looked
    // at 127.0.0.x would report a blocklisted domain as clean.
    answering({ "dbl.spamhaus.org": ["127.0.1.2"] });

    const result = await checkDomain("sailo.store");

    expect(result.listed).toBe(true);
    const dbl = result.zones.find((zone) => zone.zone === "dbl.spamhaus.org");
    expect(dbl).toMatchObject({ listed: true, code: "127.0.1.2", error: null });
  });

  it("reads NXDOMAIN as clean rather than as a failure", async () => {
    resolve4.mockRejectedValue(nxdomain());

    const result = await checkDomain("sailo.store");

    expect(result.listed).toBe(false);
    expect(result.zones).toHaveLength(2);
    for (const zone of result.zones) {
      expect(zone).toMatchObject({ listed: false, code: null, error: null });
    }
  });

  it("asks each zone for <domain>.<zone>, and asks no more than that", async () => {
    resolve4.mockRejectedValue(nxdomain());

    await checkDomain("Sailo.Store.");

    // Lowercased and stripped of the trailing dot on the way in.
    expect(resolve4.mock.calls.map(([name]) => name)).toEqual([
      "sailo.store.multi.surbl.org",
      "sailo.store.dbl.spamhaus.org",
    ]);
  });

  it("treats 127.255.255.x as the zone refusing to answer, not as a listing", async () => {
    // What both zones return to an open resolver or a querier over quota.
    // Alerting on it would mean a false alarm every morning.
    answering({ "dbl.spamhaus.org": ["127.255.255.254"] });

    const result = await checkDomain("sailo.store");

    expect(result.listed).toBe(false);
    const dbl = result.zones.find((zone) => zone.zone === "dbl.spamhaus.org");
    expect(dbl?.listed).toBe(false);
    expect(dbl?.error).toContain("refused");
  });

  it("ignores an answer outside 127/8, which is a lying resolver", async () => {
    // An ISP resolver that wildcards NXDOMAIN to an ad server answers every
    // query, and would otherwise report every domain as permanently listed.
    answering({ "multi.surbl.org": ["93.184.216.34"] });

    const result = await checkDomain("sailo.store");

    expect(result.listed).toBe(false);
    expect(result.zones[0]?.error).toContain("outside 127/8");
  });

  it("reports a broken lookup as an error, not as a clean domain", async () => {
    resolve4.mockRejectedValue(
      Object.assign(new Error("queryA SERVFAIL"), { code: "SERVFAIL" }),
    );

    const result = await checkDomain("sailo.store");

    expect(result.listed).toBe(false);
    expect(result.zones.every((zone) => zone.error === "SERVFAIL")).toBe(true);
  });
});

describe("checkDomains", () => {
  it("asks about each distinct domain once", async () => {
    resolve4.mockRejectedValue(nxdomain());

    const results = await checkDomains(["sailo.store", "SAILO.STORE", "mail.sailo.store"]);

    expect(results.map((result) => result.domain)).toEqual([
      "sailo.store",
      "mail.sailo.store",
    ]);
    expect(resolve4).toHaveBeenCalledTimes(4);
  });
});

describe("listingsIn", () => {
  it("flattens only what is actually listed", async () => {
    answering({ "multi.surbl.org": ["127.0.0.64"] });

    const listings = listingsIn(await checkDomains(["sailo.store", "mail.sailo.email"]));

    expect(listings).toEqual([
      {
        domain: "sailo.store",
        zone: "multi.surbl.org",
        label: "SURBL",
        code: "127.0.0.64",
      },
      {
        domain: "mail.sailo.email",
        zone: "multi.surbl.org",
        label: "SURBL",
        code: "127.0.0.64",
      },
    ]);
  });
});

const set = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

describe("sendingDomains", () => {
  const original = {
    mail: process.env.SAILO_MAIL_DOMAIN,
    tx: process.env.SAILO_TX_DOMAIN,
    mkt: process.env.SAILO_MKT_DOMAIN,
  };

  beforeEach(() => {
    set("SAILO_MAIL_DOMAIN", undefined);
    set("SAILO_TX_DOMAIN", undefined);
    set("SAILO_MKT_DOMAIN", undefined);
  });

  afterEach(() => {
    set("SAILO_MAIL_DOMAIN", original.mail);
    set("SAILO_TX_DOMAIN", original.tx);
    set("SAILO_MKT_DOMAIN", original.mkt);
  });

  it("checks the brand domain when nothing is configured", () => {
    expect(sendingDomains()).toEqual(["sailo.store"]);
  });

  it("adds the stream domains only when they differ from the brand one", () => {
    process.env.SAILO_TX_DOMAIN = "sailo.store";
    process.env.SAILO_MKT_DOMAIN = "Sailo.Email";

    // The transactional domain defaults to the brand domain; asking twice
    // would spend a query on a zone that throttles to learn nothing.
    expect(sendingDomains()).toEqual(["sailo.store", "sailo.email"]);
  });
});
