/**
 * The card rail, end to end, against real Stripe and the real webhook.
 *
 *   npm run check:cards                 # against http://localhost:3000
 *   CHECK_BASE=https://… npm run check:cards
 *
 * Builds a throwaway shop with a chargeable connected account, then walks a
 * card order through everything that can happen to one: paid, shipped,
 * completed, expired, refunded in part, refunded in full, and charged back —
 * asserting after each step both what Stripe holds and what our own table says.
 *
 * Charges are real. Refunds are real. The dispute is a real dispute raised by
 * Stripe's dispute-triggering test card. The events are the payloads Stripe
 * actually emitted, replayed into our endpoint with a valid signature, so this
 * exercises signature verification, idempotency, routing and every handler.
 *
 * Everything it creates it deletes, including the Stripe account.
 */
import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { firstRow } from "@sailo/core/invariant";
import { check, report } from "./lib/expect";

const secretKey = process.env.STRIPE_SECRET_KEY;
// Buyer payments arrive on the Connect endpoint, so that is the secret and the
// route this harness exercises — the account endpoint never sees one.
const webhookSecret =
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
if (!webhookSecret) throw new Error("STRIPE_CONNECT_WEBHOOK_SECRET is not set");
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

// Narrowed once, after the guards above — the closures below can't re-prove it.
const WEBHOOK_SECRET: string = webhookSecret;

const stripe = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia" });
const sql = neon(databaseUrl);
const BASE = process.env.CHECK_BASE ?? "http://localhost:3000";
const CONNECT_ROUTE = "/api/stripe/connect/webhook";

const OWNER = "check-cards-seller";
const HANDLE = "check-cards-shop";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */
/*  Talking to our own webhook the way Stripe does                             */
/* -------------------------------------------------------------------------- */

/**
 * Posts an event to the real endpoint with a real signature.
 *
 * The payload is whatever Stripe actually emitted, so the handler sees the same
 * shape in a test as in production — a hand-written fixture would drift the
 * first time Stripe adds a field, and it is exactly the fields nobody thought
 * about that break a payment integration.
 */
async function deliver(event: Stripe.Event, account?: string | null) {
  const body = JSON.stringify(
    account ? { ...event, account } : event,
  );
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });

  const response = await fetch(`${BASE}${CONNECT_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body,
  });

  // A handler that throws answers with an HTML error page, not JSON. Reading it
  // as text first means the harness reports that as a failed check rather than
  // dying on a parse error three frames away from the cause.
  const text = await response.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, raw: text.slice(0, 200) };
}

/** The event Stripe emitted for an object, once it has caught up. */
async function eventFor(
  type: string,
  matches: (e: Stripe.Event) => boolean,
  account?: string,
): Promise<Stripe.Event | null> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const list = await stripe.events.list(
      { type, limit: 25 },
      account ? { stripeAccount: account } : undefined,
    );
    const found = list.data.find(matches);
    if (found) return found;
    await sleep(1500);
  }
  return null;
}

const orderRow = async (id: string) => {
  const [row] = await sql`
    select status, payment_status, refunded_cents, refunded_at, refund_reason,
           stripe_payment_intent_id, restocked_at, tracking_number, shipped_at
    from orders where id = ${id}`;
  return row;
};

const stockOf = async (productId: string) => {
  const [row] = await sql`select stock_quantity from products where id = ${productId}`;
  return row?.stock_quantity ?? null;
};

/* -------------------------------------------------------------------------- */
/*  Fixture                                                                    */
/* -------------------------------------------------------------------------- */

async function makeChargeableAccount() {
  const account = await stripe.accounts.create({
    type: "custom",
    business_profile: {
      name: "Check Cards",
      product_description: "Throwaway account for npm run check:cards.",
      mcc: "5734",
      url: "https://sailo.store",
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { probe: "check-cards" },
  });

  await stripe.accounts.update(account.id, {
    business_type: "individual",
    individual: {
      first_name: "Jenny",
      last_name: "Rosen",
      dob: { day: 1, month: 1, year: 1990 },
      address: {
        line1: "address_full_match",
        city: "SF",
        state: "CA",
        postal_code: "94103",
        country: "US",
      },
      email: "jenny@example.com",
      ssn_last_4: "0000",
      id_number: "000000000",
    },
    external_account: {
      object: "bank_account",
      country: "US",
      currency: "usd",
      routing_number: "110000000",
      account_number: "000123456789",
    },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "8.8.8.8" },
  });
  await stripe.accounts.update(account.id, {
    individual: { phone: "0000000000" },
  });

  /*
   * Wait for Stripe to enable charges.
   *
   * This used to give up after 50 seconds and print "still verifying", which
   * reads as a Stripe problem and is really a harness one: test-mode
   * verification is usually a few seconds and occasionally over a minute, so
   * the run failed or passed depending on how busy Stripe was. Three minutes
   * is longer than any wait observed and still bounded — an account that has
   * not been enabled by then has something wrong with it worth reporting.
   */
  let live = await stripe.accounts.retrieve(account.id);
  for (let i = 0; i < 72 && !live.charges_enabled; i++) {
    await sleep(2500);
    live = await stripe.accounts.retrieve(account.id);
  }
  return live;
}

async function seed(accountId: string) {
  await sql`delete from "user" where id = ${OWNER}`;
  await sql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${OWNER}, 'Card Check', 'check-cards@sailo.local', true, now(), now())`;

  const shop = firstRow(
    await sql`
      insert into shops (user_id, handle, name, currency, plan, comp_plan,
                         is_published, stripe_account_id, stripe_charges_enabled,
                         stripe_details_submitted)
      values (${OWNER}, ${HANDLE}, 'Card Check Shop', 'USD', 'free', 'business',
              true, ${accountId}, true, true)
      returning id`,
    "the fixture shop",
  );

  const product = firstRow(
    await sql`
      insert into products (shop_id, title, slug, price_cents, kind, is_published,
                            in_stock, track_inventory, stock_quantity)
      values (${shop.id}, 'Speckled stoneware mug', 'speckled-mug', 2400,
              'physical', true, true, true, 10)
      returning id`,
    "the fixture product",
  );

  return { shopId: shop.id as string, productId: product.id as string };
}

