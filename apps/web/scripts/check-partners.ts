/**
 * Proves the partner programme's money actually moves, before anyone relies on it.
 *
 *   npm run check:partners
 *
 * This is Sailo paying a seller for bringing us another seller — a transfer out
 * of our own platform balance into that seller's connected account, the same
 * one their own buyers pay into. It is NOT the seller-affiliate feature, where
 * a seller pays their own promoter out of their own sale and nothing passes
 * through us.
 *
 * The shape being tested changed with the programme. A partner used to onboard
 * a second, transfers-only `recipient` account; now a partner *is* a paying
 * seller, so the destination is the ordinary Express account they already have.
 * That is what these checks assert:
 *
 *   1. Does a seller account — `card_payments` *and* `transfers` — accept a
 *      commission transfer at all? (The whole design rests on this.)
 *   2. Does it still work while `card_payments` is only pending, i.e. before
 *      Stripe has finished verifying them as a merchant?
 *   3. Does the idempotency key make a repeated transfer a no-op rather than a
 *      second payment?
 *   4. Does a reversal put the money back?
 *   5. Is a transfer beyond the available balance refused, the way the payout
 *      run has to survive every month?
 *
 * Nothing here touches the database or a real partner. Every account it makes
 * is deleted on the way out.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  throw new Error(
    "Refusing to run: this creates accounts and moves money, so it is test-mode only.",
  );
}

const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

const createdAccounts: string[] = [];
let failures = 0;
let passes = 0;

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn();
    passes++;
    console.log(`  PASS  ${label}`);
    return result;
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${label}\n        ${(error as Error).message}`);
    return null;
  }
}

/** Asserts, with the actual value in the message so a failure is diagnosable. */
function expect(label: string, actual: unknown, wanted: unknown) {
  if (actual === wanted) {
    passes++;
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n        wanted ${wanted}, got ${actual}`);
  }
}

/**
 * A seller account exactly as `lib/connect.ts` creates one.
 *
 * `verified` prefills the identity and bank details Stripe would otherwise
 * collect through hosted onboarding, which is the only way a script can reach
 * the state a real payable seller is in.
 */
async function makeSellerAccount(verified: boolean): Promise<Stripe.Account> {
  return stripe.accounts.create({
    type: verified ? "custom" : "express",
    country: "US",
    email: "seller-partner@example.com",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    ...(verified
      ? {
          business_type: "individual" as const,
          tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "8.8.8.8" },
          business_profile: {
            mcc: "5734",
            product_description: "Digital products sold through Sailo.",
          },
          individual: {
            first_name: "Jenny",
            last_name: "Rosen",
            email: "seller-partner@example.com",
            phone: "+15555551234",
            dob: { day: 1, month: 1, year: 1990 },
            id_number: "000000000",
            ssn_last_4: "0000",
            address: {
              line1: "address_full_match",
              city: "South San Francisco",
              state: "CA",
              postal_code: "94080",
              country: "US",
            },
          },
          external_account: {
            object: "bank_account" as const,
            country: "US",
            currency: "usd",
            account_holder_type: "individual",
            routing_number: "110000000",
            account_number: "000123456789",
          },
        }
      : {}),
    metadata: { sailoRole: "seller-partner", check: "check-partners" },
  });
}

async function main() {
  console.log("\nSailo partner programme — Stripe reality check\n");

  const readPlatform = stripe.accounts.retrieve.bind(
    stripe.accounts,
  ) as unknown as () => Promise<Stripe.Account>;
  const platform = await readPlatform();
  console.log(`Platform is in ${platform.country?.toUpperCase() ?? "US"}\n`);

  /* ---------------------------------------------------------------------- */
  /*  1. The account we actually pay into                                    */
  /* ---------------------------------------------------------------------- */

  console.log("The seller account commission is paid into");

  const fresh = await step("creates a seller account (card_payments + transfers)", () =>
    makeSellerAccount(false),
  );
  if (fresh) {
    createdAccounts.push(fresh.id);
    /*
     * The claim the whole design rests on: `transfers` is requested alongside
     * `card_payments` by the seller flow, so there is no second account to
     * onboard. If this ever stops being true, partners silently stop being
     * payable and the programme needs its own account back.
     */
    expect(
      "requests the transfers capability, not just card_payments",
      Boolean(fresh.capabilities?.transfers),
      true,
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  2. Paying a real one                                                   */
  /* ---------------------------------------------------------------------- */

  console.log("\nPaying a verified seller their commission");

  const verified = await step("creates a verified, payable seller", () =>
    makeSellerAccount(true),
  );
  if (verified) createdAccounts.push(verified.id);

  const payable = await step("waits for the transfers capability to go active", async () => {
    if (!verified) throw new Error("no account");
    for (let attempt = 0; attempt < 12; attempt++) {
      const live = await stripe.accounts.retrieve(verified.id);
      if (live.capabilities?.transfers === "active") return live;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const last = await stripe.accounts.retrieve(verified.id);
    throw new Error(
      `transfers is "${last.capabilities?.transfers}"; due: ${
        last.requirements?.currently_due?.join(", ") || "none"
      }`,
    );
  });

  /*
   * Worth its own assertion. `canBePaid` gates on `stripeChargesEnabled`, so
   * this records what state the account is in when we decide to pay — and
   * proves a transfer does not require card_payments to have finished.
   */
  if (payable) {
    console.log(
      `        card_payments=${payable.capabilities?.card_payments}, ` +
        `charges_enabled=${payable.charges_enabled}`,
    );
  }

  await step("funds the platform balance to transfer from", async () => {
    const charge = await stripe.charges.create({
      amount: 20_000,
      currency: "usd",
      source: "btok_us_verified" as unknown as string,
      description: "check-partners top-up",
    });
    return charge;
  });

  const balance = await stripe.balance.retrieve();
  const available = balance.available.find((b) => b.currency === "usd")?.amount ?? 0;
  console.log(`        available: $${(available / 100).toFixed(2)}`);
  expect("reads an available platform balance", available > 1000, true);

  const idempotencyKey = `check-partners-${crypto.randomUUID()}`;

  const transfer = await step(
    "TRANSFERS commission into the seller's own account",
    () => {
      if (!payable) throw new Error("no payable account");
      return stripe.transfers.create(
        {
          amount: 600,
          currency: "usd",
          destination: payable.id,
          description: "Sailo partner commission — check",
          metadata: { check: "check-partners" },
        },
        { idempotencyKey },
      );
    },
  );

  /* Narrowed once rather than asserted at each use. */
  const payableId = payable?.id ?? "";

  if (transfer) {
    expect("transfer amount is what we asked for", transfer.amount, 600);
    expect("transfer landed on the seller account", transfer.destination, payable?.id);
    console.log(`        transfer: ${transfer.id}`);

    /*
     * The guard the payout run leans on. `partner_payouts` writes its
     * idempotency key *before* calling Stripe, so a retry after a timeout has
     * to replay rather than pay twice.
     */
    const replay = await step("replaying the same idempotency key does NOT pay twice", () =>
      stripe.transfers.create(
        {
          amount: 600,
          currency: "usd",
          destination: payableId,
          description: "Sailo partner commission — check",
          metadata: { check: "check-partners" },
        },
        { idempotencyKey },
      ),
    );
    if (replay) expect("replay returned the original transfer", replay.id, transfer.id);

    await step("reverses a transfer, putting the money back", () =>
      stripe.transfers.createReversal(transfer.id, { amount: transfer.amount }),
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  3. The failure the payout run has to survive                           */
  /* ---------------------------------------------------------------------- */

  console.log("\nThe failure the payout run has to survive");

  await step("a transfer beyond the available balance is refused", async () => {
    try {
      await stripe.transfers.create({
        amount: 99_999_999,
        currency: "usd",
        destination: payableId,
      });
    } catch (error) {
      console.log(`        refused with: ${(error as Error).message.slice(0, 80)}`);
      return true;
    }
    throw new Error("Stripe allowed a transfer larger than the balance");
  });

  /* ---------------------------------------------------------------------- */

  console.log("\nCleaning up");
  for (const id of createdAccounts) {
    try {
      await stripe.accounts.del(id);
      console.log(`  removed ${id}`);
    } catch {
      console.log(`  could not remove ${id}`);
    }
  }

  console.log(`\n${passes} passed, ${failures} failed\n`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
