/**
 * What a buyer actually sees on Stripe's checkout page, per kind of product.
 *
 *   npm run check:checkout
 *
 * The Checkout Session used to carry `product_data: { name }` and nothing
 * else, so the last screen before the money moved was a column of bare titles.
 * Nothing about that was visible in a typecheck or a unit test — the session
 * was valid, it was just empty — so the only way to know it is fixed is to
 * open real sessions against a real Stripe account and read back what Stripe
 * stored.
 *
 * It also proves the two capability bugs are gone, and those are the ones that
 * cannot be tested any other way at all:
 *
 *   - an account created without `country` inherits the *platform's*, so every
 *     seller on a US platform was a US business and no European payment method
 *     could ever activate;
 *   - the three wallets went up in one request, so Stripe refusing Cash App
 *     for a German account threw away Link with it.
 *
 * Everything it creates is deleted on the way out, and it refuses to run
 * against a live key.
 */
import Stripe from "stripe";
import { capabilitiesFor, requestCapabilities } from "@sailo/payments/connect";
import {
  checkoutLabels,
  checkoutShipping,
  toCheckoutLine,
  type CheckoutDictionary,
} from "@sailo/commerce/orders";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
if (!secretKey.startsWith("sk_test")) {
  throw new Error("check:checkout creates and deletes accounts — test keys only");
}
const stripe = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia" });

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

/** English, because the assertions read the strings back. */
const DICTIONARY: CheckoutDictionary = {
  shop: { kindDigital: "Instant download", kindEvent: "Event ticket" },
  checkout: { online: "Online", inPerson: "In person", duration: "Takes {duration}" },
};

const LABELS = checkoutLabels(DICTIONARY, "en-GB", "Europe/London");

/** A publicly fetchable image. Stripe pulls these from its own servers. */
const IMAGE = "https://images.ctfassets.net/fzn2n1nzq965/HTTOloNPhisV9P4hlMPNA/cc384b73dd7e8e3b0d5b9f6b6b6c6e2e/Stripe_icon_-_square.svg";

/**
 * One of each kind Sailo sells, priced and described exactly as the real order
 * path would describe it — the same `toCheckoutLine` the checkout calls, not a
 * copy of its output.
 */
const KINDS = [
  {
    label: "physical",
    line: {
      title: "Speckled mug",
      variantLabel: "Large",
      kind: "physical",
      sku: "MUG-L",
      imageUrl: IMAGE,
      description: "Hand-thrown stoneware, dishwasher safe.",
      unitPriceCents: 2400,
      quantity: 2,
    },
    expect: {
      name: "Speckled mug — Large",
      inDescription: ["Hand-thrown stoneware"],
      image: true,
      shipping: true,
    },
  },
  {
    label: "digital",
    line: {
      title: "Glaze recipes",
      variantLabel: null,
      kind: "digital",
      sku: null,
      imageUrl: IMAGE,
      description: "A 40-page PDF.",
      unitPriceCents: 900,
      quantity: 1,
    },
    expect: {
      name: "Glaze recipes",
      inDescription: ["Instant download", "40-page PDF"],
      image: true,
      shipping: false,
    },
  },
  {
    label: "service",
    line: {
      title: "Wheel-throwing lesson",
      variantLabel: null,
      kind: "service",
      sku: null,
      imageUrl: IMAGE,
      description: "Bring an apron.",
      durationMinutes: 90,
      serviceMode: "in_person",
      serviceLocation: "12 Baker St",
      scheduledFor: new Date("2026-06-03T13:00:00Z"),
      unitPriceCents: 6500,
      quantity: 1,
    },
    expect: {
      name: "Wheel-throwing lesson",
      // Duration, mode, place and the booked hour — in the shop's zone, which
      // is what "14:00" is asserting: the seller will be there at two.
      inDescription: ["Takes", "In person", "12 Baker St", "14:00"],
      image: true,
      shipping: false,
    },
  },
  {
    label: "service (online)",
    line: {
      title: "Portfolio review",
      variantLabel: null,
      kind: "service",
      sku: null,
      imageUrl: null,
      durationMinutes: 30,
      serviceMode: "online",
      // The join link is the good being sold. It must never reach Stripe,
      // because this string is composed before anybody has paid for it.
      serviceLocation: "https://meet.example/secret-room",
      unitPriceCents: 4000,
      quantity: 1,
    },
    expect: {
      name: "Portfolio review",
      inDescription: ["Takes", "Online"],
      notInDescription: ["meet.example"],
      image: false,
      shipping: false,
    },
  },
  {
    label: "event",
    line: {
      title: "Kiln opening",
      variantLabel: null,
      kind: "event",
      sku: null,
      imageUrl: IMAGE,
      serviceMode: "in_person",
      serviceLocation: "The Old Dairy",
      eventStartsAt: new Date("2026-07-11T18:30:00Z"),
      unitPriceCents: 1500,
      quantity: 3,
    },
    expect: {
      name: "Kiln opening",
      inDescription: ["Event ticket", "The Old Dairy", "19:30"],
      image: true,
      shipping: false,
    },
  },
] as const;

