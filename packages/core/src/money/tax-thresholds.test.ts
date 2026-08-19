import { describe, expect, it } from "vitest";
import {
  APPROACHING_RATIO,
  EU_DISTANCE_SELLING,
  EU_MEMBER_STATES,
  IMMEDIATE_OBLIGATION,
  TAX_THRESHOLDS_REVIEWED_ON,
  US_NEXUS,
  alertRung,
  convertMinor,
  indicativeRate,
  isEuMemberState,
  placeKey,
  thresholdFor,
  thresholdMinorIn,
  watchJurisdictions,
  type PlaceRevenue,
} from "./tax-thresholds";

/**
 * The arithmetic a seller is warned by, and the two ways it is most easily
 * wrong.
 *
 * The first is the grouping. Twenty-seven EU rows of €500 each is a seller
 * €3,500 over a €10,000 combined threshold looking at twenty-seven green bars,
 * and no amount of correct per-row arithmetic recovers from adding up the wrong
 * sets. The second is re-deriving money: every figure in here is a sum of what
 * an order actually carried, and a test that fed it a rate would be testing a
 * different feature.
 */

const row = (over: Partial<PlaceRevenue> & Pick<PlaceRevenue, "country">): PlaceRevenue => ({
  region: null,
  currency: "EUR",
  netB2cMinor: 0,
  netB2bMinor: 0,
  taxMinor: 0,
  orderCount: 0,
  ...over,
});

const watch = (rows: PlaceRevenue[], over: Partial<Parameters<typeof watchJurisdictions>[0]> = {}) =>
  watchJurisdictions({
    rows,
    homeCountry: null,
    registeredKeys: [],
    ossRegistered: false,
    ...over,
  });

const find = (rows: ReturnType<typeof watch>, key: string) =>
  rows.find((r) => r.key === key);

