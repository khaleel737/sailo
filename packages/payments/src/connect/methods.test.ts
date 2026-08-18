import { describe, expect, it } from "vitest";
import { CONNECT_RAILS, sellerRails } from "./methods";
import { capabilitiesFor, type CapabilityFacts } from "./capabilities";

/**
 * The question this file answers is not "may the seller take iDEAL" — that is
 * `capabilities.ts` — but "will a buyer ever be shown it", and the two come
 * apart on currency.
 *
 * Measured on a sandbox, one connected account, two Checkout Sessions:
 *
 *     eur -> ['card', 'bancontact', 'ideal', 'link']
 *     usd -> ['card', 'link', 'cashapp']
 *
 * Same account, same capabilities, same country. Only the presentment currency
 * changed. A shop that prices in USD cannot offer iDEAL to anyone, and no
 * amount of capability work changes that.
 */

/** The rails a buyer would actually be offered, which is the interesting set. */
function live(opts: Parameters<typeof sellerRails>[0]) {
  return sellerRails(opts).filter((rail) => rail.state === "live");
}

function facts(entries: Record<string, Partial<CapabilityFacts>>) {
  return new Map(
    Object.entries(entries).map(([name, over]) => [
      name,
      { name, status: "active", disabledReason: null, currentlyDue: [], ...over },
    ]),
  );
}

const EUROPEAN_SELLER = facts({
  card_payments: {},
  link_payments: {},
  sepa_debit_payments: {},
  ideal_payments: {},
  bancontact_payments: {},
});

describe("sellerRails", () => {
  it("offers iDEAL to a shop that prices in euros", () => {
    const rails = live({ currency: "eur", facts: EUROPEAN_SELLER });
    expect(rails.map((r) => r.type)).toContain("ideal");
  });

  it("does not offer iDEAL to a shop that prices in dollars, however active it is", () => {
    /*
     * The finding that matters most, and the one no amount of capability
     * work fixes. `ideal_payments` is `active` in both cases below.
     */
    const rails = sellerRails({ currency: "usd", facts: EUROPEAN_SELLER });
    const ideal = rails.find((r) => r.type === "ideal");

    expect(ideal?.state).toBe("off_currency");
    expect(ideal?.currencies).toEqual(["eur"]);
    expect(live({ currency: "usd", facts: EUROPEAN_SELLER }).map((r) => r.type))
      .not.toContain("ideal");
  });

  it("keeps the two that travel with any currency in both", () => {
    for (const currency of ["usd", "eur", "gbp", "jpy"]) {
      const offered = live({ currency, facts: EUROPEAN_SELLER }).map((r) => r.type);
      expect(offered).toContain("card");
      expect(offered).toContain("link");
    }
  });

  it("is case-insensitive about the currency, because order rows are not", () => {
    // `order.currency` is upper case in the database and lower case on its way
    // to Stripe. A rail that vanished depending on which one reached here
    // would be the sort of bug that only shows up for one seller.
    expect(live({ currency: "EUR", facts: EUROPEAN_SELLER }).map((r) => r.type))
      .toContain("ideal");
  });

  it("names the fields when Stripe is waiting on the seller", () => {
    const blocked = sellerRails({
      currency: "eur",
      facts: facts({
        card_payments: {},
        ideal_payments: {
          status: "inactive",
          disabledReason: "requirements.fields_needed",
          currentlyDue: ["individual.id_number"],
        },
      }),
    });

    const ideal = blocked.find((r) => r.type === "ideal");
    expect(ideal?.state).toBe("blocked");
    expect(ideal?.currentlyDue).toEqual(["individual.id_number"]);
  });

  it("does not tell a blocked rail it is also in the wrong currency", () => {
    // Two problems reported at once, of which only one can be acted on, is a
    // worse screen than one problem reported.
    const rails = sellerRails({
      currency: "usd",
      facts: facts({
        ideal_payments: {
          status: "inactive",
          disabledReason: "requirements.fields_needed",
          currentlyDue: ["individual.id_number"],
        },
      }),
    });
    expect(rails.find((r) => r.type === "ideal")?.state).toBe("blocked");
  });

  it("says nothing at all about a rail this seller was never asked for", () => {
    /*
     * A US seller does not want a line explaining that Bancontact is off. The
     * list is for acting on, so an entry nobody can act on is noise.
     */
    const rails = sellerRails({
      currency: "usd",
      facts: facts({
        card_payments: {},
        bancontact_payments: { status: "unrequested" },
      }),
    });
    expect(rails.map((r) => r.type)).toEqual(["card"]);
  });

  it("reports a rejected rail as unavailable rather than hiding it", () => {
    // It was requested once, so a seller who saw it may wonder where it went.
    const rails = sellerRails({
      currency: "pln",
      facts: facts({
        p24_payments: { status: "inactive", disabledReason: "rejected.unsupported_business" },
      }),
    });
    expect(rails.find((r) => r.type === "p24")?.state).toBe("unavailable");
  });
});

describe("the platform's own switch", () => {
  /*
   * The third gate, and the one nothing on the connected account reveals.
   * `sepa_debit` is off in Sailo's payment method configuration, so
   * `sepa_debit_payments` went active on every European account and no buyer
   * was ever shown the rail. The panel called it live, which was a lie the
   * seller had no way to check.
   */
  it("drops a rail the platform has switched off, however active it is", () => {
    const rails = sellerRails({
      currency: "eur",
      facts: EUROPEAN_SELLER,
      enabled: new Set(["card", "ideal", "link"]),
    });

    expect(rails.map((r) => r.type)).toEqual(["card", "link", "ideal"]);
    expect(rails.map((r) => r.type)).not.toContain("sepa_debit");
  });

  it("filters nothing when the platform's answer is unknown", () => {
    // A configuration Stripe would not hand over is a bad reason to tell a
    // seller their card payments are off.
    for (const enabled of [null, undefined]) {
      expect(
        sellerRails({ currency: "eur", facts: EUROPEAN_SELLER, enabled }).map((r) => r.type),
      ).toContain("sepa_debit");
    }
  });

  it("still applies the currency rule to what survives", () => {
    const rails = sellerRails({
      currency: "usd",
      facts: EUROPEAN_SELLER,
      enabled: new Set(["card", "ideal"]),
    });
    expect(rails.find((r) => r.type === "ideal")?.state).toBe("off_currency");
  });
});

describe("the rail table and the capability table agree", () => {
  it("has a rail for every capability Sailo requests, bar transfers", () => {
    /*
     * `transfers` is the one capability with no rail — it moves money to the
     * seller rather than taking it from a buyer. Everything else Sailo asks
     * for should be nameable on the payments screen, or the seller is being
     * charged onboarding questions for something they can never see.
     */
    const requested = new Set(
      ["US", "DE", "GB", "PL", "NL", "FR", null].flatMap((c) => capabilitiesFor(c)),
    );
    requested.delete("transfers");

    const named = new Set(CONNECT_RAILS.map((r) => r.capability));
    expect([...requested].filter((c) => !named.has(c))).toEqual([]);
  });

  it("does not name a rail nobody ever requests", () => {
    const requested = new Set(
      ["US", "DE", "GB", "PL", "NL", "FR", "IE", "ES", "IT", "SE", "CH", null].flatMap(
        (c) => capabilitiesFor(c),
      ),
    );
    expect(CONNECT_RAILS.filter((r) => !requested.has(r.capability))).toEqual([]);
  });
});
