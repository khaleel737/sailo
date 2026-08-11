import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every line of the webhook module, as one string, for the tests that assert
 * on its wiring rather than on a return value.
 *
 * Several rules here cannot be checked any other way: "searching on
 * `stripePaymentIntentId` happens in exactly one place" is a statement about
 * the module, not about a function, and the bug it guards against was a
 * handler that skipped the scoped accessor and ran its own query.
 *
 * Read as a directory rather than a file. When this was one 715-line module
 * four tests pinned its path, and splitting it into five broke all four —
 * which is the wrong incentive: a test should not make the code harder to
 * organise. This survives the next split too.
 */
export function webhookSource(): string {
  const dir = join(process.cwd(), "src/lib/stripe-webhooks");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .toSorted()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}
