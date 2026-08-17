/**
 * The tiny assertion harness these check scripts all wrote for themselves.
 *
 * WHY IT IS SHARED NOW
 *
 * Nine of them had a copy. Four were byte-identical — `check(label, actual,
 * expected)` over `JSON.stringify` equality, a `checks`/`failures` pair of
 * module-level counters, and an epilogue printing the tally. The other five had
 * drifted: one counts `passes` instead of `checks`, one takes a boolean and a
 * detail string rather than two values, and they disagree about the wording of a
 * failure ("expected/actual" against "wanted/got").
 *
 * None of that drift was decided. It is what happens when the ninth script starts
 * by copying the eighth.
 *
 * WHAT IS DELIBERATELY NOT UNIFIED
 *
 * How a script *ends*. Eight set `process.exitCode`; `check-partners.ts` calls
 * `process.exit(1)`, which terminates immediately and skips whatever is still
 * open. That difference is load-bearing until somebody proves otherwise — a script
 * holding a database pool relies on the hard exit to terminate at all, and turning
 * it into `exitCode` in a script that talks to live Stripe would trade a wrong
 * exit code for a hang. So `report` returns the failure count and each script
 * decides, in one visible line, what to do with it.
 */

let checks = 0;
let failures = 0;

/**
 * Two values that must match, compared structurally.
 *
 * `JSON.stringify` rather than a deep-equal library: these compare API responses
 * and database rows, where key order is stable and the alternative is a dependency
 * for one line. Returns whether it passed, so a caller can skip work that only
 * makes sense if it did.
 */
export function check(label: string, actual: unknown, expected: unknown): boolean {
  checks++;
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures++;
  console.log(
    `  ${passed ? "PASS" : "FAIL"}  ${label}` +
      (passed
        ? ""
        : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`),
  );
  return passed;
}

/**
 * A condition that must hold, with an optional note.
 *
 * For the assertions where there is no "expected value" to print — a redirect
 * landed on the right host, a string contains a label — and printing `true`
 * against `true` would say nothing.
 */
export function ok(label: string, condition: boolean, detail = ""): boolean {
  checks++;
  if (!condition) failures++;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return condition;
}

/**
 * The tally, and the exit code.
 *
 * `success` is the sentence a script adds when everything passed — "the card rail
 * behaves", "sellers can connect, and their events reach us" — which is worth
 * keeping, because it says what the run actually proved.
 */
export function report(success = ""): number {
  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed.${success ? ` ${success}` : ""}`
      : `\n${failures} of ${checks} checks failed.`,
  );
  if (failures > 0) process.exitCode = 1;
  return failures;
}

/** For a script that prints its own summary line. */
export function tally(): { checks: number; failures: number } {
  return { checks, failures };
}