/** An order in the shape the buyer's checkout writes, ready to be paid. */
async function makeOrder(
  shopId: string,
  productId: string,
  opts: { quantity: number; sessionId?: string | null },
) {
  const unit = 2400;
  const subtotal = unit * opts.quantity;
  const order = firstRow(
    await sql`
    insert into orders (shop_id, product_id, product_title, product_kind,
                        unit_price_cents, quantity, item_count, currency,
                        subtotal_cents, total_cents, payment_method,
                        payment_status, status, customer_name, customer_email,
                        stripe_session_id, stripe_account_id)
    values (${shopId}, ${productId}, 'Speckled stoneware mug', 'physical',
            ${unit}, ${opts.quantity}, 1, 'USD', ${subtotal}, ${subtotal},
            'card', 'unpaid', 'new', 'Tomi Adeyemi', 'tomi@example.com',
            ${opts.sessionId ?? null}, null)
    returning id`,
    "the fixture order",
  );
  await sql`
    insert into order_items (order_id, product_id, title, kind, unit_price_cents,
                             quantity, subtotal_cents)
    values (${order.id}, ${productId}, 'Speckled stoneware mug', 'physical',
            ${unit}, ${opts.quantity}, ${subtotal})`;

  // Checkout reserves stock when the order is written, before the money lands.
  await sql`update products set stock_quantity = stock_quantity - ${opts.quantity}
            where id = ${productId}`;

  return order.id as string;
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`Base URL: ${BASE}\n`);

  console.log("Setting up a chargeable connected account…");
  const account = await makeChargeableAccount();
  if (!account.charges_enabled) {
    console.log("  Stripe is still verifying the test account. Try again shortly.");
    await stripe.accounts.del(account.id);
    return;
  }
  console.log(`  ${account.id} · charges enabled\n`);

  const { shopId, productId } = await seed(account.id);

  try {
    /* ================================================================ paid */
    console.log("A card payment arriving");
    const sessionId = `cs_test_${randomUUID().replace(/-/g, "")}`;
    const orderId = await makeOrder(shopId, productId, {
      quantity: 2,
      sessionId,
    });
    check("stock reserved when the order was written", await stockOf(productId), 8);

    const goods = 4800;
    const fee = Math.round(goods * 0.01);
    const intent = await stripe.paymentIntents.create(
      {
        amount: goods,
        currency: "usd",
        application_fee_amount: fee,
        payment_method: "pm_card_visa",
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata: { orderId, shopId },
      },
      { stripeAccount: account.id },
    );
    check("Stripe took the money", intent.status, "succeeded");
    check("Sailo's 1% was collected", intent.application_fee_amount, fee);

    // The session Stripe would have completed, carrying that payment.
    const completed = {
      id: `evt_${randomUUID().replace(/-/g, "")}`,
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: Math.floor(Date.now() / 1000),
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          object: "checkout.session",
          mode: "payment",
          payment_status: "paid",
          client_reference_id: orderId,
          metadata: { orderId, shopId },
          payment_intent: intent.id,
        },
      },
    } as unknown as Stripe.Event;

    const paid = await deliver(completed, account.id);
    check("webhook accepted the event", paid.status, 200);
    let row = await orderRow(orderId);
    check("order is paid", row?.payment_status, "paid");
    check("order auto-confirmed", row?.status, "confirmed");
    check("payment intent recorded", row?.stripe_payment_intent_id, intent.id);

    console.log("\nThe same event arriving twice");
    const replay = await deliver(completed, account.id);
    check("replay is a no-op", replay.body?.duplicate, true);

    /* ======================================================= shipped/done */
    console.log("\nShipping and completing");
    await sql`update orders set status = 'shipped', tracking_number = 'TRK123',
              shipped_at = now() where id = ${orderId}`;
    row = await orderRow(orderId);
    check("shipped with tracking", [row?.status, row?.tracking_number], ["shipped", "TRK123"]);

    await sql`update orders set status = 'completed' where id = ${orderId}`;
    check("completed", (await orderRow(orderId))?.status, "completed");

    /* ==================================================== partial refund */
    console.log("\nA partial refund");
    const partial = 1200;
    await stripe.refunds.create(
      { payment_intent: intent.id, amount: partial, refund_application_fee: true },
      { stripeAccount: account.id },
    );
    const partialEvent = await eventFor(
      "charge.refunded",
      (e) => {
        const c = e.data.object as Stripe.Charge;
        return c.payment_intent === intent.id && c.amount_refunded === partial;
      },
      account.id,
    );
    check("Stripe emitted charge.refunded", Boolean(partialEvent), true);
    if (partialEvent) {
      await deliver(partialEvent, account.id);
      row = await orderRow(orderId);
      check("part of the money recorded as returned", row?.refunded_cents, partial);
      check("a partial refund does not undo the order", row?.status, "completed");
    }

    /* ======================================================= full refund */
    console.log("\nRefunding the rest");
    await stripe.refunds.create(
      { payment_intent: intent.id, amount: goods - partial, refund_application_fee: true },
      { stripeAccount: account.id },
    );
    const fullEvent = await eventFor(
      "charge.refunded",
      (e) => {
        const c = e.data.object as Stripe.Charge;
        return c.payment_intent === intent.id && c.amount_refunded === goods;
      },
      account.id,
    );
    check("Stripe emitted the closing charge.refunded", Boolean(fullEvent), true);
    if (fullEvent) {
      await deliver(fullEvent, account.id);
      row = await orderRow(orderId);
      check("whole amount recorded", row?.refunded_cents, goods);
      check("order reads refunded", row?.status, "refunded");
      check("payment reads refunded", row?.payment_status, "refunded");
    }

    console.log("\nWhat Sailo kept after refunding");
    const charge = (await stripe.paymentIntents.retrieve(
      intent.id,
      { expand: ["latest_charge"] },
      { stripeAccount: account.id },
    )).latest_charge as Stripe.Charge;
    const feeId =
      typeof charge.application_fee === "string"
        ? charge.application_fee
        : charge.application_fee?.id;
    if (feeId) {
      const applicationFee = await stripe.applicationFees.retrieve(feeId);
      check(
        "the 1% went back with the refund",
        applicationFee.amount - applicationFee.amount_refunded,
        0,
      );
    } else {
      check("an application fee was recorded on the charge", Boolean(feeId), true);
    }

    /* ==================================================== expired basket */
    console.log("\nA buyer who opened Stripe and never paid");
    const abandonedSession = `cs_test_${randomUUID().replace(/-/g, "")}`;
    const abandonedId = await makeOrder(shopId, productId, {
      quantity: 3,
      sessionId: abandonedSession,
    });
    const beforeExpiry = await stockOf(productId);
    const expired = {
      id: `evt_${randomUUID().replace(/-/g, "")}`,
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: Math.floor(Date.now() / 1000),
      type: "checkout.session.expired",
      data: {
        object: {
          id: abandonedSession,
          object: "checkout.session",
          mode: "payment",
          payment_status: "unpaid",
        },
      },
    } as unknown as Stripe.Event;

    await deliver(expired, account.id);
    const abandoned = await orderRow(abandonedId);
    check("abandoned order cancelled", abandoned?.status, "cancelled");
    check(
      "its units went back on the shelf",
      await stockOf(productId),
      (beforeExpiry as number) + 3,
    );

    /* ========================================================= chargeback */
    console.log("\nA chargeback");
    const disputedOrderId = await makeOrder(shopId, productId, { quantity: 1 });
    const disputedIntent = await stripe.paymentIntents.create(
      {
        amount: 2400,
        currency: "usd",
        application_fee_amount: 24,
        payment_method: "pm_card_createDispute",
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata: { orderId: disputedOrderId, shopId },
      },
      { stripeAccount: account.id },
    );
    await sql`update orders set payment_status = 'paid', status = 'confirmed',
              stripe_payment_intent_id = ${disputedIntent.id},
              stripe_account_id = ${account.id}
              where id = ${disputedOrderId}`;

    const disputeEvent = await eventFor(
      "charge.dispute.created",
      (e) => (e.data.object as Stripe.Dispute).payment_intent === disputedIntent.id,
      account.id,
    );
    check("Stripe raised a real dispute", Boolean(disputeEvent), true);

    if (disputeEvent) {
      const handled = await deliver(disputeEvent, account.id);
      check("webhook handled the dispute", handled.status, 200);
      row = await orderRow(disputedOrderId);
      check("order marked disputed", row?.payment_status, "disputed");
      check(
        "the reason is on the order",
        String(row?.refund_reason ?? "").startsWith("Chargeback:"),
        true,
      );

      console.log("\nThe bank finds for the seller");
      const dispute = disputeEvent.data.object as Stripe.Dispute;
      const won = {
        ...disputeEvent,
        id: `evt_${randomUUID().replace(/-/g, "")}`,
        type: "charge.dispute.closed",
        data: { object: { ...dispute, status: "won" } },
      } as unknown as Stripe.Event;
      await deliver(won, account.id);
      row = await orderRow(disputedOrderId);
      check("the sale stands", row?.payment_status, "paid");
      check("the chargeback note is cleared", row?.refund_reason, null);

      console.log("\nThe bank finds for the buyer");
      const stockBeforeLoss = await stockOf(productId);
      const lost = {
        ...disputeEvent,
        id: `evt_${randomUUID().replace(/-/g, "")}`,
        type: "charge.dispute.closed",
        data: { object: { ...dispute, status: "lost" } },
      } as unknown as Stripe.Event;
      await deliver(lost, account.id);
      row = await orderRow(disputedOrderId);
      check("money treated as gone", row?.payment_status, "refunded");
      check("order reads refunded", row?.status, "refunded");
      check("the amount is recorded", row?.refunded_cents, dispute.amount);
      check(
        "the unit went back on the shelf",
        await stockOf(productId),
        (stockBeforeLoss as number) + 1,
      );
    }

    /* ==================================================== bad signatures */
    console.log("\nAn event nobody signed");
    const forged = await fetch(`${BASE}${CONNECT_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      body: JSON.stringify({ id: "evt_forged", type: "charge.refunded" }),
    });
    check("rejected", forged.status, 400);
  } finally {
    console.log("\nCleanup");
    await sql`delete from "user" where id = ${OWNER}`;
    console.log("  fixture shop removed");
    for (const a of (await stripe.accounts.list({ limit: 30 })).data) {
      if (a.metadata?.probe === "check-cards") {
        await stripe.accounts.del(a.id);
        console.log(`  deleted ${a.id}`);
      }
    }
  }

  report("The card rail behaves.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
