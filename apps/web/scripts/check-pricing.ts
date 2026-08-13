/**
 * Checks the money.
 *
 * Every price a buyer is quoted and every order that gets written go through
 * `quote()` — one line or a basket of twenty, a mug or a PDF or a workshop.
 * These assertions exercise that same function directly, so a coupon that
 * stops working on services, or a commission that starts being paid on
 * postage, fails here rather than in someone's shop.
 *
 *   npm test
 */
import type { Coupon, DeliveryMethod, ProductOption } from "@sailo/db/schema";
import { present } from "@sailo/core/invariant";
import { quote, cartNeedsDelivery, type QuoteLine } from "@sailo/core/quote";
import { checkCoupon, type TaxSettings } from "@sailo/core/pricing";

/* -------------------------------------------------------------------------- */
/*  Harness                                                                    */
/* -------------------------------------------------------------------------- */

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof Error ? error.message : error}`);
  }
}

function equal(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${expected}, got ${actual}`);
  }
}

function group(title: string) {
  console.log(`\n${title}`);
}

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const NOW = new Date("2026-08-04T12:00:00Z");

function line(
  kind: string,
  unitPriceCents: number,
  quantity = 1,
  extra: Partial<QuoteLine> = {},
): QuoteLine {
  return {
    productId: `${kind}-product`,
    variantId: null,
    title: `A ${kind}`,
    kind,
    options: [] as ProductOption[],
    variantOptions: null,
    sku: null,
    imageUrl: null,
    unitPriceCents,
    quantity,
    ...extra,
  };
}

const MUG = line("physical", 2400);
const PDF = line("digital", 1200);
const CLASS = line("service", 8500);