describe("the reference table", () => {
  it("carries the date it was reviewed", () => {
    // The whole register of this feature rests on the number being dated. A
    // figure with no date beside it reads as a fact rather than as a starting
    // point, which is the claim spec 38 refuses to make.
    expect(TAX_THRESHOLDS_REVIEWED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has twenty-seven member states and no leavers", () => {
    expect(EU_MEMBER_STATES).toHaveLength(27);
    expect(isEuMemberState("GB")).toBe(false);
    expect(isEuMemberState("de")).toBe(true);
    expect(isEuMemberState(null)).toBe(false);
  });

  it("names no US state twice, and none without a sales tax", () => {
    const seen = US_NEXUS.map((t) => t.region);
    expect(new Set(seen).size).toBe(seen.length);
    // Four states levy no sales tax at all; a threshold row for one of them
    // would report nexus that cannot exist.
    for (const none of ["DE_STATE", "MT", "NH", "OR"]) {
      expect(seen).not.toContain(none);
    }
  });

  it("gives every immediate row a null amount", () => {
    // `immediate` and an amount together is a contradiction the arithmetic
    // would have to pick a winner for.
    for (const t of IMMEDIATE_OBLIGATION) {
      expect(t.amount).toBeNull();
      expect(t.immediate).toBe(true);
    }
  });

  it("looks a place up by state, then by country, then gives up", () => {
    expect(thresholdFor("US", "CA")?.amount).toBe(500_000);
    expect(thresholdFor("us", "ca")?.amount).toBe(500_000);
    // No US country row exists, so an unknown state is untracked rather than
    // silently borrowing another state's figure.
    expect(thresholdFor("US", "ZZ")).toBeNull();
    expect(thresholdFor("PE")?.immediate).toBe(true);
    expect(thresholdFor(null)).toBeNull();
  });

  it("keys places the way every map in the feature does", () => {
    expect(placeKey("us", "ca")).toBe("US-CA");
    expect(placeKey("de")).toBe("DE");
    expect(placeKey("de", null)).toBe("DE");
  });
});

describe("converting for display only", () => {
  it("is the identity within one currency", () => {
    expect(convertMinor(123, "USD", "usd")).toBe(123);
  });

  it("crosses the exponent, not just the rate", () => {
    // 1000 minor JOD is one dinar, 1000 minor USD is ten dollars. A converter
    // that multiplied minor units directly would be out by a factor of ten
    // here and nowhere else, which is the shape of bug nobody finds.
    const oneDinar = 1_000;
    const usd = convertMinor(oneDinar, "JOD", "USD");
    // JOD is not in the indicative table, so there is no rate and no guess.
    expect(usd).toBeNull();

    // The same shape with two currencies that are listed.
    expect(convertMinor(100_00, "EUR", "USD")).toBe(108_00);
  });

  it("answers null rather than parity for an unlisted currency", () => {
    // The dangerous alternative: assume 1:1 and report a Japanese shop as four
    // times over a dollar threshold it is nowhere near.
    expect(indicativeRate("USD", "XYZ")).toBeNull();
    expect(convertMinor(1_000_000, "XYZ", "USD")).toBeNull();
  });

  it("puts a threshold into the shop's own currency", () => {
    expect(thresholdMinorIn(EU_DISTANCE_SELLING, "EUR")).toBe(10_000_00);
    expect(thresholdMinorIn(EU_DISTANCE_SELLING, "USD")).toBe(10_800_00);
    expect(thresholdMinorIn(IMMEDIATE_OBLIGATION[0]!, "EUR")).toBeNull();
  });
});

describe("the EU combined case", () => {
  it("adds member states together instead of judging them one by one", () => {
    const rows = EU_MEMBER_STATES.slice(0, 8).map((country) =>
      row({ country, netB2cMinor: 2_000_00, orderCount: 4 }),
    );
    const out = watch(rows);

    // Eight countries, one row.
    expect(out).toHaveLength(1);
    const eu = find(out, "EU")!;
    expect(eu.scope).toBe("eu");
    expect(eu.netB2cMinor).toBe(16_000_00);
    expect(eu.orderCount).toBe(32);
    expect(eu.state).toBe("crossed");
  });

  it("leaves the seller's own country out of the combined figure", () => {
    const out = watch(
      [
        row({ country: "DE", netB2cMinor: 50_000_00 }),
        row({ country: "FR", netB2cMinor: 1_000_00 }),
      ],
      { homeCountry: "DE" },
    );

    // Domestic revenue is not distance selling; counting it would consume the
    // whole allowance and warn a German seller about Germany.
    const eu = find(out, "EU")!;
    expect(eu.netB2cMinor).toBe(1_000_00);
    expect(eu.state).toBe("under");
    expect(find(out, "DE")?.state).toBe("untracked");
  });

  it("marks the group registered once OSS is on", () => {
    const out = watch([row({ country: "FR", netB2cMinor: 40_000_00 })], {
      ossRegistered: true,
    });
    const eu = find(out, "EU")!;
    // Still crossed, and still shown — one OSS return covers it, so the state
    // is information rather than a thing to act on.
    expect(eu.state).toBe("crossed");
    expect(eu.registered).toBe(true);
  });
});

describe("US economic nexus", () => {
  it("counts each state on its own", () => {
    const out = watch([
      row({ country: "US", region: "CA", currency: "USD", netB2cMinor: 400_000_00 }),
      row({ country: "US", region: "CO", currency: "USD", netB2cMinor: 40_000_00 }),
    ]);

    expect(find(out, "US-CA")!.state).toBe("approaching"); // 400k of 500k
    expect(find(out, "US-CO")!.state).toBe("under"); // 40k of 100k
  });

  it("crosses on a count of sales even when the money is nowhere near", () => {
    const out = watch([
      row({
        country: "US",
        region: "OH",
        currency: "USD",
        netB2cMinor: 2_400_00,
        orderCount: 210,
      }),
    ]);
    const oh = find(out, "US-OH")!;
    expect(oh.crossedOnTransactions).toBe(true);
    expect(oh.state).toBe("crossed");
    // The ratio is still reported honestly — it is 2% — but it is not what
    // decided the state.
    expect(oh.ratio).toBeCloseTo(0.024, 3);
  });

  it("does not count sales in a state that stopped counting them", () => {
    const out = watch([
      row({
        country: "US",
        region: "CA",
        currency: "USD",
        netB2cMinor: 1_000_00,
        orderCount: 5_000,
      }),
    ]);
    expect(find(out, "US-CA")!.crossedOnTransactions).toBe(false);
    expect(find(out, "US-CA")!.state).toBe("under");
  });
});

describe("B2B, and the two rungs", () => {
  it("never lets a B2B sale move a threshold", () => {
    const out = watch([
      row({
        country: "US",
        region: "CO",
        currency: "USD",
        netB2cMinor: 10_000_00,
        netB2bMinor: 400_000_00,
      }),
    ]);
    const co = find(out, "US-CO")!;
    expect(co.netB2bMinor).toBe(400_000_00);
    expect(co.ratio).toBeCloseTo(0.1, 5);
    expect(co.state).toBe("under");
  });

  it("bands at 70 and 90", () => {
    const at = (pct: number) =>
      find(
        watch([
          row({
            country: "US",
            region: "CO",
            currency: "USD",
            netB2cMinor: Math.round(100_000_00 * pct),
          }),
        ]),
        "US-CO",
      )!.state;

    expect(at(0.69)).toBe("under");
    expect(at(APPROACHING_RATIO)).toBe("approaching");
    expect(at(0.89)).toBe("approaching");
    expect(at(0.9)).toBe("near");
    expect(at(1)).toBe("crossed");

    expect(alertRung("under")).toBeNull();
    expect(alertRung("approaching")).toBe("70");
    expect(alertRung("near")).toBe("90");
    // Crossed still mails, at the higher rung — a seller who went from 60% to
    // 130% between two ticks must not be told nothing because they skipped a
    // band.
    expect(alertRung("crossed")).toBe("90");
    expect(alertRung("immediate")).toBeNull();
  });

  it("reports an immediate place as immediate, with nothing to approach", () => {
    const out = watch([row({ country: "PE", netB2cMinor: 9_00 })]);
    const pe = find(out, "PE")!;
    expect(pe.state).toBe("immediate");
    expect(pe.ratio).toBeNull();
    expect(pe.remainingMinor).toBeNull();
  });

  it("reports an unpriceable currency as uncomparable, not as safe", () => {
    const out = watch([
      row({ country: "US", region: "CO", currency: "XYZ", netB2cMinor: 999_999_00 }),
    ]);
    expect(find(out, "US-CO")!.state).toBe("uncomparable");
  });

  it("sums three-decimal minor units without ever seeing a rate", () => {
    /*
     * The failure `PRODUCTION-PLAN.md` records: five currencies quoted to three
     * places and settled to two. What protects this feature from it is that it
     * never divides — the two rows below are added as integers and the total is
     * the integer a reader would get by adding the two invoices.
     */
    const out = watch([
      row({ country: "PE", currency: "KWD", netB2cMinor: 1_234, taxMinor: 61 }),
      row({ country: "PE", currency: "KWD", netB2cMinor: 8_766, taxMinor: 439 }),
    ]);
    const pe = find(out, "PE")!;
    expect(pe.netB2cMinor).toBe(10_000);
    expect(pe.taxMinor).toBe(500);
  });
});

describe("ordering", () => {
  it("puts what needs a decision at the top", () => {
    const out = watch([
      row({ country: "US", region: "CO", currency: "USD", netB2cMinor: 1_00 }),
      row({ country: "US", region: "WY", currency: "USD", netB2cMinor: 120_000_00 }),
      row({ country: "US", region: "ME", currency: "USD", netB2cMinor: 75_000_00 }),
      row({ country: "PE", currency: "USD", netB2cMinor: 1_00 }),
    ]);
    expect(out.map((r) => r.key)).toEqual(["US-WY", "PE", "US-ME", "US-CO"]);
  });
});
