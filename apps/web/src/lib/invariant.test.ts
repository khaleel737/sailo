import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The rule three call sites broke, enforced across this app's source.
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
 * The helpers themselves moved to `@sailo/core/invariant` (the commerce code
 * the mobile API now shares needs `maybeRow`), and their unit tests went with
 * them. This stayed: every conflict-tolerant insert in the product is in this
 * tree, and a guard that greps the package instead would find none of them and
 * pass by finding nothing.
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