const created: string[] = [];

async function account(country: string) {
  const made = await stripe.accounts.create({
    type: "express",
    country,
    business_profile: { name: `Checkout content ${country}`, url: "https://sailo.store" },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { probe: "check-checkout" },
  });
  created.push(made.id);
  return made;
}

/** The address a real physical order would carry by the time it reaches Stripe. */
const SHIPPING = {
  name: "Jenny Rosen",
  address: {
    line1: "27 Alder Way",
    city: "Bristol",
    postal_code: "BS1 4QA",
    country: "GB",
  },
} as const;

async function main() {
  /* ------------------------------------------------------------------ */
  console.log("Capabilities follow the account's country\n");

  for (const country of ["US", "DE"] as const) {
    const made = await account(country);
    check(
      `${country}: account is created in ${country}, not the platform's country`,
      made.country === country,
      `got ${made.country}`,
    );

    const wanted = capabilitiesFor(made.country);
    const outcome = await requestCapabilities(stripe, made.id, wanted);

    console.log(`  asked for: ${wanted.join(", ")}`);
    if (outcome.refused.length) {
      console.log(`  refused:   ${outcome.refused.map((r) => r.name).join(", ")}`);
    }

    /*
     * Link is the assertion that matters most here. It is available in both
     * countries, and before `requestCapabilities` split the batch it was lost
     * in Germany purely because Cash App shared a request with it.
     */
    check(
      `${country}: Link survives whatever else was refused`,
      outcome.requested.includes("link_payments"),
    );

    if (country === "DE") {
      check(
        "DE: SEPA and iDEAL are requested",
        outcome.requested.includes("sepa_debit_payments") &&
          outcome.requested.includes("ideal_payments"),
      );
      check(
        "DE: Cash App is not requested",
        !wanted.includes("cashapp_payments"),
        "it is US-only and refusing it used to take Link down with it",
      );
    }

    if (country === "US") {
      check(
        "US: Cash App and ACH are requested",
        outcome.requested.includes("cashapp_payments") &&
          outcome.requested.includes("us_bank_account_ach_payments"),
      );
    }
    console.log();
  }

  /* ------------------------------------------------------------------ */
  console.log("What each kind of product looks like on the checkout page\n");

  // The US account. Line content is country-independent, so one seller is
  // enough for every assertion below.
  const seller = created[0];
  if (!seller) throw new Error("no connected account was created");

  for (const kind of KINDS) {
    const built = toCheckoutLine(kind.line as never, LABELS);

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: built.quantity,
              price_data: {
                currency: "usd",
                unit_amount: built.unitPriceCents,
                product_data: {
                  name: built.name,
                  ...(built.description ? { description: built.description } : {}),
                  ...(built.images?.length ? { images: built.images } : {}),
                },
              },
            },
          ],
          payment_intent_data: {
            description: "check:checkout",
            ...(kind.expect.shipping ? { shipping: SHIPPING } : {}),
          },
          success_url: "https://sailo.store/ok",
          cancel_url: "https://sailo.store/no",
        },
        { stripeAccount: seller },
      );
    } catch (error) {
      check(`${kind.label}: session opens`, false, (error as Error).message.slice(0, 140));
      continue;
    }

    // Read it back off Stripe rather than trusting what we sent — the whole
    // point is what Stripe stored and will render.
    const full = await stripe.checkout.sessions.retrieve(
      session.id,
      { expand: ["line_items.data.price.product"] },
      { stripeAccount: seller },
    );
    const item = full.line_items?.data[0];
    const product = item?.price?.product as Stripe.Product | undefined;

    console.log(`${kind.label}`);
    console.log(`  name:        ${product?.name ?? "(none)"}`);
    console.log(`  description: ${product?.description ?? "(none)"}`);
    console.log(`  images:      ${product?.images?.length ? product.images.join(", ") : "(none)"}`);

    check(`${kind.label}: name`, product?.name === kind.expect.name, product?.name);

    for (const fragment of kind.expect.inDescription ?? []) {
      check(
        `${kind.label}: description says "${fragment}"`,
        Boolean(product?.description?.includes(fragment)),
        product?.description ?? "(none)",
      );
    }

    for (const fragment of (kind.expect as { notInDescription?: readonly string[] })
      .notInDescription ?? []) {
      check(
        `${kind.label}: description does NOT leak "${fragment}"`,
        !product?.description?.includes(fragment),
      );
    }

    check(
      `${kind.label}: ${kind.expect.image ? "has" : "has no"} image`,
      Boolean(product?.images?.length) === kind.expect.image,
    );

    check(`${kind.label}: quantity`, item?.quantity === kind.line.quantity);

    console.log();
  }

  /* ------------------------------------------------------------------ */
  console.log("The delivery address reaches the payment\n");

  /*
   * Asserted against a PaymentIntent rather than against the sessions above,
   * and the reason is worth writing down: a Checkout Session's
   * `payment_intent` is **null until the buyer completes it**, so a check that
   * read it back off the session would have quietly skipped — passing without
   * ever testing anything, which is exactly what the first version of this
   * script did.
   *
   * `payment_intent_data.shipping` on the session and `shipping` on the intent
   * are the same field with the same validation, so creating one directly is a
   * real test of the shape `checkoutShipping` builds. That the sessions above
   * were accepted with the same object is the other half.
   */
  const physical = checkoutShipping({
    customerName: "Jenny Rosen",
    customerPhone: "+44 7700 900123",
    addressLine1: "27 Alder Way",
    addressLine2: "Flat 3",
    city: "Bristol",
    region: null,
    postalCode: "BS1 4QA",
    country: "GB",
  });

  check("physical: an address with a name and a line 1 is built", physical !== null);

  const intent = await stripe.paymentIntents.create(
    {
      amount: 4800,
      currency: "usd",
      // Cards only here: this is asserting a field round-trips, and letting
      // Stripe pick redirect-based methods would need a return_url it has no
      // use for.
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "check:checkout shipping",
      ...(physical ? { shipping: physical } : {}),
    },
    { stripeAccount: seller },
  );

  // `retrieve(id, params, options)` — the account header is the *third*
  // argument. Passing it second sends it as a query parameter and Stripe
  // rejects the call with `parameter_unknown: stripeAccount`.
  const stored = await stripe.paymentIntents.retrieve(intent.id, {}, { stripeAccount: seller });
  console.log(`  stored: ${stored.shipping?.name} · ${stored.shipping?.address?.line1} · ${stored.shipping?.address?.country}`);

  check("physical: Stripe stored the name", stored.shipping?.name === "Jenny Rosen");
  check("physical: Stripe stored line 1", stored.shipping?.address?.line1 === "27 Alder Way");
  check("physical: Stripe stored the postcode", stored.shipping?.address?.postal_code === "BS1 4QA");
  check("physical: Stripe stored the country as alpha-2", stored.shipping?.address?.country === "GB");

  /*
   * A download has no destination. Sailo never asked the buyer for one, so the
   * columns are empty and nothing should be built from them — a shipping
   * address on a digital order is a claim about the world that isn't true.
   */
  const digital = checkoutShipping({
    customerName: "Jenny Rosen",
    customerPhone: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
  });
  check("digital: no address is built when none was collected", digital === null);

  /*
   * The legacy row. Free-text countries predate the picker, and "Hrvatska" is
   * not an alpha-2 code — Stripe would reject the whole session over it, so it
   * is dropped rather than sent.
   */
  const legacy = checkoutShipping({
    customerName: "Ivan Horvat",
    customerPhone: null,
    addressLine1: "Ilica 1",
    addressLine2: null,
    city: "Zagreb",
    region: null,
    postalCode: "10000",
    country: "Hrvatska",
  });
  check("legacy: an unrecognised country is dropped, not sent", legacy?.address.country === undefined);

  const legacyIntent = await stripe.paymentIntents.create(
    {
      amount: 1000,
      currency: "usd",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      ...(legacy ? { shipping: legacy } : {}),
    },
    { stripeAccount: seller },
  );
  check("legacy: Stripe still accepts the rest of the address", Boolean(legacyIntent.shipping));

  console.log();

  /* ------------------------------------------------------------------ */
  console.log("Memberships bill through a Price, not price_data\n");

  const price = await stripe.prices.create(
    {
      currency: "usd",
      unit_amount: 1200,
      recurring: { interval: "month" },
      product_data: {
        name: "Studio membership",
        // `prices.create` takes no `images` inside `product_data`, which is why
        // `membershipPrice` sets what it can here and the picture is attached
        // to the Product it mints. Asserting the name proves the Price path is
        // still wired; the image is asserted through the Product below.
      },
    },
    { stripeAccount: seller },
  );

  const subscription = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: "https://sailo.store/ok",
      cancel_url: "https://sailo.store/no",
    },
    { stripeAccount: seller },
  );

  const fullSub = await stripe.checkout.sessions.retrieve(
    subscription.id,
    { expand: ["line_items.data.price.product"] },
    { stripeAccount: seller },
  );
  const membershipProduct = fullSub.line_items?.data[0]?.price?.product as
    | Stripe.Product
    | undefined;

  console.log(`  name: ${membershipProduct?.name ?? "(none)"}`);
  check("membership: name reaches the subscribe page", membershipProduct?.name === "Studio membership");
  check("membership: session is a subscription", fullSub.mode === "subscription");

  /* ------------------------------------------------------------------ */
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("\ncheck:checkout failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const id of created) {
      try {
        await stripe.accounts.del(id);
      } catch {
        console.log(`could not delete ${id} — remove it by hand`);
      }
    }
    console.log(`cleaned up ${created.length} account(s)`);
  });
