import { webhookSource } from "@/lib/webhook-source";
import { describe, expect, it } from "vitest";

/**
 * The structural half of the ownership fix.
 *
 * The rules themselves — `sameAccount`, `sendingAccount`, `intentIdOf` — moved
 * to `@sailo/payments` and are tested there, beside the code, where the other
 * app that imports them is covered too.
 *
 * What stays here is the assertion that cannot: the actual bug was not a rule
 * returning the wrong answer but a handler never *calling* one.
 * `charge.refunded` ran its own `findFirst` on `stripePaymentIntentId` and
 * acted on whatever came back, which let a seller mark another shop's order
 * refunded from their own connected account. Counting that lookup is a
 * statement about the modules, not about a function — and it has to be counted
 * across both halves of the split, which is what `webhookSource` reads. A
 * package-local version of this test would no longer see `connect.ts`, the
 * very handler that once went direct.
 */
describe("payment intent lookups", () => {
  const source = webhookSource();

  it("searches on stripePaymentIntentId in exactly one place", () => {
    const lookups = source.match(/eq\(orders\.stripePaymentIntentId/g) ?? [];
    expect(lookups).toHaveLength(1);
  });

  it("keeps that one lookup inside orderForIntent", () => {
    const body = source.slice(
      source.indexOf("export async function orderForIntent"),
    );
    const end = body.indexOf("\n}\n");
    expect(body.slice(0, end)).toContain("eq(orders.stripePaymentIntentId");
  });
});
