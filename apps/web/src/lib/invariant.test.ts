import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
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

/**
 * The rule the three call sites broke, enforced across the whole codebase.
 *
 * `onConflictDoNothing` returns no rows exactly when the conflict it names
 * happened, which is never a failure — it is the answer. Wrapping it in
 * `firstRow` converts that answer into a thrown InvariantError, and in
 * `orders/referral.ts` it threw on the checkout path *after* the order row was
 * already written: the buyer's order existed, the action 500'd, and the retry
 * loop written to handle a code collision never got a second attempt.
 *
 * A unit test of either helper cannot see this — both behave correctly in
 * isolation. What was wrong was the pairing, so the pairing is what is checked.
 */
/** Every `firstRow( … )` call in a source file, parens balanced. */
function firstRowCalls(source: string): string[] {
  const calls: string[] = [];
  const needle = "firstRow(";

  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) {
    let depth = 0;
    for (let j = i + needle.length - 1; j < source.length; j++) {
      if (source[j] === "(") depth++;
      else if (source[j] === ")") {
        depth--;
        if (depth === 0) {
          calls.push(source.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return calls;
}

describe("firstRow is never used on a conflict-tolerant insert", () => {
  const files = execSync(
    `grep -rl "onConflictDoNothing" src --include="*.ts" || true`,
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    // This file names both on purpose.
    .filter((f) => !f.endsWith("invariant.test.ts"));

  it("finds the files that use conflict-tolerant inserts", () => {
    // Guards the guard: a grep that matches nothing would pass silently.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s wraps none of them in firstRow", (file) => {
    const offenders = firstRowCalls(readFileSync(file, "utf8")).filter((call) =>
      call.includes("onConflictDoNothing"),
    );
    expect(offenders).toEqual([]);
  });
});

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
