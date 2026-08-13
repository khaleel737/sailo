import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

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
 *
 * **Both halves, since the split across packages.** `ownership` moved to
 * `@sailo/payments` and the handlers stayed in apps/web, which quietly broke
 * the guarantee in a way that still went green: scanning only this app finds
 * the scoped accessor gone and zero lookups to count, and scanning only the
 * package finds the one legitimate lookup while no longer reading `connect.ts`
 * — the very handler that once went direct. Counting across both is what keeps
 * "exactly one" mean what it says.
 */
function sourceDirs(): string[] {
  const require = createRequire(import.meta.url);
  return [
    join(process.cwd(), "src/lib/stripe-webhooks"),
    join(dirname(require.resolve("@sailo/payments")), "stripe-webhooks"),
  ];
}

export function webhookSource(): string {
  return sourceDirs()
    .flatMap((dir) => {
      /*
       * A missing directory is the failure this is here to catch — it means
       * the code moved again and the scan is now reading less than it claims
       * to. Silently returning nothing would leave the assertions passing over
       * an empty string.
       */
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`webhookSource: ${dir} is not a directory`);
      }
      return readdirSync(dir)
        .filter((f) => f.endsWith(".ts"))
        .toSorted()
        .map((f) => readFileSync(join(dir, f), "utf8"));
    })
    .join("\n");
}
