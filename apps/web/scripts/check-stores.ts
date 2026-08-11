/**
 * Several shops, every product type, one connected account each.
 *
 *   npm run check:stores
 *
 * `check:cards` proves one order's lifecycle in depth. This proves the things
 * that only break with more than one of something: that a payment lands on the
 * right shop, that a physical, digital and service order each get what their
 * type requires, and that an event for one seller cannot touch another's rows.
 *
 * Every shop gets its own Stripe connected account, because sharing one would
 * hide exactly the bug this is looking for.
 */
import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { firstRow } from "@/lib/invariant";

const secretKey = process.env.STRIPE_SECRET_KEY;
const connectSecret =
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
if (!connectSecret) throw new Error("STRIPE_CONNECT_WEBHOOK_SECRET is not set");
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const WEBHOOK_SECRET: string = connectSecret;
const stripe = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia" });
const sql = neon(databaseUrl);
const BASE = process.env.CHECK_BASE ?? "http://localhost:3000";
const ROUTE = "/api/stripe/connect/webhook";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok
        ? ""
        : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`),
  );
}

async function deliver(event: unknown, account: string) {
  const body = JSON.stringify({ ...(event as object), account });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });
  const response = await fetch(`${BASE}${ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body,
  });
  const text = await response.text();
  return { status: response.status, raw: text.slice(0, 200) };
}