function coupon(over: Partial<Coupon> = {}): Coupon {
  return {
    id: "coupon-1",
    shopId: "shop-1",
    code: "SAVE10",
    discountType: "percent",
    discountValue: 1000, // 10%
    minSubtotalCents: 0,
    maxRedemptions: null,
    timesRedeemed: 0,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Coupon;
}

const SHIPPING = {
  feeCents: 500,
  freeOverCents: null,
} as Pick<DeliveryMethod, "feeCents" | "freeOverCents">;

const NO_TAX: TaxSettings = {
  taxEnabled: false,
  taxName: "Tax",
  taxRateBp: 0,
  taxInclusive: false,
  taxOnDelivery: true,
};

const VAT_INCLUSIVE: TaxSettings = {
  taxEnabled: true,
  taxName: "VAT",
  taxRateBp: 2000, // 20%
  taxInclusive: true,
  taxOnDelivery: true,
};

const SALES_TAX: TaxSettings = {
  taxEnabled: true,
  taxName: "Sales tax",
  taxRateBp: 800, // 8%
  taxInclusive: false,
  taxOnDelivery: false,
};

/* -------------------------------------------------------------------------- */
/*  Coupons                                                                    */
/* -------------------------------------------------------------------------- */

group("Coupons apply to every kind of product");

for (const [kind, item] of [
  ["physical", MUG],
  ["digital", PDF],
  ["service", CLASS],
] as const) {
  check(`10% off a ${kind} product`, () => {
    const result = quote({
      lines: [item],
      coupon: coupon(),
      tax: NO_TAX,
      now: NOW,
    });
    const expected = Math.round(item.unitPriceCents * 0.1);
    equal(result.totals.discountCents, expected, "discount");
    equal(
      result.totals.totalCents,
      item.unitPriceCents - expected,
      "total",
    );
  });
}

check("a fixed discount never exceeds the subtotal", () => {
  const result = quote({
    lines: [PDF], // 1200
    coupon: coupon({ discountType: "fixed", discountValue: 5000 }),
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.totals.discountCents, 1200, "discount");
  equal(result.totals.totalCents, 0, "total");
});

check("a minimum spend is judged on the whole basket, not one line", () => {
  const min = coupon({ minSubtotalCents: 5000 });

  // 1200 on its own doesn't qualify…
  equal(checkCoupon(min, PDF.unitPriceCents, NOW).ok, false, "single line");

  // …but a basket of a mug, a PDF and nothing else reaching 5000 does.
  const basket = [MUG, PDF, line("physical", 2000)]; // 2400 + 1200 + 2000
  const result = quote({
    lines: basket,
    coupon: min,
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.totals.subtotalCents, 5600, "basket subtotal");
  equal(result.totals.discountCents, 560, "discount");
});

check("an expired or used-up code is refused", () => {
  equal(
    checkCoupon(coupon({ expiresAt: new Date("2026-01-01") }), 10_000, NOW).ok,
    false,
    "expired",
  );
  equal(
    checkCoupon(coupon({ maxRedemptions: 5, timesRedeemed: 5 }), 10_000, NOW).ok,
    false,
    "used up",
  );
  equal(
    checkCoupon(coupon({ isActive: false }), 10_000, NOW).ok,
    false,
    "inactive",
  );
});

check("a discount comes off the goods, never off delivery", () => {
  const result = quote({
    lines: [MUG],
    coupon: coupon({ discountType: "fixed", discountValue: 2400 }),
    deliveryMethod: SHIPPING,
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.totals.discountCents, 2400, "discount");
  equal(result.totals.deliveryFeeCents, 500, "delivery still charged");
  equal(result.totals.totalCents, 500, "total is the postage");
});

/* -------------------------------------------------------------------------- */
/*  Referrals                                                                  */
/* -------------------------------------------------------------------------- */

group("Referral commission is earned on every kind of product");

for (const [kind, item] of [
  ["physical", MUG],
  ["digital", PDF],
  ["service", CLASS],
] as const) {
  check(`10% commission on a ${kind} product`, () => {
    const result = quote({
      lines: [item],
      commissionBp: 1000,
      tax: NO_TAX,
      now: NOW,
    });
    equal(
      result.totals.commissionCents,
      Math.round(item.unitPriceCents * 0.1),
      "commission",
    );
  });
}

check("commission is not paid on the delivery fee", () => {
  const result = quote({
    lines: [MUG],
    commissionBp: 1000,
    deliveryMethod: SHIPPING,
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.totals.deliveryFeeCents, 500, "delivery");
  equal(result.totals.commissionCents, 240, "commission on goods only");
});

check("commission follows the discounted price, not the list price", () => {
  const result = quote({
    lines: [CLASS], // 8500
    coupon: coupon(), // −850
    commissionBp: 1000,
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.totals.discountCents, 850, "discount");
  equal(result.totals.commissionCents, 765, "commission on 7650");
});

check("commission excludes tax the seller only collects", () => {
  // £24.00 inclusive of 20% VAT is £20.00 of goods and £4.00 of tax.
  const result = quote({
    lines: [MUG],
    commissionBp: 1000,
    tax: VAT_INCLUSIVE,
    now: NOW,
  });
  equal(result.totals.taxCents, 400, "VAT extracted from the price");
  equal(result.totals.totalCents, 2400, "inclusive tax isn't added again");
  equal(result.totals.commissionCents, 200, "10% of the £20 of goods");
});

check("a referral on a mixed basket earns on all of it", () => {
  const result = quote({
    lines: [MUG, PDF, CLASS], // 2400 + 1200 + 8500
    commissionBp: 1500,
    deliveryMethod: SHIPPING,
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.totals.subtotalCents, 12_100, "subtotal");
  equal(result.totals.commissionCents, 1815, "15% of the goods");
});

/* -------------------------------------------------------------------------- */
/*  What each kind asks for                                                    */
/* -------------------------------------------------------------------------- */

group("Only physical goods are delivered");

check("a digital-only basket is never shipped or addressed", () => {
  const result = quote({
    lines: [PDF],
    deliveryMethod: SHIPPING,
    collectAddress: true,
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.needsDelivery, false, "needsDelivery");
  equal(result.needsAddress, false, "needsAddress");
  equal(result.totals.deliveryFeeCents, 0, "no fee even with a rate picked");
});

check("a service-only basket is never shipped or addressed", () => {
  const result = quote({
    lines: [CLASS],
    deliveryMethod: SHIPPING,
    collectAddress: true,
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.needsDelivery, false, "needsDelivery");
  equal(result.needsAddress, false, "needsAddress");
  equal(result.totals.totalCents, 8500, "total");
});

check("one physical line in a mixed basket brings delivery back", () => {
  const result = quote({
    lines: [PDF, CLASS, MUG],
    deliveryMethod: SHIPPING,
    collectAddress: true,
    deliveryType: "shipping",
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.needsDelivery, true, "needsDelivery");
  equal(result.needsAddress, true, "needsAddress");
  equal(result.totals.deliveryFeeCents, 500, "one fee for the order");
  equal(result.totals.totalCents, 12_600, "goods plus one postage");
});

check("collection asks for no address", () => {
  const result = quote({
    lines: [MUG],
    deliveryMethod: { feeCents: 0, freeOverCents: null },
    collectAddress: true,
    deliveryType: "collection",
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.needsDelivery, true, "needsDelivery");
  equal(result.needsAddress, false, "needsAddress");
});

check("a shop with address collection off never asks", () => {
  const result = quote({
    lines: [MUG],
    deliveryMethod: SHIPPING,
    collectAddress: false,
    deliveryType: "shipping",
    tax: NO_TAX,
    now: NOW,
  });
  equal(result.needsAddress, false, "needsAddress");
});

check("cartNeedsDelivery agrees with the quote", () => {
  equal(cartNeedsDelivery([PDF, CLASS]), false, "downloads and bookings");
  equal(cartNeedsDelivery([PDF, MUG]), true, "with a mug in it");
});

/* -------------------------------------------------------------------------- */
/*  Everything at once                                                         */
/* -------------------------------------------------------------------------- */

group("Coupon, referral, delivery and tax together");

check("free-over is measured after the discount", () => {
  const rate = { feeCents: 500, freeOverCents: 5000 };

  // 5600 of goods qualifies…
  equal(
    quote({ lines: [MUG, PDF, line("physical", 2000)], deliveryMethod: rate, tax: NO_TAX, now: NOW })
      .totals.deliveryFeeCents,
    0,
    "free over the threshold",
  );

  // …but a 20% coupon drops it to 4480, and postage comes back.
  equal(
    quote({
      lines: [MUG, PDF, line("physical", 2000)],
      coupon: coupon({ discountValue: 2000 }),
      deliveryMethod: rate,
      tax: NO_TAX,
      now: NOW,
    }).totals.deliveryFeeCents,
    500,
    "under the threshold once discounted",
  );
});

check("a full basket adds up", () => {
  // Goods 12100, −10% = 10890, postage 500, 8% sales tax on goods only.
  const result = quote({
    lines: [MUG, PDF, CLASS],
    coupon: coupon(),
    deliveryMethod: SHIPPING,
    commissionBp: 1000,
    tax: SALES_TAX,
    collectAddress: true,
    deliveryType: "shipping",
    now: NOW,
  });

  equal(result.totals.subtotalCents, 12_100, "subtotal");
  equal(result.totals.discountCents, 1210, "discount");
  equal(result.totals.deliveryFeeCents, 500, "delivery");
  equal(result.totals.taxCents, 871, "8% of 10890, delivery untaxed");
  equal(result.totals.totalCents, 12_261, "10890 + 500 + 871");
  equal(result.totals.commissionCents, 1089, "10% of the net goods");
  equal(result.unitCount, 3, "units");
  equal(result.hasDigital, true, "has a download");
  equal(result.hasService, true, "has a booking");
});

check("quantity and variant pricing reach the line subtotal", () => {
  const result = quote({
    lines: [
      line("physical", 2800, 3, {
        variantOptions: { Size: "450ml" },
        options: [{ name: "Size", values: ["250ml", "450ml"] }],
      }),
    ],
    tax: NO_TAX,
    now: NOW,
  });
  equal(present(result.lines[0], "line 0").subtotalCents, 8400, "3 × 2800");
  equal(present(result.lines[0], "line 0").label, "450ml", "variant label");
  equal(result.totals.subtotalCents, 8400, "subtotal");
});

/* -------------------------------------------------------------------------- */

console.log(
  `\n${passed} passed${failures.length ? `, ${failures.length} failed` : ""}`,
);
if (failures.length) {
  for (const name of failures) console.log(`  · ${name}`);
  process.exit(1);
}
