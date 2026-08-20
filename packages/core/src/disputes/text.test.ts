import { describe, expect, it } from "vitest";
import { EVIDENCE_FIELD_MAX, clampEvidence, evidenceDate, evidenceMoney } from "./text";

describe("evidenceMoney", () => {
  it("states a yen dispute in whole yen", () => {
    // The flat /100 this replaces told the issuer a ¥100,000 dispute was
    // "1000.00 JPY" — in the seller's own evidence narrative.
    expect(evidenceMoney(100_000, "JPY")).toBe("100000 JPY");
  });

  it("states a dinar to its three places", () => {
    expect(evidenceMoney(12_500, "KWD")).toBe("12.500 KWD");
  });

  it("keeps two places and upper case for the ordinary case", () => {
    expect(evidenceMoney(1999, "usd")).toBe("19.99 USD");
  });
});

describe("evidenceDate", () => {
  it("renders the calendar date and only the date", () => {
    expect(evidenceDate(new Date("2026-08-12T09:41:07.221Z"))).toBe("2026-08-12");
  });

  it("says null for what is not on record, leaving the wording to the caller", () => {
    expect(evidenceDate(null)).toBeNull();
    expect(evidenceDate(undefined)).toBeNull();
  });
});

describe("clampEvidence", () => {
  it("passes short text through untouched", () => {
    expect(clampEvidence("short")).toBe("short");
  });

  it("clamps to the ceiling with the truncation visible", () => {
    const long = "x".repeat(EVIDENCE_FIELD_MAX + 100);
    const clamped = clampEvidence(long);
    expect(clamped).toHaveLength(EVIDENCE_FIELD_MAX);
    expect(clamped.endsWith("…")).toBe(true);
  });
});
