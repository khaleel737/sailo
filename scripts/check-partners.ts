/**
 * Proves the partner programme's money actually moves, before anyone relies on it.
 *
 *   npm run check:partners
 *
 * This is Sailo paying somebody for bringing us a creator — a transfer out of
 * our own platform balance into a partner's connected account. It is NOT the
 * seller-affiliate feature, where a seller pays their own promoter out of their
 * own sale and nothing passes through us.
 *
 * The questions it answers, in order:
 *
 *   1. Does Stripe accept a transfers-only `recipient` account at all?
 *   2. Does it refuse `card_payments` on one, as the docs say it must?
 *   3. Does onboarding mint a real link?
 *   4. Can we actually transfer to a verified one, from our own balance?
 *   5. Does the idempotency key make a repeated transfer a no-op rather than
 *      a second payment?
 *   6. Does a reversal put the money back?
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

async function main() {
  console.log("\nSailo partner programme — Stripe reality check\n");

  const readPlatform = stripe.accounts.retrieve.bind(
    stripe.accounts,
  ) as unknown as () => Promise<Stripe.Account>;
  const platform = await readPlatform();
  const home = platform.country?.toUpperCase() ?? "US";
  console.log(`Platform is in ${home}\n`);

  /* ---------------------------------------------------------------------- */
  /*  1. The account shape our code actually creates                         */
  /* ---------------------------------------------------------------------- */

  console.log("The domestic partner (same country as us)");

  /*
   * No `service_agreement` — Stripe rejects `recipient` when the platform and
   * the account share a country, which is what `serviceAgreementFor` encodes.
   * This is the majority path: most partners are where we are.
   */
  const partner = await step("creates a transfers-only domestic account", () =>
    stripe.accounts.create({
      type: "express",
      country: home,
      // Transfers alone — no card_payments. A partner never charges anyone.
      capabilities: { transfers: { requested: true } },
      business_profile: {
        product_description:
          "Referral commission earned through the Sailo partner programme.",
      },
      metadata: { sailoRole: "partner", check: "check-partners" },
    }),
  );

  if (partner) {
    createdAccounts.push(partner.id);
    expect(
      "has the transfers capability requested",
      Boolean(partner.capabilities?.transfers),
      true,
    );
    /*
     * The guarantee, and it comes from the capabilities rather than from the
     * service agreement: an account with no `card_payments` has no way to
     * create a charge. If this ever started coming back populated, our
     * onboarding would be quietly putting newsletter writers through merchant
     * verification they have no use for.
     */
    expect(
      "has NO card_payments capability",
      partner.capabilities?.card_payments ?? "absent",
      "absent",
    );
    expect("cannot process charges", partner.charges_enabled, false);
  }

  /*
   * The other half of `serviceAgreementFor`. A partner abroad DOES go under
   * `recipient`, and sending it is required rather than optional there.
   */
  console.log("\nThe foreign partner (recipient agreement)");
  const abroad = home === "US" ? "GB" : "US";
  const foreign = await step(
    `creates a ${abroad} partner under the recipient agreement`,
    () =>
      stripe.accounts.create({
        type: "express",
        country: abroad,
        capabilities: { transfers: { requested: true } },
        tos_acceptance: { service_agreement: "recipient" },
        business_profile: {
          product_description: "Sailo partner commission.",
        },
        metadata: { sailoRole: "partner", check: "check-partners" },
      }),
  );

  if (foreign) {
    createdAccounts.push(foreign.id);
    expect(
      "is under the recipient service agreement",
      foreign.tos_acceptance?.service_agreement,
      "recipient",
    );
    expect("still cannot process charges", foreign.charges_enabled, false);
  }

  /*
   * And the rule itself, asserted rather than trusted — this is the bug the
   * script caught, so it stays pinned.
   */
  await step("Stripe REFUSES `recipient` for a domestic account", async () => {
    try {
      const bad = await stripe.accounts.create({
        type: "express",
        country: home,
        capabilities: { transfers: { requested: true } },
        tos_acceptance: { service_agreement: "recipient" },
        metadata: { check: "check-partners" },
      });
      createdAccounts.push(bad.id);
      throw new Error("Stripe accepted a domestic recipient account");
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes("Stripe accepted")) throw error;
      console.log(`        refused with: ${message.slice(0, 100)}`);
      return message;
    }
  });

  await step("mints a real onboarding link", async () => {
    if (!partner) throw new Error("no account to link");
    const link = await stripe.accountLinks.create({
      account: partner.id,
      refresh_url: "https://sailo.store/partners/connect?state=refresh",
      return_url: "https://sailo.store/partners/connect?state=return",
      type: "account_onboarding",
    });
    if (!link.url.startsWith("https://")) throw new Error(`bad url: ${link.url}`);
    return link;
  });

  /*
   * The refusal, asserted rather than assumed. Our code never requests
   * card_payments on a partner — this proves Stripe would stop us if it did,
   * which is what makes the recipient agreement a guarantee and not a
   * convention.
   */
  console.log("\nThe guarantee that a partner can never take payments");
  await step("Stripe REFUSES card_payments on a recipient account", async () => {
    try {
      const bad = await stripe.accounts.create({
        type: "express",
        country: abroad,
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        tos_acceptance: { service_agreement: "recipient" },
        metadata: { check: "check-partners" },
      });
      createdAccounts.push(bad.id);
      throw new Error("Stripe accepted card_payments on a recipient account");
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes("Stripe accepted")) throw error;
      // The refusal is the pass.
      return message;
    }
  });

  /* ---------------------------------------------------------------------- */
  /*  2. A partner who can actually be paid                                  */
  /* ---------------------------------------------------------------------- */

  console.log("\nPaying a verified partner");

  /*
   * A real partner finishes Stripe's hosted onboarding, which a script cannot
   * drive. Test mode's stand-in is a controller-based account with the
   * verification fields prefilled, which becomes payable immediately — the
   * same `transfers` capability and the same destination shape our transfer
   * code sends to. This is the closest a script gets to the real thing.
   */
  const verified = await step("creates a verified payable partner account", () =>
    stripe.accounts.create({
      type: "custom",
      country: "US",
      email: "partner-check@example.com",
      business_type: "individual",
      capabilities: { transfers: { requested: true } },
      /*
       * No `service_agreement`: this account is in our own country, and that
       * is exactly the combination Stripe rejects. Date and IP are the
       * acceptance itself, which a Custom account records rather than
       * collecting through hosted onboarding.
       */
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: "8.8.8.8",
      },
      business_profile: {
        mcc: "7392",
        product_description: "Sailo partner commission.",
      },
      individual: {
        first_name: "Jenny",
        last_name: "Rosen",
        email: "partner-check@example.com",
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
        object: "bank_account",
        country: "US",
        currency: "usd",
        account_holder_type: "individual",
        routing_number: "110000000",
        account_number: "000123456789",
      },
      metadata: { sailoRole: "partner", check: "check-partners" },
    }),
  );

  if (verified) createdAccounts.push(verified.id);

  const payable = await step("waits for the transfers capability to go active", async () => {
    if (!verified) throw new Error("no account");
    // Verification is not instant even in test mode; poll rather than sleep.
    for (let attempt = 0; attempt < 10; attempt++) {
      const fresh = await stripe.accounts.retrieve(verified.id);
      if (fresh.capabilities?.transfers === "active") return fresh;
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
   * Our own balance has to hold the money first. A transfer that exceeds the
   * available balance fails outright — Stripe does not retry, and adding funds
   * afterwards does not retry it either, which is exactly the failure the
   * payout run has to survive. Funding it here makes the transfer test real.
   */
  const funded = await step("funds the platform balance to transfer from", async () => {
    /*
     * Top up to a positive balance rather than charging a fixed amount. A
     * sandbox that has been used before can be well into the red from earlier
     * testing, and a flat $50 charge against a -$257 balance leaves the
     * transfer failing for a reason that has nothing to do with our code.
     */
    const before = await stripe.balance.retrieve();
    const usd = before.available.find((a) => a.currency === "usd");
    const shortfall = Math.max(0, -(usd?.amount ?? 0));
    const amount = shortfall + 10_000;

    const charge = await stripe.charges.create({
      amount,
      currency: "usd",
      // Test-mode token that lands straight in the available balance.
      source: "tok_bypassPending",
      description: "check-partners: funding the platform balance",
    });
    console.log(`        topped up $${(amount / 100).toFixed(2)}`);
    return charge;
  });

  const balance = await step("reads an available platform balance", async () => {
    const b = await stripe.balance.retrieve();
    const usd = b.available.find((a) => a.currency === "usd");
    if (!usd || usd.amount <= 0) {
      throw new Error(`no available USD balance (${JSON.stringify(b.available)})`);
    }
    console.log(`        available: $${(usd.amount / 100).toFixed(2)}`);
    return usd;
  });

  /* ---------------------------------------------------------------------- */
  /*  3. The transfer itself — exactly what payPartner sends                 */
  /* ---------------------------------------------------------------------- */

  const idempotencyKey = `partner-payout-check-${crypto.randomUUID()}`;

  const transfer = await step(
    "TRANSFERS commission from our balance to the partner",
    async () => {
      if (!payable) throw new Error("partner cannot receive transfers");
      /*
       * No `source_transaction` and no `transfer_group`, which is the whole
       * point: a partner's commission is not a slice of one buyer's payment,
       * it is a slice of a month of subscription revenue that already settled
       * into our balance. Stripe documents this case explicitly.
       */
      return stripe.transfers.create(
        {
          amount: 1234,
          currency: "usd",
          destination: payable.id,
          description: "Sailo partner commission — check-partners",
          metadata: { check: "check-partners" },
        },
        { idempotencyKey },
      );
    },
  );

  if (transfer) {
    expect("transfer amount is what we asked for", transfer.amount, 1234);
    expect("transfer landed on the partner account", transfer.destination, payable?.id);
    console.log(`        transfer: ${transfer.id}`);
  }

  /*
   * The safety net under a crashed payout run. `payPartner` stores the key
   * before it calls Stripe, so a retry after a timeout reuses it — and this
   * proves the retry returns the ORIGINAL transfer instead of sending a second
   * one. Without this guarantee, every timeout is a potential double payment.
   */
  await step("replaying the same idempotency key does NOT pay twice", async () => {
    if (!transfer || !payable) throw new Error("no transfer to replay");
    const replay = await stripe.transfers.create(
      {
        amount: 1234,
        currency: "usd",
        destination: payable.id,
        description: "Sailo partner commission — check-partners",
        metadata: { check: "check-partners" },
      },
      { idempotencyKey },
    );
    if (replay.id !== transfer.id) {
      throw new Error(`created a SECOND transfer ${replay.id} — money sent twice`);
    }
    return replay;
  });

  /*
   * The clawback path. A refund of a subscription invoice reverses the
   * commission it generated; if the money is already gone, the reversal is how
   * we get it back.
   */
  await step("reverses a transfer, putting the money back", async () => {
    if (!transfer) throw new Error("no transfer to reverse");
    const reversal = await stripe.transfers.createReversal(transfer.id, {
      amount: 1234,
    });
    if (reversal.amount !== 1234) {
      throw new Error(`reversed ${reversal.amount}, wanted 1234`);
    }
    return reversal;
  });

  /* ---------------------------------------------------------------------- */
  /*  4. The refusal we rely on                                              */
  /* ---------------------------------------------------------------------- */

  console.log("\nThe failure the payout run has to survive");
  await step("a transfer beyond the available balance is refused", async () => {
    if (!payable) throw new Error("no partner");
    try {
      await stripe.transfers.create({
        amount: 99_999_999_99,
        currency: "usd",
        destination: payable.id,
      });
      throw new Error("Stripe allowed a transfer larger than the balance");
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes("Stripe allowed")) throw error;
      console.log(`        refused with: ${message.slice(0, 90)}`);
      return message;
    }
  });

  void funded;
  void balance;
}

/** Deletes everything this script made, whatever happened. */
async function cleanup() {
  if (createdAccounts.length === 0) return;
  console.log("\nCleaning up");
  for (const id of createdAccounts) {
    try {
      await stripe.accounts.del(id);
      console.log(`  removed ${id}`);
    } catch (error) {
      console.log(`  could not remove ${id}: ${(error as Error).message}`);
    }
  }
}

main()
  .catch((error) => {
    failures++;
    console.error("\nUnhandled:", error);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${passes} passed, ${failures} failed\n`);
    process.exit(failures > 0 ? 1 : 0);
  });
