import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { appOrigin } from "@sailo/core/origin";
import {
  PLATFORM_STATEMENT_DESCRIPTOR,
  snapshotPlatformPolicies,
} from "@sailo/commerce/disputes";
import { guardedFetch } from "@sailo/webhooks/server";
import { stripe } from "@sailo/payments";

/**
 * The deploy step. Spec 46.
 *
 * ─── WHAT IT DOES, AND WHY EACH HALF HAS TO HAPPEN HERE ────────────────────
 *
 * **1. Snapshots Sailo's own terms, privacy policy and refund policy.**
 * `snapshotPlatformPolicies()` has been written, tested and *called by nothing*
 * since spec 44 landed. It is the platform-side twin of the argument
 * `policies.ts` makes about a seller's `termsUrl`: a seller charging back their
 * subscription is answered partly with the Sailo terms they accepted at signup,
 * and a link to a page that has since changed is no better as our evidence than
 * a changed URL is as theirs. The pages are 653, 584 and 344 lines of prose that
 * `PRODUCTION-PLAN.md` §4 rules "leave whole", so the only way to capture a
 * version is to read the deployed page — which means after the deploy, not
 * during the build.
 *
 * Content-addressed, so a deploy that changed no wording writes nothing. That is
 * what makes it safe to call on every deploy, and it is why this is idempotent
 * rather than merely tolerant of being run twice.
 *
 * **2. Sets the statement descriptor on the platform Stripe account.**
 * `SAILO` is recognisable; a legal entity name is not, and `unrecognized` (Visa
 * 10.4 / MC 4837) is the reason code that fixes for free. Spec 44 set one for
 * sellers and left ours unset. Read from the same constant the evidence quotes,
 * so what we tell an issuer appeared on the statement and what actually appeared
 * cannot drift.
 *
 * ─── WHY A ROUTE AND NOT A BUILD SCRIPT ────────────────────────────────────
 *
 * A build has no deployed origin to fetch and no production secrets to reach
 * Stripe with. This is called *after* the deployment is live, by whatever runs
 * the deploy — `npm run deploy:post -w @sailo/web` is the one line it needs.
 *
 * Guarded by `SAILO_INTERNAL_SECRET`, the same shared secret the revalidate
 * route uses, compared in constant time. Unset means refuse: an environment
 * that forgot to configure it must not become one where anyone can make the
 * platform fetch three pages and write to Stripe on demand.
 */

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // The work still happens, against a self-comparison, so the timing does not
    // depend on whether the length was right.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const expected = env.SAILO_INTERNAL_SECRET;
  if (!expected) {
    console.error("[sailo] deploy step called with no SAILO_INTERNAL_SECRET set");
    return Response.json({ ok: false }, { status: 503 });
  }
  if (!secretMatches(request.headers.get("x-sailo-internal") ?? "", expected)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  /*
   * Fetched under the SSRF guard even though the URL is our own.
   *
   * `appOrigin()` comes from an environment variable, and a guard that is
   * skipped "because the value is ours" is a guard that stops applying the day
   * somebody sets that variable wrong. The `lookup` hook is the same one every
   * seller-supplied fetch uses — the address approved is the address connected
   * to, with no second resolution in between.
   */
  const snapshots = await snapshotPlatformPolicies(appOrigin(), guardedFetch);

  const descriptor = await syncPlatformDescriptor();

  return Response.json({
    ok: true,
    policies: snapshots.map((row) => ({ kind: row.kind, stored: Boolean(row.id) })),
    descriptor,
  });
}

/**
 * Put `SAILO` on the platform account's statements.
 *
 * Best effort and reported rather than thrown: a deploy must not fail because
 * Stripe had a bad minute, and the descriptor being wrong costs a reason code
 * rather than a broken deployment. The response says what happened, which is
 * what makes the failure visible instead of silent.
 */
async function syncPlatformDescriptor(): Promise<{ set: boolean; reason?: string }> {
  try {
    /*
     * `retrieveCurrent`, not `retrieve(id)`. This is `GET /v1/account` — the
     * platform's own account, the one whose key we hold — and there is no id to
     * pass because the key *is* the identity. `retrieve` takes a connected
     * account id and would need us to invent one.
     */
    const account = await stripe().accounts.retrieveCurrent();
    if (account.settings?.payments?.statement_descriptor === PLATFORM_STATEMENT_DESCRIPTOR) {
      return { set: true };
    }
    await stripe().accounts.update(account.id, {
      settings: { payments: { statement_descriptor: PLATFORM_STATEMENT_DESCRIPTOR } },
    });
    return { set: true };
  } catch (error) {
    console.error("[sailo] could not set the platform statement descriptor", error);
    return { set: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}