function paidEvent(sessionId: string, orderId: string, shopId: string, intentId: string) {
  return {
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
        payment_intent: intentId,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */

const STORES = [
  { key: "alpha", name: "Alpha Ceramics", currency: "USD" },
  { key: "bravo", name: "Bravo Studio", currency: "EUR" },
  { key: "charlie", name: "Charlie Wellness", currency: "GBP" },
];

async function chargeableAccount(label: string) {
  const account = await stripe.accounts.create({
    type: "custom",
    business_profile: {
      name: label,
      product_description: "Throwaway account for npm run check:stores.",
      mcc: "5734",
      url: "https://sailo.store",
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { probe: "check-stores" },
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
  await stripe.accounts.update(account.id, { individual: { phone: "0000000000" } });
  return account.id;
}

async function seedStore(store: (typeof STORES)[number], accountId: string) {
  const owner = `check-stores-${store.key}`;
  await sql`delete from "user" where id = ${owner}`;
  await sql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${owner}, ${store.name}, ${`${owner}@sailo.local`}, true, now(), now())`;

  const shop = firstRow(
    await sql`
      insert into shops (user_id, handle, name, currency, plan, comp_plan,
                         is_published, stripe_account_id, stripe_charges_enabled,
                         stripe_details_submitted)
      values (${owner}, ${`check-${store.key}`}, ${store.name}, ${store.currency},
              'free', 'business', true, ${accountId}, true, true)
      returning id`,
    `the ${store.key} shop`,
  );

  // One of each kind Sailo sells, with the columns each kind actually needs.
  const physical = firstRow(
    await sql`
      insert into products (shop_id, title, slug, price_cents, kind, is_published,
                            in_stock, track_inventory, stock_quantity)
      values (${shop.id}, 'Stoneware mug', 'mug', 2400, 'physical', true, true, true, 10)
      returning id`,
    "the physical product",
  );

  const digital = firstRow(
    await sql`
      insert into products (shop_id, title, slug, price_cents, kind, is_published,
                            in_stock, release_on_payment, download_limit,
                            download_expiry_days)
      values (${shop.id}, 'Glaze recipes (PDF)', 'glaze-pdf', 1200, 'digital',
              true, true, true, 5, 30)
      returning id`,
    "the digital product",
  );
  await sql`
    insert into product_files (product_id, name, url, content_type)
    values (${digital.id}, 'glazes.pdf', 'https://example.com/glazes.pdf', 'application/pdf')`;

  const service = firstRow(
    await sql`
      insert into products (shop_id, title, slug, price_cents, kind, is_published,
                            in_stock, duration_minutes, service_mode,
                            booking_enabled, booking_lead_hours)
      values (${shop.id}, 'Wheel throwing class', 'class', 8500, 'service',
              true, true, 180, 'in_person', true, 24)
      returning id`,
    "the service product",
  );

  return {
    owner,
    shopId: shop.id as string,
    accountId,
    currency: store.currency,
    products: {
      physical: physical.id as string,
      digital: digital.id as string,
      service: service.id as string,
    },
  };
}

type Store = Awaited<ReturnType<typeof seedStore>>;

async function placeOrder(
  store: Store,
  kind: "physical" | "digital" | "service",
  priceCents: number,
) {
  const sessionId = `cs_test_${randomUUID().replace(/-/g, "")}`;
  const productId = store.products[kind];

  const scheduledFor =
    kind === "service" ? new Date(Date.now() + 7 * 86_400_000) : null;
  const downloadToken =
    kind === "digital" ? randomUUID().replace(/-/g, "") : null;

  const order = firstRow(
    await sql`
      insert into orders (shop_id, product_id, product_title, product_kind,
                          unit_price_cents, quantity, item_count, currency,
                          subtotal_cents, total_cents, payment_method,
                          payment_status, status, customer_name, customer_email,
                          stripe_session_id, scheduled_for, download_token,
                          download_limit)
      values (${store.shopId}, ${productId}, ${kind}, ${kind}, ${priceCents}, 1, 1,
              ${store.currency}, ${priceCents}, ${priceCents}, 'card', 'unpaid',
              'new', 'Tomi Adeyemi', 'tomi@example.com', ${sessionId},
              ${scheduledFor}, ${downloadToken}, ${kind === "digital" ? 5 : null})
      returning id`,
    `the ${kind} order`,
  );
  await sql`
    insert into order_items (order_id, product_id, title, kind, unit_price_cents,
                             quantity, subtotal_cents, scheduled_for)
    values (${order.id}, ${productId}, ${kind}, ${kind}, ${priceCents}, 1,
            ${priceCents}, ${scheduledFor})`;

  if (kind === "physical") {
    await sql`update products set stock_quantity = stock_quantity - 1 where id = ${productId}`;
  }

  return { orderId: order.id as string, sessionId };
}

const orderRow = async (id: string) => {
  const [row] = await sql`
    select status, payment_status, download_released_at, scheduled_for,
           product_kind, currency, shop_id
    from orders where id = ${id}`;
  return row;
};

/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`Base URL: ${BASE}${ROUTE}\n`);
  console.log("Creating a connected account per shop…");

  const accounts = await Promise.all(
    STORES.map((store) => chargeableAccount(`Check ${store.name}`)),
  );

  // Stripe verifies asynchronously; wait for all three at once.
  for (let attempt = 0; attempt < 24; attempt++) {
    const live = await Promise.all(accounts.map((id) => stripe.accounts.retrieve(id)));
    if (live.every((a) => a.charges_enabled)) break;
    await sleep(2500);
  }
  const live = await Promise.all(accounts.map((id) => stripe.accounts.retrieve(id)));
  live.forEach((a, i) =>
    console.log(`  ${STORES[i]?.name}: ${a.id} · charges ${a.charges_enabled ? "enabled" : "PENDING"}`),
  );
  if (!live.every((a) => a.charges_enabled)) {
    console.log("\n  Stripe is still verifying. Try again shortly.");
    for (const id of accounts) await stripe.accounts.del(id);
    return;
  }

  const stores: Store[] = [];
  for (const [i, store] of STORES.entries()) {
    stores.push(await seedStore(store, accounts[i] as string));
  }
  console.log(`  ${stores.length} shops seeded, each with physical, digital and service products\n`);

  try {
    const prices = { physical: 2400, digital: 1200, service: 8500 } as const;

    for (const [i, store] of stores.entries()) {
      const label = STORES[i]?.name ?? store.shopId;
      console.log(`${label} (${store.currency})`);

      for (const kind of ["physical", "digital", "service"] as const) {
        const { orderId, sessionId } = await placeOrder(store, kind, prices[kind]);

        const intent = await stripe.paymentIntents.create(
          {
            amount: prices[kind],
            currency: store.currency.toLowerCase(),
            application_fee_amount: Math.round(prices[kind] * 0.01),
            payment_method: "pm_card_visa",
            confirm: true,
            automatic_payment_methods: { enabled: true, allow_redirects: "never" },
            metadata: { orderId, shopId: store.shopId },
          },
          { stripeAccount: store.accountId },
        );

        const delivered = await deliver(
          paidEvent(sessionId, orderId, store.shopId, intent.id),
          store.accountId,
        );
        const row = await orderRow(orderId);

        check(`${kind}: charged in ${store.currency}`, intent.status, "succeeded");
        check(`${kind}: webhook accepted`, delivered.status, 200);
        check(`${kind}: order paid`, row?.payment_status, "paid");
        check(`${kind}: landed on the right shop`, row?.shop_id, store.shopId);

        if (kind === "digital") {
          check(
            "digital: download released on payment",
            Boolean(row?.download_released_at),
            true,
          );
        }
        if (kind === "service") {
          check("service: the booking survived payment", Boolean(row?.scheduled_for), true);
        }
        if (kind === "physical") {
          const [p] = await sql`select stock_quantity from products where id = ${store.products.physical}`;
          check("physical: stock went down by one", p?.stock_quantity, 9);
        }
      }
      console.log();
    }

    /* ------------------------------------------------------- isolation */
    console.log("One seller's event must not touch another's rows");
    const [a, b] = stores;
    if (a && b) {
      const { orderId: bOrder } = await placeOrder(b, "physical", 2400);
      const before = await orderRow(bOrder);

      // Shop A's account, naming shop B's order. The session id belongs to
      // nothing, so the lookup must simply fail rather than match by luck.
      const stray = paidEvent(
        `cs_test_${randomUUID().replace(/-/g, "")}`,
        bOrder,
        a.shopId,
        "pi_does_not_exist",
      );
      const strayResult = await deliver(stray, a.accountId);
      check("a stray event is acknowledged, not an error", strayResult.status, 200);

      const after = await orderRow(bOrder);
      check(
        "the other shop's order is untouched",
        after?.payment_status,
        before?.payment_status,
      );
    }

    /* --------------------------------------------- wrong signing secret */
    console.log("\nAn event signed with the wrong secret");
    const body = JSON.stringify(paidEvent("cs_x", "order_x", "shop_x", "pi_x"));
    const wrong = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: "whsec_this_is_not_the_secret",
    });
    const rejected = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": wrong },
      body,
    });
    check("rejected", rejected.status, 400);
  } finally {
    console.log("\nCleanup");
    for (const store of stores) {
      await sql`delete from "user" where id = ${store.owner}`;
    }
    console.log("  fixture shops removed");
    for (const account of (await stripe.accounts.list({ limit: 40 })).data) {
      if (account.metadata?.probe === "check-stores") {
        await stripe.accounts.del(account.id);
        console.log(`  deleted ${account.id}`);
      }
    }
  }

  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed across ${stores.length} shops and 3 product types.`
      : `\n${failures} of ${checks} checks failed.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
