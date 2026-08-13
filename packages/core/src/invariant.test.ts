import { describe, expect, it } from "vitest";
import { firstRow, InvariantError, maybeRow, present } from "./invariant";

/**
 * These two look interchangeable and are not, which is how three call sites
 * came to use the throwing one on a conditional write. An `UPDATE ... WHERE`
 * that matches no rows has not failed — it has answered — and `firstRow`
 * turned each of those answers into a 500 while the branch written to handle
 * it sat unreachable underneath.
 */

describe("firstRow", () => {
  it("returns the row when there is one", () => {
    expect(firstRow([{ id: "a" }], "shop")).toEqual({ id: "a" });
  });

  it("throws on empty, naming what was missing", () => {
    expect(() => firstRow([], "invoice number")).toThrow(InvariantError);
    // The message has to say which query came back empty, or the stack trace
    // is a line number in a helper nobody wrote.
    expect(() => firstRow([], "invoice number")).toThrow(/invoice number/);
  });

  it("ignores anything past the first row", () => {
    expect(firstRow([1, 2, 3], "n")).toBe(1);
  });
});

describe("maybeRow", () => {
  it("returns undefined on empty rather than throwing", () => {
    // This is the whole point: a conditional write that matched nothing.
    expect(maybeRow([])).toBeUndefined();
  });

  it("returns the row when there is one", () => {
    expect(maybeRow([{ id: "a" }])).toEqual({ id: "a" });
  });

  it("leaves the caller's guard reachable", () => {
    // The shape every fixed call site uses. With firstRow this never ran.
    const claimed = maybeRow<{ id: string }>([]);
    expect(claimed ? "served" : "no allowance left").toBe("no allowance left");
  });
});

/*
 * The `firstRow`/`onConflictDoNothing` pairing guard stayed behind in apps/web,
 * as `src/lib/invariant.test.ts`, for the same reason the status guard did: it
 * reads every file in a `src` tree that uses conflict-tolerant inserts, and
 * those call sites are all in the app. Pointed at this package it would have
 * found none and passed by default — which its own "guards the guard"
 * assertion exists to prevent.
 */

describe("present", () => {
  it("passes a value through", () => {
    expect(present("x", "token")).toBe("x");
    // Falsy but present is still present — 0 and "" are values.
    expect(present(0, "count")).toBe(0);
    expect(present("", "label")).toBe("");
    expect(present(false, "flag")).toBe(false);
  });

  it("throws on null and undefined, naming what was missing", () => {
    expect(() => present(null, "shop handle")).toThrow(/shop handle/);
    expect(() => present(undefined, "shop handle")).toThrow(InvariantError);
  });
});
