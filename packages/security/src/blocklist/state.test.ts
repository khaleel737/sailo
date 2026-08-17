import { describe, expect, it } from "vitest";
import { verdictFor, type LastCheck } from "./state";
import type { Listing } from "./check";

/**
 * The rule that decides whether anybody gets an email.
 *
 * It has to hold two things at once: a standing listing must not mail the team
 * every morning until they filter the alert away, and a *new* listing must
 * never be swallowed by that suppression. The case that pins it is the third
 * one — a domain that was already listed picking up a second listing.
 */

const listing = (over: Partial<Listing> = {}): Listing => ({
  domain: "sailo.store",
  zone: "dbl.spamhaus.org",
  label: "Spamhaus DBL",
  code: "127.0.1.2",
  ...over,
});

const remembered = (listings: Listing[]): LastCheck => ({
  at: "2026-08-12T04:42:00.000Z",
  listings,
});

describe("verdictFor", () => {
  it("alerts on a first listing", () => {
    expect(verdictFor(remembered([]), [listing()])).toBe("alert");
  });

  it("stays quiet while the same listing stands", () => {
    expect(verdictFor(remembered([listing()]), [listing()])).toBe("quiet");
  });

  it("alerts again when a listed domain picks up another listing", () => {
    expect(
      verdictFor(remembered([listing()]), [
        listing(),
        listing({ zone: "multi.surbl.org", label: "SURBL", code: "127.0.0.64" }),
      ]),
    ).toBe("alert");
  });

  it("alerts when the return code changes under it", () => {
    // 127.0.1.2 (spam) becoming 127.0.1.5 (malware) is a different situation,
    // not the same one observed twice.
    expect(
      verdictFor(remembered([listing()]), [listing({ code: "127.0.1.5" })]),
    ).toBe("alert");
  });

  it("does not care what order the zones answered in", () => {
    const a = listing();
    const b = listing({ zone: "multi.surbl.org", label: "SURBL", code: "127.0.0.64" });
    expect(verdictFor(remembered([a, b]), [b, a])).toBe("quiet");
  });

  it("says so once when a listing clears", () => {
    expect(verdictFor(remembered([listing()]), [])).toBe("cleared");
    expect(verdictFor(remembered([]), [])).toBe("quiet");
  });

  it("alerts when there is nothing remembered at all", () => {
    /*
     * No Redis, or an evicted key. Repeating a real alert daily is the cheap
     * side of this trade; going silent about a live blocklisting is the
     * failure the whole check exists to prevent.
     */
    expect(verdictFor(null, [listing()])).toBe("alert");
    // ...but an unremembered clean run is still not news.
    expect(verdictFor(null, [])).toBe("quiet");
  });
});
