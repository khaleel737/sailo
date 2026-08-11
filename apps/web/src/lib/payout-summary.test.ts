import { describe, expect, it } from "vitest";
import { groupBalances } from "./payout-summary";

describe("groupBalances", () => {
  it("folds available and pending into one row per currency", () => {
    const rows = groupBalances(
      [{ amount: 12_000, currency: "gbp" }],
      [{ amount: 3_000, currency: "gbp" }],
    );
    expect(rows).toEqual([
      { currency: "GBP", availableCents: 12_000, pendingCents: 3_000 },
    ]);
  });

  it("keeps currencies apart — never sums across them", () => {
    // A UK shop refunded in EUR once: two rows, both shown.
    const rows = groupBalances(
      [
        { amount: 12_000, currency: "gbp" },
        { amount: -500, currency: "eur" },
      ],
      [{ amount: 3_000, currency: "gbp" }],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ currency: "GBP" });
    expect(rows[1]).toMatchObject({
      currency: "EUR",
      availableCents: -500,
      pendingCents: 0,
    });
  });

  it("gives a currency named only on the pending side a row too", () => {
    const rows = groupBalances([], [{ amount: 900, currency: "usd" }]);
    expect(rows).toEqual([
      { currency: "USD", availableCents: 0, pendingCents: 900 },
    ]);
  });

  it("adds up a currency split across source types", () => {
    const rows = groupBalances(
      [
        { amount: 1_000, currency: "usd" },
        { amount: 250, currency: "usd" },
      ],
      [],
    );
    expect(rows[0]?.availableCents).toBe(1_250);
  });

  it("is empty for an account that has never taken a charge", () => {
    expect(groupBalances([], [])).toEqual([]);
  });
});
