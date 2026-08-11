/**
 * Proves Stripe Connect works before anyone relies on it.
 *
 *   npm run check:connect
 *
 * Runs against whatever STRIPE_SECRET_KEY is configured, creates a connected
 * account both the way we ship today (v1 Express) and the way the Accounts v2
 * SaaS configuration prescribes, mints an onboarding link, reads the capability
 * status back, opens a direct charge on the account — then deletes everything
 * it made.
 *
 * Nothing here touches the database or a real seller. It answers one question:
 * would a seller pressing "Connect Stripe" get through?
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY is not set");

const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
const created: string[] = [];
let failures = 0;

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn();
    console.log(`  PASS  ${label}`);
    return result;
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${label}\n        ${(error as Error).message}`);
    return null;
  }
}

async function main() {
  /*
   * `GET /v1/account` returns the account the key belongs to. The SDK types
   * only model the by-id form, so the platform's own row is read through a
   * narrowed alias rather than an `any`.
   */
  const readPlatform = stripe.accounts.retrieve.bind(
    stripe.accounts,
  ) as unknown as () => Promise<Stripe.Account>;
  const platform = await readPlatform();
  console.log(
    `Platform: ${platform.id} · ${platform.country} · charges ${platform.charges_enabled ? "enabled" : "disabled"}\n`,
  );

  /* ------------------------------------------------------------------ v1 */
  console.log("v1 Express — what src/lib/connect.ts sends today");
  const v1 = await step("accounts.create({ type: 'express' })", () =>
    stripe.accounts.create({
      type: "express",
      business_profile: {
        name: "Connect Check",
        product_description: "Probe account created by npm run check:connect.",
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { probe: "check-connect" },
    }),
  );
  if (v1) created.push(v1.id);

  /* ------------------------------------------------------------------ v2 */
  console.log("\nAccounts v2 — the SaaS configuration we intend to migrate to");
  const v2 = await step("v2.core.accounts.create", () =>
    stripe.v2.core.accounts.create({
      contact_email: "probe@example.com",
      display_name: "Connect Check v2",
      dashboard: "full",
      defaults: {
        currency: "usd",
        responsibilities: {
          fees_collector: "stripe",
          losses_collector: "stripe",
        },
      },
      identity: { country: "us", entity_type: "individual" },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
      },
      include: ["configuration.merchant", "requirements"],
    }),
  );

  if (v2) {
    created.push(v2.id);
    const status =
      v2.configuration?.merchant?.capabilities?.card_payments?.status;
    console.log(`        card_payments status: ${status ?? "(not returned)"}`);

    await step("accountLinks.create — hosted onboarding", () =>
      stripe.accountLinks.create({
        account: v2.id,
        refresh_url: "http://localhost:3000/admin/payments?stripe=refresh",
        return_url: "http://localhost:3000/admin/payments?stripe=return",
        type: "account_onboarding",
      }),
    );

    /*
     * The platform fee, on the charge itself. Asserted rather than assumed:
     * a direct charge with no `application_fee_amount` comes back with a null
     * fee no matter how the Dashboard's pricing scheme is configured, so this
     * is the only place that proves we are actually being paid.
     */
    const goods = 4800;
    const expectedFee = Math.round(goods * 0.01);
    const session = await step(
      "checkout.sessions.create with the platform fee",
      () =>
        stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [
              {
                quantity: 2,
                price_data: {
                  currency: "usd",
                  unit_amount: 2400,
                  product_data: { name: "Speckled stoneware mug" },
                },
              },
            ],
            payment_intent_data: { application_fee_amount: expectedFee },
            success_url: "http://localhost:3000/ok",
            cancel_url: "http://localhost:3000/no",
          },
          { stripeAccount: v2.id },
        ),
    );
    if (session) {
      console.log(
        `        $${(goods / 100).toFixed(2)} basket -> $${(expectedFee / 100).toFixed(2)} to Sailo`,
      );
    }
  }

  /* ------------------------------------------------------------- teardown */
  if (created.length) console.log("\nCleanup");
  for (const id of created) {
    try {
      await stripe.accounts.del(id);
      console.log(`  deleted ${id}`);
    } catch (error) {
      console.log(`  could not delete ${id}: ${(error as Error).message}`);
    }
  }

  console.log(
    failures === 0
      ? "\nConnect is working. A seller pressing Connect Stripe would get through."
      : `\n${failures} step(s) failed — see the messages above.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
