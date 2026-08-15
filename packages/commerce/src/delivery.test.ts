import { describe, expect, it } from "vitest";
import {
  isDeliveryConfigured,
  parseCountries,
  shippableCountries,
  shipsTo,
} from "./delivery";

/**
 * Where a shop will actually post to.
 *
 * One rule, asked in three places — the checkout panel narrowing what it
 * offers, the preview pricing it, and the order refusing it — so the rule
 * itself is what gets tested. The thing that would hurt most is not a country
 * wrongly refused; it is an empty zone read as "nowhere", which would stop
 * every shop that has never touched this feature from selling anything.
 */

const anywhere = { type: "shipping", countries: [] as string[] };
const croatiaOnly = { type: "shipping", countries: ["HR"] };
const eu = { type: "shipping", countries: ["HR", "DE", "FR"] };
const pickup = { type: "collection", countries: [] as string[] };

describe("shipsTo", () => {
  it("treats an empty zone as anywhere, not nowhere", () => {
    /*
     * The whole backfill. Every rate created before this feature existed has
     * an empty `countries`, and reading it the other way would take every one
     * of those shops offline.
     */
    expect(shipsTo(anywhere, "HR")).toBe(true);
    expect(shipsTo(anywhere, "JP")).toBe(true);
    expect(shipsTo(anywhere, null)).toBe(true);
    expect(shipsTo(anywhere, "")).toBe(true);
  });

  it("honours a zone that names countries", () => {
    expect(shipsTo(croatiaOnly, "HR")).toBe(true);
    expect(shipsTo(croatiaOnly, "DE")).toBe(false);
    expect(shipsTo(eu, "FR")).toBe(true);
  });

  it("normalises what the buyer sent", () => {
    // The dropdown posts an uppercase code, but an older cached page, an
    // autofill, or a direct request may not.
    expect(shipsTo(croatiaOnly, "hr")).toBe(true);
    expect(shipsTo(croatiaOnly, " HR ")).toBe(true);
  });

  it("refuses a restricted rate when the country can't be checked", () => {
    /*
     * Deliberate, and the direction matters: letting an order through
     * *because* the field was blank would make the whole feature opt-out. Free
     * text from an older page lands here too, and is refused for the same
     * reason — "Hrvatska" may well be Croatia, but the seller asked for a
     * guarantee and a guess isn't one.
     */
    expect(shipsTo(croatiaOnly, null)).toBe(false);
    expect(shipsTo(croatiaOnly, "")).toBe(false);
    expect(shipsTo(croatiaOnly, "Hrvatska")).toBe(false);
  });

  it("reads a zone that isn't there at all as anywhere", () => {
    /*
     * The first render after this deploys can be served a `getCheckoutOptions`
     * payload written by the previous build, which has no `countries` on it.
     * Absent has to mean what empty means, or the checkout panel throws on
     * `undefined.length` for every shop at once.
     */
    expect(shipsTo({ type: "shipping" }, "JP")).toBe(true);
    expect(shipsTo({ type: "shipping" }, null)).toBe(true);
    expect(shippableCountries([{ type: "shipping" }])).toBeNull();
    expect(shippableCountries([{ type: "shipping" }, croatiaOnly])).toBeNull();
  });

  it("ignores zones on a collection", () => {
    // A pickup happens at the seller's address, so where the buyer lives is
    // not the seller's business — even if a zone somehow reached the row.
    expect(shipsTo(pickup, null)).toBe(true);
    expect(shipsTo({ type: "collection", countries: ["HR"] }, "JP")).toBe(true);
  });
});

describe("shippableCountries", () => {
  it("is null when nothing narrows the list", () => {
    // Null means the checkout offers every country. Any unrestricted rate is
    // enough, because that one reaches everywhere by itself.
    expect(shippableCountries([anywhere])).toBeNull();
    expect(shippableCountries([anywhere, croatiaOnly])).toBeNull();
  });

  it("is null for a shop that only does collection", () => {
    // Nothing is posted, so nothing constrains where the buyer may say they
    // are — and they still have to be able to say it.
    expect(shippableCountries([pickup])).toBeNull();
    expect(shippableCountries([])).toBeNull();
  });

  it("unions the zones when every rate is restricted", () => {
    const reachable = shippableCountries([croatiaOnly, eu]);
    expect(reachable).not.toBeNull();
    expect((reachable ?? []).toSorted()).toEqual(["DE", "FR", "HR"]);
  });

  it("is the one-country list the checkout preselects from", () => {
    // The case the feature was built for: the panel seeds the country when
    // this comes back with exactly one entry.
    expect(shippableCountries([croatiaOnly, pickup])).toEqual(["HR"]);
  });
});

describe("parseCountries", () => {
  it("drops what it can't use rather than refusing the save", () => {
    // A stale code from an older build is not a reason to reject a seller's
    // whole form; an empty result is, and the action checks for that.
    expect(parseCountries(["hr", "XX", "", "de"])).toEqual(["DE", "HR"]);
  });

  it("dedupes and sorts, so two identical zones compare equal", () => {
    expect(parseCountries(["DE", "hr", "DE"])).toEqual(["DE", "HR"]);
  });

  it("returns nothing when nothing was picked", () => {
    expect(parseCountries([""])).toEqual([]);
    expect(parseCountries([])).toEqual([]);
  });
});

describe("isDeliveryConfigured", () => {
  it("is unchanged by zones", () => {
    /*
     * A zone can never make a rate unusable: an empty one means anywhere, and
     * a non-empty one is checked per buyer rather than per rate. Collection
     * still needs its pickup address.
     */
    expect(isDeliveryConfigured("shipping", {})).toBe(true);
    expect(isDeliveryConfigured("collection", {})).toBe(false);
    expect(isDeliveryConfigured("collection", { address: "412 NE Alberta" })).toBe(true);
  });
});
