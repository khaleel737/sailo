/**
 * The seller half, against live Stripe and the deployed site. No money.
 *
 *   STRIPE_SECRET_KEY=sk_live_… npx tsx scripts/check-connect-live.ts
 *
 * `check-live.ts` proves Sailo's own billing: Stripe delivers a subscription
 * event to the account endpoint and the shop row moves. It cannot say anything
 * about the *Connect* endpoint, which only ever fires for a connected account —
 * and until the platform profile was completed, live had none to fire for.
 *
 * So this creates a real connected account, which makes Stripe emit
 * `account.updated` and deliver it, over the internet, to the live Connect
 * endpoint. `pending_webhooks` counts deliveries Stripe has not yet had a 2xx
 * for, so it falls to zero only if the deployment verified the signature with
 * its own copy of STRIPE_CONNECT_WEBHOOK_SECRET. That is the one thing no test
 * has ever proved, and the thing that silently breaks the first real sale: a
 * wrong secret means every seller's order stays unpaid while Stripe retries for
 * three days.
 *
 * The account is deleted at the end. It is never onboarded, so it can never be
 * charged, and no buyer or card is involved.
 */
import Stripe from "stripe";
import { readFileSync } from "node:fs";

/**
 * `stripe-webhooks.ts` is `server-only`, so it cannot be imported here — the
 * package throws on sight outside a server component. Read the set out of the
 * source instead, as `check-payment-methods.ts` does for `connect.ts`. Still a
 * single source of truth; just parsed rather than imported.
 */
const SOURCE = readFileSync("src/lib/stripe-webhooks.ts", "utf8");
const BLOCK = (SOURCE.match(/HANDLED = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "")
  // The comments in that block quote event payloads — `payment_status:
  // "unpaid"` among them — and a bare string match happily reads those as
  // event names. Drop the prose first.
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
const HANDLED = new Set([...BLOCK.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string));
if (HANDLED.size === 0) throw new Error("could not read HANDLED from src/lib/stripe-webhooks.ts");

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
if (!secretKey.startsWith("sk_live_")) {
  throw new Error("This check is for live mode. Pass a live key deliberately.");
}

const stripe = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia" });
const SITE = process.env.CHECK_SITE ?? "https://sailo.store";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * The seller-side events, which is `HANDLED` minus the ones that can only come
 * from the platform's own account (subscriptions and their invoices).
 *
 * Derived rather than typed out, and checked against `HANDLED` below. Writing
 * the list by hand once put an event on this endpoint that the route does not
 * handle, and — worse — dropped one that it does, because the count still came
 * to eight. A hand-kept copy of a list that lives somewhere else will drift,
 * and this one drifts straight into live configuration.
 */
const PLATFORM_ONLY = /^(customer\.subscription|invoice)\./;
const CONNECT_EVENTS = [...HANDLED].filter((e) => !PLATFORM_ONLY.test(e));

async function main() {
  console.log(`LIVE Connect · ${SITE}\n`);
  let accountId: string | null = null;

  try {
    /* ------------------------------------------------ the endpoint is wired */
    console.log("The live Connect endpoint");
    const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
    // `application` is the marker for a Connect endpoint. There is no `connect`
    // boolean on the object, which is easy to assume and wrong.
    const connect = endpoints.data.find(
      (e) => e.application && e.url === `${SITE}/api/stripe/connect/webhook`,
    );
    check("exists and is enabled", connect?.status === "enabled", connect?.id ?? "not found");
    const missing = CONNECT_EVENTS.filter((e) => !connect?.enabled_events.includes(e));
    check(
      `subscribes to all ${CONNECT_EVENTS.length} seller events we handle`,
      missing.length === 0,
      missing.join(", "),
    );
    // The other direction. A subscribed event with no case in the route is
    // acknowledged and dropped, which looks like working software right up
    // until someone assumes it did something.
    const unhandled = (connect?.enabled_events ?? []).filter(
      (e) => e !== "*" && !HANDLED.has(e),
    );
    check("and to nothing it does not handle", unhandled.length === 0, unhandled.join(", "));

    const reachable = await fetch(`${SITE}/api/stripe/connect/webhook`, { method: "POST" });
    check("reachable and refuses an unsigned request", reachable.status === 400);

    /* ------------------------------------------- onboarding is unblocked */
    console.log("\nA seller connects Stripe");
    try {
      const account = await stripe.accounts.create({
        type: "express",
        business_profile: {
          name: "Sailo live Connect check",
          product_description: "Throwaway account for check-connect-live. Safe to delete.",
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { probe: "check-connect-live" },
      });
      accountId = account.id;
      check("Stripe creates the connected account", true, account.id);
    } catch (error) {
      const message = (error as Stripe.errors.StripeError).message;
      check("Stripe creates the connected account", false, message);
      // Everything below depends on an account existing.
      /*
       * Stripe gates live Connect behind two separate things, and completing
       * the first makes the error message change rather than go away:
       *   1. loss liability — /settings/connect/platform-profile
       *   2. the platform questionnaire — /connect/accounts/overview
       * Read the message above; it names whichever one is outstanding.
       */
      console.log(
        "\n  Nothing further can be checked until that is resolved in the Dashboard.\n",
      );
      return;
    }

    check(
      "starts unchargeable, as an un-onboarded account should",
      (await stripe.accounts.retrieve(accountId)).charges_enabled === false,
    );

    /* ------------------------ the deployment verifies the Connect signature */
    console.log("\nStripe delivers account.updated to the deployment on its own");
    let event: Stripe.Event | undefined;
    for (let i = 0; i < 24 && !event; i++) {
      await sleep(2500);
      const list = await stripe.events.list({ type: "account.updated", limit: 25 });
      event = list.data.find(
        (e) => (e.data.object as Stripe.Account).id === accountId,
      );
    }

    if (!event) {
      check("Stripe emitted the event", false, "none seen after 60s");
    } else {
      check("Stripe emitted the event", true, event.id);

      /*
       * The signal. Stripe decrements this once the endpoint answers 2xx, and
       * leaves it standing while it retries a rejected delivery — so a wrong
       * secret in Vercel shows up here and nowhere else.
       */
      let pending = event.pending_webhooks;
      for (let i = 0; i < 20 && pending > 0; i++) {
        await sleep(3000);
        pending = (await stripe.events.retrieve(event.id)).pending_webhooks;
      }
      check(
        "the deployed site accepted it — the live Connect secret is correct",
        pending === 0,
        pending === 0 ? "" : `${pending} delivery still unacknowledged`,
      );
    }
  } finally {
    console.log("\nCleanup");
    for (const account of (await stripe.accounts.list({ limit: 50 })).data) {
      if (account.metadata?.probe === "check-connect-live") {
        await stripe.accounts.del(account.id).catch(() => {});
        console.log(`  deleted ${account.id}`);
      }
    }
  }

  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed. Sellers can connect, and their events reach us.`
      : `\n${failures} of ${checks} checks failed.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
